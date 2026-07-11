import { Progress } from '@base-ui/react/progress';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadConvertResult,
  pollConvertTask,
  submitConvertTask,
  type ConvertTaskResponse
} from '~/lib/convert-api';
import {
  COMPOSE_FONTS,
  DEFAULT_COMPOSE_FONT_ID,
  type ComposeFontId
} from '@shared/queue/convert/fonts';
import type { TextPosition } from '@shared/queue/convert/schemas';
import { ComposeAssetCard } from '~/components/compose-asset-card';
import { TimelineEditor } from '~/components/timeline-editor';
import { buildTimelineManifest, validateTimelineClips, type TimelineClip } from '~/lib/timeline-clips';

export const Route = createFileRoute('/compose')({
  component: ComposePage
});

type ComposeMode = 'sequential' | 'timeline';
type AssetType = 'video' | 'audio' | 'image';
type WorkflowStage = 'idle' | 'submitting' | 'processing' | 'success' | 'error';

interface AssetItem {
  id: string;
  field: string;
  type: AssetType;
  file: File;
  name: string;
}

interface SequentialAudioSegment {
  key: string;
  assetId: string;
  volume: number;
  start: number;
  duration: string;
}

interface SequentialSegment {
  key: string;
  type: 'video' | 'image' | 'text';
  assetId?: string;
  content?: string;
  duration: number;
  keepAudio?: boolean;
  fit: 'contain' | 'cover' | 'fill';
  fontSize: number;
  fontId: ComposeFontId;
  textPosition: TextPosition;
  textMargin: number;
}

const VIDEO_PATTERN = /\.(mp4|m4v|mov|avi|mkv|webm|mpeg|mpg|wmv|flv|ts|m2ts|3gp)$/i;
const AUDIO_PATTERN = /\.(mp3|wav|aac|m4a|ogg|flac|aiff|alac|opus|wma)$/i;
const IMAGE_PATTERN = /\.(png|jpg|jpeg|gif|webp|bmp|tif|tiff|heic|heif|avif)$/i;
const ASSET_INPUT_ID = 'compose-asset-input';
const SELECT_FIELD_CLASS =
  'mt-1 w-full cursor-pointer rounded-[var(--radius-md)] border border-stone-strong bg-surface px-2 py-1.5 text-sm text-ink disabled:cursor-not-allowed';
const CHECKBOX_LABEL_CLASS = 'flex cursor-pointer items-center gap-2 text-xs text-ink-secondary';
const CHECKBOX_CLASS = 'cursor-pointer disabled:cursor-not-allowed';
const INPUT_FIELD_CLASS =
  'mt-1 w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-2 py-1.5 text-sm text-ink';
const TAB_BUTTON_CLASS =
  'cursor-pointer rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed';

function detectAssetType(file: File): AssetType | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('video/') || VIDEO_PATTERN.test(name)) return 'video';
  if (type.startsWith('audio/') || AUDIO_PATTERN.test(name)) return 'audio';
  if (type.startsWith('image/') || IMAGE_PATTERN.test(name)) return 'image';
  return null;
}

function slugify(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return (base || 'asset').slice(0, 48);
}

function uniqueAssetId(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 1;
  while (used.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

function createSegmentKey(): string {
  return `seg_${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultAudioSegment(assetId = ''): SequentialAudioSegment {
  return {
    key: createSegmentKey(),
    assetId,
    volume: 1,
    start: 0,
    duration: ''
  };
}

function buildSequentialAudioTracks(
  segments: SequentialAudioSegment[],
  options?: { loop?: boolean }
): Array<{
  assetId: string;
  volume: number;
  loop: boolean;
  start: number;
  duration?: number;
}> {
  return segments
    .filter((segment) => segment.assetId)
    .map((segment) => ({
      assetId: segment.assetId,
      volume: segment.volume,
      loop: options?.loop ?? false,
      start: segment.start,
      ...(segment.duration.trim() !== '' && Number(segment.duration) > 0
        ? { duration: Number(segment.duration) }
        : {})
    }));
}

function statusLabel(status: ConvertTaskResponse['status']): string {
  if (status === 'queued') return '排队中';
  if (status === 'processing') return '处理中';
  if (status === 'completed') return '已完成';
  return '失败';
}

function assetTypeLabel(type: AssetType): string {
  if (type === 'video') return '视频';
  if (type === 'audio') return '音频';
  return '图片';
}

function segmentTypeLabel(type: SequentialSegment['type']): string {
  if (type === 'video') return '视频';
  if (type === 'image') return '图片';
  return '文字';
}

const FIT_OPTIONS: Array<{ value: SequentialSegment['fit']; label: string }> = [
  { value: 'contain', label: '适应' },
  { value: 'cover', label: '裁剪填充' },
  { value: 'fill', label: '拉伸' }
];

const TEXT_POSITION_OPTIONS: Array<{ value: TextPosition; label: string }> = [
  { value: 'top', label: '上' },
  { value: 'bottom', label: '下' },
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
  { value: 'center', label: '居中' }
];

function TextPlacementRow(props: {
  fontSize: number;
  position: TextPosition;
  margin: number;
  onFontSizeChange: (fontSize: number) => void;
  onPositionChange: (position: TextPosition) => void;
  onMarginChange: (margin: number) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const showMargin = props.position !== 'center';
  const isVertical = props.position === 'left' || props.position === 'right';
  const fieldClass =
    'mt-1 w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-2 py-1.5 text-sm text-ink';
  const selectClass = `${fieldClass} cursor-pointer disabled:cursor-not-allowed`;

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${showMargin ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <label className="text-[11px] text-ink-muted">
          字号
          <input
            type="number"
            min={8}
            max={256}
            value={props.fontSize}
            onChange={(e) => props.onFontSizeChange(Number(e.target.value))}
            disabled={props.disabled}
            className={fieldClass}
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          位置
          <select
            value={props.position}
            onChange={(e) => props.onPositionChange(e.target.value as TextPosition)}
            disabled={props.disabled}
            className={selectClass}
          >
            {TEXT_POSITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {showMargin ? (
          <label className="text-[11px] text-ink-muted">
            边距 (px)
            <input
              type="number"
              min={0}
              max={200}
              value={props.margin}
              onChange={(e) => props.onMarginChange(Number(e.target.value))}
              disabled={props.disabled}
              className={fieldClass}
            />
          </label>
        ) : null}
      </div>
      {isVertical ? (
        <p className="text-[10px] leading-relaxed text-ink-muted">左右位置将竖排显示文字（从上到下）。</p>
      ) : null}
    </div>
  );
}

function FontSelect(props: {
  value: ComposeFontId;
  onChange: (fontId: ComposeFontId) => void;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as ComposeFontId)}
      disabled={props.disabled}
      className={
        props.className ??
        `${SELECT_FIELD_CLASS}`
      }
    >
      {COMPOSE_FONTS.map((font) => (
        <option key={font.id} value={font.id}>
          {font.label}
        </option>
      ))}
    </select>
  );
}

function ComposePage(): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<ComposeMode>('sequential');
  const [stage, setStage] = useState<WorkflowStage>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [task, setTask] = useState<ConvertTaskResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const [outputWidth, setOutputWidth] = useState(1280);
  const [outputHeight, setOutputHeight] = useState(720);
  const [outputFps, setOutputFps] = useState(30);

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [segments, setSegments] = useState<SequentialSegment[]>([]);
  const [audioSegments, setAudioSegments] = useState<SequentialAudioSegment[]>([]);
  const [bgmAssetId, setBgmAssetId] = useState('');
  const [bgmVolume, setBgmVolume] = useState(0.35);
  const [bgmLoop, setBgmLoop] = useState(true);
  const [bgmStart, setBgmStart] = useState(0);
  const [bgmDuration, setBgmDuration] = useState('');
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [timelineTotalDuration, setTimelineTotalDuration] = useState<number | ''>('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [isDraggingAssets, setIsDraggingAssets] = useState(false);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);

  const assetPreviewUrls = useMemo(() => {
    return Object.fromEntries(assets.map((asset) => [asset.id, URL.createObjectURL(asset.file)]));
  }, [assets]);

  const videoAssets = useMemo(() => assets.filter((a) => a.type === 'video'), [assets]);
  const imageAssets = useMemo(() => assets.filter((a) => a.type === 'image'), [assets]);
  const audioAssets = useMemo(() => assets.filter((a) => a.type === 'audio'), [assets]);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(assetPreviewUrls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assetPreviewUrls]);

  const resetResult = (): void => {
    setResultUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setTask(null);
  };

  const applyUploadedFiles = (fileList: FileList | File[] | null): void => {
    if (!fileList || fileList.length === 0) return;

    const incoming = Array.from(fileList);
    const skipped: string[] = [];
    const parsed: Array<{ type: AssetType; file: File }> = [];

    for (const file of incoming) {
      const type = detectAssetType(file);
      if (!type) {
        skipped.push(file.name);
        continue;
      }
      parsed.push({ type, file });
    }

    if (parsed.length === 0) {
      setUploadNotice(
        skipped.length > 0 ? `以下文件格式不支持：${skipped.join('、')}` : '未添加任何文件。'
      );
      return;
    }

    setAssets((current) => {
      const usedIds = new Set(current.map((item) => item.id));
      const next = [...current];

      for (const item of parsed) {
        const id = uniqueAssetId(slugify(item.file.name), usedIds);
        usedIds.add(id);
        next.push({
          id,
          field: id,
          type: item.type,
          file: item.file,
          name: item.file.name
        });
      }

      return next;
    });

    if (skipped.length > 0) {
      setUploadNotice(`已添加 ${parsed.length} 个文件，跳过：${skipped.join('、')}`);
    } else {
      setUploadNotice(`已添加 ${parsed.length} 个文件。`);
    }
  };

  const handleAssetUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    applyUploadedFiles(event.target.files);
    event.target.value = '';
  };

  const handleAssetDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setIsDraggingAssets(false);
    if (isBusy) return;
    applyUploadedFiles(event.dataTransfer.files);
  };

  const removeAsset = (assetId: string): void => {
    if (playingAssetId === assetId) {
      setPlayingAssetId(null);
    }
    setAssets((current) => current.filter((item) => item.id !== assetId));
    setSegments((current) =>
      current.filter((segment) => segment.type === 'text' || segment.assetId !== assetId)
    );
    setAudioSegments((current) =>
      current.map((segment) =>
        segment.assetId === assetId ? { ...segment, assetId: '' } : segment
      )
    );
    if (bgmAssetId === assetId) setBgmAssetId('');
    setTimelineClips((current) =>
      current.map((clip) => {
        if (clip.type !== 'text' && clip.assetId === assetId) {
          return { ...clip, assetId: '' };
        }
        return clip;
      })
    );
  };

  const addSegment = (type: SequentialSegment['type']): void => {
    const firstVideo = videoAssets[0];
    if (type === 'video' && firstVideo) {
      setSegments((current) => [
        ...current,
        {
          key: createSegmentKey(),
          type: 'video',
          assetId: firstVideo.id,
          duration: 0,
          keepAudio: false,
          fit: 'contain',
          fontSize: 48,
          fontId: DEFAULT_COMPOSE_FONT_ID,
          textPosition: 'center',
          textMargin: 40
        }
      ]);
      return;
    }
    const firstImage = imageAssets[0];
    if (type === 'image' && firstImage) {
      setSegments((current) => [
        ...current,
        {
          key: createSegmentKey(),
          type: 'image',
          assetId: firstImage.id,
          duration: 3,
          fit: 'cover',
          fontSize: 48,
          fontId: DEFAULT_COMPOSE_FONT_ID,
          textPosition: 'center',
          textMargin: 40
        }
      ]);
      return;
    }
    if (type === 'text') {
      setSegments((current) => [
        ...current,
        {
          key: createSegmentKey(),
          type: 'text',
          content: '欢迎观看',
          duration: 3,
          fit: 'contain',
          fontSize: 48,
          fontId: DEFAULT_COMPOSE_FONT_ID,
          textPosition: 'center',
          textMargin: 40
        }
      ]);
    }
  };

  const addAudioSegment = (): void => {
    const defaultAssetId = audioAssets[0]?.id ?? '';
    setAudioSegments((current) => [...current, createDefaultAudioSegment(defaultAssetId)]);
  };

  const moveSegment = (index: number, direction: -1 | 1): void => {
    setSegments((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(target, 0, item);
      return next;
    });
  };

  const buildManifest = (): unknown => {
    const output = {
      width: outputWidth,
      height: outputHeight,
      fps: outputFps
    };

    const manifestAssets = assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      field: asset.field
    }));

    if (mode === 'sequential') {
      return {
        mode: 'sequential',
        output,
        assets: manifestAssets,
        segments: segments.map((segment) => {
          if (segment.type === 'video') {
            return {
              type: 'video',
              assetId: segment.assetId,
              keepAudio: segment.keepAudio ?? false,
              fit: segment.fit
            };
          }
          if (segment.type === 'image') {
            return {
              type: 'image',
              assetId: segment.assetId,
              duration: segment.duration,
              fit: segment.fit
            };
          }
          return {
            type: 'text',
            content: segment.content ?? '',
            duration: segment.duration,
            style: {
              fontSize: segment.fontSize,
              fontId: segment.fontId,
              position: segment.textPosition,
              margin: segment.textMargin
            }
          };
        }),
        audioTracks: (() => {
          const tracks = buildSequentialAudioTracks(audioSegments);
          if (bgmAssetId) {
            tracks.push(
              ...buildSequentialAudioTracks(
                [
                  {
                    key: 'bgm',
                    assetId: bgmAssetId,
                    volume: bgmVolume,
                    start: bgmStart,
                    duration: bgmDuration
                  }
                ],
                { loop: bgmLoop }
              )
            );
          }
          return tracks.length > 0 ? tracks : undefined;
        })()
      };
    }

    return buildTimelineManifest(timelineClips, timelineTotalDuration, output, manifestAssets);
  };

  const validateBeforeSubmit = (): string | null => {
    if (assets.length === 0) return '请至少上传一个素材文件。';
    if (mode === 'sequential') {
      if (segments.length === 0 && audioSegments.length === 0) return '请至少添加一个片段。';
      for (const segment of segments) {
        if (segment.type === 'text' && !segment.content?.trim()) return '文字片段内容不能为空。';
        if (segment.type !== 'text' && !segment.assetId) return '存在未选择素材的片段。';
        if ((segment.type === 'image' || segment.type === 'text') && segment.duration <= 0) {
          return '图片或文字片段时长必须大于 0。';
        }
      }
      for (const segment of audioSegments) {
        if (!segment.assetId) return '存在未选择素材的音频片段。';
      }
      return null;
    }

    return validateTimelineClips(timelineClips);
  };

  const handleCompose = async (): Promise<void> => {
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setStage('error');
      setErrorMessage(validationError);
      return;
    }

    resetResult();
    setStage('submitting');
    setErrorMessage('');

    try {
      const manifest = buildManifest();
      const files = new Map(assets.map((asset) => [asset.field, asset.file]));
      const submit = await submitConvertTask(manifest, files);

      setProgress(0);
      setStage('processing');
      const finalTask = await pollConvertTask(
        submit.taskId,
        (nextTask) => {
          setTask(nextTask);
          if (typeof nextTask.progress === 'number') {
            setProgress(nextTask.progress);
          }
        },
        1000
      );

      if (finalTask.status === 'failed') {
        throw new Error(finalTask.error ?? '合成任务失败');
      }

      if (finalTask.result?.url) {
        setResultUrl(finalTask.result.url);
      } else {
        const blob = await downloadConvertResult(submit.taskId);
        setResultUrl(URL.createObjectURL(blob));
      }

      setProgress(100);
      setStage('success');
    } catch (error) {
      setStage('error');
      setErrorMessage(error instanceof Error ? error.message : '合成发生意外错误');
    }
  };

  const startOver = (): void => {
    resetResult();
    setStage('idle');
    setErrorMessage('');
    setProgress(0);
  };

  const isBusy = stage === 'submitting' || stage === 'processing';

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col px-4 pb-10 pt-6">
      <div className="reveal mb-6">
        <h1 className="text-2xl font-semibold text-ink">视频合成</h1>
        <p className="mt-1 text-sm text-ink-muted">上传多段视频、图片、音频与文字，异步合成一个 MP4。</p>
      </div>

      <div className="reveal space-y-4">
        <section className="rounded-[var(--radius-lg)] border border-stone bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${TAB_BUTTON_CLASS} ${
                mode === 'sequential'
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-stone-strong bg-elevated text-ink-secondary hover:border-accent'
              }`}
              onClick={() => setMode('sequential')}
              disabled={isBusy}
            >
              顺序拼接
            </button>
            <button
              type="button"
              className={`${TAB_BUTTON_CLASS} ${
                mode === 'timeline'
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-stone-strong bg-elevated text-ink-secondary hover:border-accent'
              }`}
              onClick={() => setMode('timeline')}
              disabled={isBusy}
            >
              时间线
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              宽度
              <input
                type="number"
                min={64}
                max={3840}
                value={outputWidth}
                onChange={(e) => setOutputWidth(Number(e.target.value))}
                className="rounded-[var(--radius-md)] border border-stone-strong bg-page px-2 py-1.5 text-sm text-ink"
                disabled={isBusy}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              高度
              <input
                type="number"
                min={64}
                max={2160}
                value={outputHeight}
                onChange={(e) => setOutputHeight(Number(e.target.value))}
                className="rounded-[var(--radius-md)] border border-stone-strong bg-page px-2 py-1.5 text-sm text-ink"
                disabled={isBusy}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
              帧率
              <input
                type="number"
                min={1}
                max={60}
                value={outputFps}
                onChange={(e) => setOutputFps(Number(e.target.value))}
                className="rounded-[var(--radius-md)] border border-stone-strong bg-page px-2 py-1.5 text-sm text-ink"
                disabled={isBusy}
              />
            </label>
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-stone bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">素材</h2>
            <label htmlFor={ASSET_INPUT_ID} className={`btn-ghost !px-3 !py-1.5 ${isBusy ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
              添加文件
            </label>
            <input
              id={ASSET_INPUT_ID}
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*"
              className="hidden"
              onChange={handleAssetUpload}
              disabled={isBusy}
            />
          </div>

          {uploadNotice ? <p className="mb-3 text-xs text-ink-secondary">{uploadNotice}</p> : null}

          {assets.length === 0 ? (
            <label
              htmlFor={ASSET_INPUT_ID}
              onDragOver={(event) => {
                event.preventDefault();
                if (!isBusy) setIsDraggingAssets(true);
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setIsDraggingAssets(false);
              }}
              onDrop={handleAssetDrop}
              className={`block cursor-pointer rounded-[var(--radius-md)] border border-dashed px-3 py-8 text-center text-xs transition-colors ${
                isDraggingAssets
                  ? 'border-accent bg-accent-soft/40 text-ink'
                  : 'border-stone-strong text-ink-muted hover:border-accent/60 hover:bg-page'
              } ${isBusy ? 'pointer-events-none opacity-50' : ''}`}
            >
              点击或拖拽上传视频、图片、音频。文字片段无需上传文件。
            </label>
          ) : (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!isBusy) setIsDraggingAssets(true);
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setIsDraggingAssets(false);
              }}
              onDrop={handleAssetDrop}
              className={isDraggingAssets ? 'rounded-[var(--radius-md)] ring-2 ring-accent/40' : undefined}
            >
              <div className="grid grid-cols-4 gap-3">
                {assets.map((asset) => (
                  <ComposeAssetCard
                    key={asset.id}
                    id={asset.id}
                    name={asset.name}
                    type={asset.type}
                    file={asset.file}
                    previewUrl={assetPreviewUrls[asset.id] ?? ''}
                    typeLabel={assetTypeLabel(asset.type)}
                    playingAssetId={playingAssetId}
                    onPlayingChange={setPlayingAssetId}
                    disabled={isBusy}
                    onRemove={removeAsset}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {mode === 'sequential' ? (
          <section className="rounded-[var(--radius-lg)] border border-stone bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">片段</h2>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addSegment('video')} disabled={isBusy || videoAssets.length === 0}>
                  + 视频
                </button>
                <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addSegment('image')} disabled={isBusy || imageAssets.length === 0}>
                  + 图片
                </button>
                <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={addAudioSegment} disabled={isBusy || audioAssets.length === 0}>
                  + 音频
                </button>
                <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addSegment('text')} disabled={isBusy}>
                  + 文字
                </button>
              </div>
            </div>

            {segments.length === 0 && audioSegments.length === 0 ? (
              <p className="text-xs text-ink-muted">按顺序添加片段，系统将依次拼接。</p>
            ) : null}

            {segments.length > 0 ? (
              <ul className="space-y-3">
                {segments.map((segment, index) => (
                  <li key={segment.key} className="rounded-[var(--radius-md)] border border-stone-strong bg-page p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium tracking-wide text-accent">{segmentTypeLabel(segment.type)}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" className="text-[11px] text-ink-muted hover:text-ink" onClick={() => moveSegment(index, -1)} disabled={isBusy || index === 0}>
                          上移
                        </button>
                        <button type="button" className="text-[11px] text-ink-muted hover:text-ink" onClick={() => moveSegment(index, 1)} disabled={isBusy || index === segments.length - 1}>
                          下移
                        </button>
                        <button
                          type="button"
                          className="text-[11px] text-ink-muted hover:text-error"
                          onClick={() => setSegments((current) => current.filter((item) => item.key !== segment.key))}
                          disabled={isBusy}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    {segment.type === 'text' ? (
                      <div className="grid gap-2">
                        <textarea
                          value={segment.content ?? ''}
                          onChange={(e) =>
                            setSegments((current) =>
                              current.map((item) =>
                                item.key === segment.key ? { ...item, content: e.target.value } : item
                              )
                            )
                          }
                          rows={2}
                          className="w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-3 py-2 text-sm text-ink"
                          placeholder="输入中文字幕或标题"
                          disabled={isBusy}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] text-ink-muted">
                            字体
                            <FontSelect
                              value={segment.fontId}
                              onChange={(fontId) =>
                                setSegments((current) =>
                                  current.map((item) =>
                                    item.key === segment.key ? { ...item, fontId } : item
                                  )
                                )
                              }
                              disabled={isBusy}
                            />
                          </label>
                          <label className="text-[11px] text-ink-muted">
                            时长 (s)
                            <input
                              type="number"
                              min={0.1}
                              step={0.1}
                              value={segment.duration}
                              onChange={(e) =>
                                setSegments((current) =>
                                  current.map((item) =>
                                    item.key === segment.key ? { ...item, duration: Number(e.target.value) } : item
                                  )
                                )
                              }
                              className="mt-1 w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-2 py-1.5 text-sm text-ink"
                              disabled={isBusy}
                            />
                          </label>
                        </div>
                        <TextPlacementRow
                          fontSize={segment.fontSize}
                          position={segment.textPosition}
                          margin={segment.textMargin}
                          onFontSizeChange={(fontSize) =>
                            setSegments((current) =>
                              current.map((item) =>
                                item.key === segment.key ? { ...item, fontSize } : item
                              )
                            )
                          }
                          onPositionChange={(textPosition) =>
                            setSegments((current) =>
                              current.map((item) =>
                                item.key === segment.key ? { ...item, textPosition } : item
                              )
                            )
                          }
                          onMarginChange={(textMargin) =>
                            setSegments((current) =>
                              current.map((item) =>
                                item.key === segment.key ? { ...item, textMargin } : item
                              )
                            )
                          }
                          disabled={isBusy}
                        />
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <label className="text-[11px] text-ink-muted">
                          素材
                          <select
                            value={segment.assetId ?? ''}
                            onChange={(e) =>
                              setSegments((current) =>
                                current.map((item) =>
                                  item.key === segment.key ? { ...item, assetId: e.target.value } : item
                                )
                              )
                            }
                            className={SELECT_FIELD_CLASS}
                            disabled={isBusy}
                          >
                            {(segment.type === 'video' ? videoAssets : imageAssets).map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {segment.type === 'image' ? (
                            <label className="text-[11px] text-ink-muted">
                              时长 (s)
                              <input
                                type="number"
                                min={0.1}
                                step={0.1}
                                value={segment.duration}
                                onChange={(e) =>
                                  setSegments((current) =>
                                    current.map((item) =>
                                      item.key === segment.key ? { ...item, duration: Number(e.target.value) } : item
                                    )
                                  )
                                }
                                className="mt-1 w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-2 py-1.5 text-sm text-ink"
                                disabled={isBusy}
                              />
                            </label>
                          ) : (
                            <label className={`${CHECKBOX_LABEL_CLASS} pt-5`}>
                              <input
                                type="checkbox"
                                checked={segment.keepAudio ?? false}
                                onChange={(e) =>
                                  setSegments((current) =>
                                    current.map((item) =>
                                      item.key === segment.key ? { ...item, keepAudio: e.target.checked } : item
                                    )
                                  )
                                }
                                disabled={isBusy}
                                className={CHECKBOX_CLASS}
                              />
                              保留原声
                            </label>
                          )}
                          <label className="text-[11px] text-ink-muted">
                            适应方式
                            <select
                              value={segment.fit}
                              onChange={(e) =>
                                setSegments((current) =>
                                  current.map((item) =>
                                    item.key === segment.key
                                      ? { ...item, fit: e.target.value as SequentialSegment['fit'] }
                                      : item
                                  )
                                )
                              }
                              className={SELECT_FIELD_CLASS}
                              disabled={isBusy}
                            >
                              {FIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            {audioSegments.length > 0 ? (
              <ul className={`space-y-3 ${segments.length > 0 ? 'mt-3' : ''}`}>
                {audioSegments.map((audioSegment, index) => (
                  <li
                    key={audioSegment.key}
                    className="rounded-[var(--radius-md)] border border-stone-strong bg-page p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium tracking-wide text-accent">音频 {index + 1}</span>
                      <button
                        type="button"
                        className="text-[11px] text-ink-muted hover:text-error"
                        onClick={() =>
                          setAudioSegments((current) =>
                            current.filter((item) => item.key !== audioSegment.key)
                          )
                        }
                        disabled={isBusy}
                      >
                        删除
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-ink-muted">
                        素材
                        <select
                          value={audioSegment.assetId}
                          onChange={(e) =>
                            setAudioSegments((current) =>
                              current.map((item) =>
                                item.key === audioSegment.key
                                  ? { ...item, assetId: e.target.value }
                                  : item
                              )
                            )
                          }
                          className={SELECT_FIELD_CLASS}
                          disabled={isBusy || audioAssets.length === 0}
                        >
                          <option value="">选择音频</option>
                          {audioAssets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-ink-muted">
                        音量
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.05}
                          value={audioSegment.volume}
                          onChange={(e) =>
                            setAudioSegments((current) =>
                              current.map((item) =>
                                item.key === audioSegment.key
                                  ? { ...item, volume: Number(e.target.value) }
                                  : item
                              )
                            )
                          }
                          className={INPUT_FIELD_CLASS}
                          disabled={isBusy || !audioSegment.assetId}
                        />
                      </label>
                      <label className="text-[11px] text-ink-muted">
                        开始时间 (s)
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={audioSegment.start}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setAudioSegments((current) =>
                              current.map((item) =>
                                item.key === audioSegment.key
                                  ? {
                                      ...item,
                                      start: Number.isFinite(next) ? Math.max(0, next) : 0
                                    }
                                  : item
                              )
                            );
                          }}
                          className={INPUT_FIELD_CLASS}
                          disabled={isBusy || !audioSegment.assetId}
                        />
                      </label>
                      <label className="text-[11px] text-ink-muted">
                        播放时长 (s)
                        <input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={audioSegment.duration}
                          placeholder="留空至视频结束"
                          onChange={(e) =>
                            setAudioSegments((current) =>
                              current.map((item) =>
                                item.key === audioSegment.key
                                  ? { ...item, duration: e.target.value }
                                  : item
                              )
                            )
                          }
                          className={`${INPUT_FIELD_CLASS} placeholder:text-ink-muted/70`}
                          disabled={isBusy || !audioSegment.assetId}
                        />
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 rounded-[var(--radius-md)] border border-stone-strong bg-page p-3">
              <p className="mb-2 text-xs font-medium text-ink-secondary">背景音乐（可选）</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-ink-muted">
                  音轨
                  <select
                    value={bgmAssetId}
                    onChange={(e) => setBgmAssetId(e.target.value)}
                    className={SELECT_FIELD_CLASS}
                    disabled={isBusy || audioAssets.length === 0}
                  >
                    <option value="">无</option>
                    {audioAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-ink-muted">
                  音量
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(Number(e.target.value))}
                    className={INPUT_FIELD_CLASS}
                    disabled={isBusy || !bgmAssetId}
                  />
                </label>
                <label className="text-[11px] text-ink-muted">
                  开始时间 (s)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={bgmStart}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setBgmStart(Number.isFinite(next) ? Math.max(0, next) : 0);
                    }}
                    className={INPUT_FIELD_CLASS}
                    disabled={isBusy || !bgmAssetId}
                  />
                </label>
                <label className="text-[11px] text-ink-muted">
                  播放时长 (s)
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={bgmDuration}
                    placeholder="留空至视频结束"
                    onChange={(e) => setBgmDuration(e.target.value)}
                    className={`${INPUT_FIELD_CLASS} placeholder:text-ink-muted/70`}
                    disabled={isBusy || !bgmAssetId}
                  />
                </label>
              </div>
              <label className={`${CHECKBOX_LABEL_CLASS} mt-2`}>
                <input
                  type="checkbox"
                  checked={bgmLoop}
                  onChange={(e) => setBgmLoop(e.target.checked)}
                  disabled={isBusy || !bgmAssetId}
                  className={CHECKBOX_CLASS}
                />
                循环播放
              </label>
            </div>
          </section>
        ) : (
          <TimelineEditor
            clips={timelineClips}
            onClipsChange={setTimelineClips}
            totalDuration={timelineTotalDuration}
            onTotalDurationChange={setTimelineTotalDuration}
            videoAssets={videoAssets}
            imageAssets={imageAssets}
            audioAssets={audioAssets}
            assetPreviewUrls={assetPreviewUrls}
            disabled={isBusy}
          />
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-primary" onClick={() => void handleCompose()} disabled={isBusy}>
            {stage === 'submitting' ? '提交中…' : stage === 'processing' ? '合成中…' : '开始合成'}
          </button>
          {(stage === 'success' || stage === 'error') && (
            <button type="button" className="btn-ghost" onClick={startOver}>
              重新开始
            </button>
          )}
        </div>

        {(stage === 'submitting' || stage === 'processing') && (
          <section className="rounded-[var(--radius-lg)] border border-stone bg-surface p-4">
            <p className="mb-2 text-sm text-ink">
              {task ? statusLabel(task.status) : '正在提交任务…'}
              {typeof task?.progress === 'number' ? (
                <span className="ml-2 text-xs text-ink-muted">{task.progress}%</span>
              ) : null}
              {task?.taskId ? <span className="ml-2 text-xs text-ink-muted">({task.taskId})</span> : null}
            </p>
            <Progress.Root value={progress} className="w-full">
              <Progress.Track className="h-[3px] overflow-hidden rounded-full bg-stone">
                <Progress.Indicator className="h-full rounded-full bg-accent transition-all duration-300 ease-out" />
              </Progress.Track>
            </Progress.Root>
          </section>
        )}

        {stage === 'error' && (
          <section className="rounded-[var(--radius-lg)] border border-error/40 bg-error-soft/30 px-4 py-3">
            <p className="text-sm text-error">{errorMessage}</p>
          </section>
        )}

        {stage === 'success' && resultUrl && (
          <section className="rounded-[var(--radius-lg)] border border-accent/30 bg-surface p-4">
            <video className="aspect-video w-full rounded-[var(--radius-md)] bg-void object-contain" controls src={resultUrl} />
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="btn-primary" href={resultUrl} download="composed.mp4">
                下载 MP4
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
