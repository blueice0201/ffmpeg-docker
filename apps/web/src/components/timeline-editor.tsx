import { COMPOSE_FONTS, type ComposeFontId } from '@shared/queue/convert/fonts';
import type { TextPosition } from '@shared/queue/convert/schemas';
import { useMemo, useState } from 'react';
import { TimelinePreview } from '~/components/timeline-preview';
import { useMediaDurations } from '~/hooks/use-media-durations';
import {
  buildTimelinePreviewClips,
  computeTimelineSpan,
  defaultTimelineClip,
  suggestNextClipStart,
  TIMELINE_TRACK_LABELS,
  type TimelineClip,
  type TimelineClipType,
  type TimelineVideoClip
} from '~/lib/timeline-clips';

type AssetType = 'video' | 'audio' | 'image';

interface AssetOption {
  id: string;
  name: string;
  type: AssetType;
}

interface TimelineEditorProps {
  clips: TimelineClip[];
  onClipsChange: (clips: TimelineClip[]) => void;
  totalDuration: number | '';
  onTotalDurationChange: (value: number | '') => void;
  videoAssets: AssetOption[];
  imageAssets: AssetOption[];
  audioAssets: AssetOption[];
  assetPreviewUrls: Record<string, string>;
  disabled?: boolean;
}

const INPUT_CLASS =
  'mt-1 w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-2 py-1.5 text-sm text-ink';
const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer disabled:cursor-not-allowed`;
const CHECKBOX_LABEL_CLASS = 'flex cursor-pointer items-center gap-2 text-xs text-ink-secondary';
const CHECKBOX_CLASS = 'cursor-pointer disabled:cursor-not-allowed';
const FIT_OPTIONS = [
  { value: 'contain', label: '适应' },
  { value: 'cover', label: '裁剪填充' },
  { value: 'fill', label: '拉伸' }
] as const;
const TEXT_POSITION_OPTIONS: Array<{ value: TextPosition; label: string }> = [
  { value: 'top', label: '上' },
  { value: 'bottom', label: '下' },
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
  { value: 'center', label: '居中' }
];

function clipTypeLabel(type: TimelineClipType): string {
  return TIMELINE_TRACK_LABELS[type];
}

function updateClip(clips: TimelineClip[], key: string, patch: Partial<TimelineClip>): TimelineClip[] {
  return clips.map((clip) => (clip.key === key ? ({ ...clip, ...patch } as TimelineClip) : clip));
}

function TimelineClipCard(props: {
  clip: TimelineClip;
  videoAssets: AssetOption[];
  imageAssets: AssetOption[];
  audioAssets: AssetOption[];
  selected: boolean;
  probedDuration: number | undefined;
  disabled?: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<TimelineClip>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { clip, selected, disabled } = props;

  return (
    <li
      className={`rounded-[var(--radius-md)] border p-3 transition-colors ${
        selected ? 'border-accent bg-accent-soft/30 ring-1 ring-accent/40' : 'border-stone-strong bg-page'
      }`}
      onFocusCapture={() => props.onSelect()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onSelect();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-xs font-medium tracking-wide text-accent hover:underline"
          onClick={props.onSelect}
          disabled={disabled}
        >
          {clipTypeLabel(clip.type)}
        </button>
        <button
          type="button"
          className="text-[11px] text-ink-muted hover:text-error disabled:opacity-50"
          onClick={props.onRemove}
          disabled={disabled}
        >
          删除
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-muted">
          开始 (s)
          <input
            type="number"
            min={0}
            step={0.1}
            value={clip.start}
            onChange={(e) => props.onChange({ start: Math.max(0, Number(e.target.value)) })}
            className={INPUT_CLASS}
            disabled={disabled}
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          {clip.type === 'image' || clip.type === 'text' ? '时长 (s)' : '时长 (s，留空=素材全长)'}
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={clip.duration}
            placeholder={clip.type === 'video' || clip.type === 'audio' ? '留空' : undefined}
            onChange={(e) => {
              const raw = e.target.value;
              props.onChange({
                duration: raw === '' ? '' : Math.max(0.1, Number(raw))
              });
            }}
            className={`${INPUT_CLASS} placeholder:text-ink-muted/70`}
            disabled={disabled}
          />
        </label>
      </div>

      {clip.type === 'video' ? (
        <div className="mt-2 grid gap-2">
          <label className="text-[11px] text-ink-muted">
            视频素材
            <select
              value={clip.assetId}
              onChange={(e) => props.onChange({ assetId: e.target.value })}
              className={SELECT_CLASS}
              disabled={disabled}
            >
              <option value="">选择视频</option>
              {props.videoAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          {props.probedDuration ? (
            <p className="text-[10px] text-ink-muted">素材时长约 {props.probedDuration.toFixed(1)}s</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-muted">
              适应
              <select
                value={clip.fit}
                onChange={(e) =>
                  props.onChange({ fit: e.target.value as TimelineVideoClip['fit'] })
                }
                className={SELECT_CLASS}
                disabled={disabled}
              >
                {FIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-ink-muted">
              X 坐标
              <input type="number" value={clip.x} onChange={(e) => props.onChange({ x: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
            <label className="text-[11px] text-ink-muted">
              Y 坐标
              <input type="number" value={clip.y} onChange={(e) => props.onChange({ y: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
            <label className="text-[11px] text-ink-muted">
              宽度 (留空=全宽)
              <input
                type="number"
                value={clip.width}
                placeholder="留空"
                onChange={(e) => props.onChange({ width: e.target.value === '' ? '' : Number(e.target.value) })}
                className={`${INPUT_CLASS} placeholder:text-ink-muted/70`}
                disabled={disabled}
              />
            </label>
          </div>
        </div>
      ) : null}

      {clip.type === 'image' ? (
        <div className="mt-2 grid gap-2">
          <label className="text-[11px] text-ink-muted">
            图片素材
            <select
              value={clip.assetId}
              onChange={(e) => props.onChange({ assetId: e.target.value })}
              className={SELECT_CLASS}
              disabled={disabled}
            >
              <option value="">选择图片</option>
              {props.imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-muted">
              X 坐标
              <input type="number" value={clip.x} onChange={(e) => props.onChange({ x: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
            <label className="text-[11px] text-ink-muted">
              Y 坐标
              <input type="number" value={clip.y} onChange={(e) => props.onChange({ y: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
            <label className="text-[11px] text-ink-muted">
              宽度
              <input type="number" value={clip.width} onChange={(e) => props.onChange({ width: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
            <label className="text-[11px] text-ink-muted">
              高度
              <input type="number" value={clip.height} onChange={(e) => props.onChange({ height: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
          </div>
        </div>
      ) : null}

      {clip.type === 'text' ? (
        <div className="mt-2 grid gap-2">
          <textarea
            value={clip.content}
            onChange={(e) => props.onChange({ content: e.target.value })}
            rows={2}
            className="w-full rounded-[var(--radius-md)] border border-stone-strong bg-surface px-3 py-2 text-sm text-ink"
            placeholder="输入字幕"
            disabled={disabled}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-muted">
              字体
              <select
                value={clip.fontId}
                onChange={(e) => props.onChange({ fontId: e.target.value as ComposeFontId })}
                className={SELECT_CLASS}
                disabled={disabled}
              >
                {COMPOSE_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-ink-muted">
              字号
              <input type="number" min={8} max={256} value={clip.fontSize} onChange={(e) => props.onChange({ fontSize: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
            </label>
            <label className="text-[11px] text-ink-muted">
              位置
              <select
                value={clip.textPosition}
                onChange={(e) => props.onChange({ textPosition: e.target.value as TextPosition })}
                className={SELECT_CLASS}
                disabled={disabled}
              >
                {TEXT_POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {clip.textPosition !== 'center' ? (
              <label className="text-[11px] text-ink-muted">
                边距
                <input type="number" min={0} max={200} value={clip.textMargin} onChange={(e) => props.onChange({ textMargin: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {clip.type === 'audio' ? (
        <div className="mt-2 grid gap-2">
          <label className="text-[11px] text-ink-muted">
            音频素材
            <select
              value={clip.assetId}
              onChange={(e) => props.onChange({ assetId: e.target.value })}
              className={SELECT_CLASS}
              disabled={disabled}
            >
              <option value="">选择音频</option>
              {props.audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          {props.probedDuration ? (
            <p className="text-[10px] text-ink-muted">素材时长约 {props.probedDuration.toFixed(1)}s</p>
          ) : null}
          <label className="text-[11px] text-ink-muted">
            音量
            <input type="number" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => props.onChange({ volume: Number(e.target.value) })} className={INPUT_CLASS} disabled={disabled} />
          </label>
          <label className={CHECKBOX_LABEL_CLASS}>
            <input
              type="checkbox"
              checked={clip.loop}
              onChange={(e) => props.onChange({ loop: e.target.checked })}
              disabled={disabled}
              className={CHECKBOX_CLASS}
            />
            循环播放
          </label>
        </div>
      ) : null}
    </li>
  );
}

export function TimelineEditor(props: TimelineEditorProps): React.JSX.Element {
  const { clips, onClipsChange, disabled } = props;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const mediaAssets = useMemo(
    () =>
      [...props.videoAssets, ...props.audioAssets]
        .map((asset) => ({
          id: asset.id,
          type: asset.type as 'video' | 'audio',
          previewUrl: props.assetPreviewUrls[asset.id] ?? ''
        }))
        .filter((asset) => asset.previewUrl),
    [props.videoAssets, props.audioAssets, props.assetPreviewUrls]
  );

  const assetDurations = useMediaDurations(mediaAssets);
  const assetNames = useMemo(
    () =>
      Object.fromEntries(
        [...props.videoAssets, ...props.imageAssets, ...props.audioAssets].map((asset) => [asset.id, asset.name])
      ),
    [props.videoAssets, props.imageAssets, props.audioAssets]
  );

  const previewClips = useMemo(
    () => buildTimelinePreviewClips(clips, assetNames, assetDurations),
    [clips, assetNames, assetDurations]
  );

  const span = useMemo(
    () => computeTimelineSpan(clips, assetDurations, props.totalDuration),
    [clips, assetDurations, props.totalDuration]
  );

  const addClip = (type: TimelineClipType): void => {
    const defaultAssetId =
      type === 'video'
        ? (props.videoAssets[0]?.id ?? '')
        : type === 'image'
          ? (props.imageAssets[0]?.id ?? '')
          : type === 'audio'
            ? (props.audioAssets[0]?.id ?? '')
            : '';

    const clip = defaultTimelineClip(type, defaultAssetId);
    clip.start = suggestNextClipStart(clips, type);
    onClipsChange([...clips, clip]);
    setSelectedKey(clip.key);
  };

  const patchClip = (key: string, patch: Partial<TimelineClip>): void => {
    onClipsChange(updateClip(clips, key, patch));
  };

  const removeClip = (key: string): void => {
    onClipsChange(clips.filter((clip) => clip.key !== key));
    if (selectedKey === key) setSelectedKey(null);
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-stone bg-surface p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">时间线</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            按开始时间与时长定位片段，元素可重叠合成（非顺序拼接）。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addClip('video')} disabled={disabled || props.videoAssets.length === 0}>
            + 视频
          </button>
          <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addClip('image')} disabled={disabled || props.imageAssets.length === 0}>
            + 图片
          </button>
          <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addClip('text')} disabled={disabled}>
            + 文字
          </button>
          <button type="button" className="btn-ghost !cursor-pointer !px-3 !py-1.5 disabled:!cursor-not-allowed" onClick={() => addClip('audio')} disabled={disabled || props.audioAssets.length === 0}>
            + 音频
          </button>
        </div>
      </div>

      <TimelinePreview
        clips={previewClips}
        totalDuration={span}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />

      <label className="block text-[11px] text-ink-muted">
        总时长上限（可选，秒）
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={props.totalDuration}
          onChange={(e) =>
            props.onTotalDurationChange(e.target.value === '' ? '' : Number(e.target.value))
          }
          placeholder="留空则按片段自动计算"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-stone-strong bg-page px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted/70"
          disabled={disabled}
        />
      </label>

      {clips.length === 0 ? (
        <p className="text-xs text-ink-muted">添加片段并设置开始/时长，在时间轴上查看重叠关系。</p>
      ) : (
        <ul className="space-y-3">
          {clips.map((clip) => (
            <TimelineClipCard
              key={clip.key}
              clip={clip}
              videoAssets={props.videoAssets}
              imageAssets={props.imageAssets}
              audioAssets={props.audioAssets}
              selected={selectedKey === clip.key}
              probedDuration={
                clip.type === 'video' || clip.type === 'audio'
                  ? clip.assetId
                    ? assetDurations[clip.assetId]
                    : undefined
                  : undefined
              }
              disabled={disabled}
              onSelect={() => setSelectedKey(clip.key)}
              onChange={(patch) => patchClip(clip.key, patch)}
              onRemove={() => removeClip(clip.key)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
