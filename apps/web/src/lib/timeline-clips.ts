import { DEFAULT_COMPOSE_FONT_ID, type ComposeFontId } from '@shared/queue/convert/fonts';
import type { TextPosition } from '@shared/queue/convert/schemas';

export type TimelineClipType = 'video' | 'image' | 'text' | 'audio';
export type TimelineVisualTrack = 'video' | 'image' | 'text';

export interface TimelineClipBase {
  key: string;
  start: number;
  /** Empty string means use source media length (video/audio only). */
  duration: number | '';
}

export interface TimelineVideoClip extends TimelineClipBase {
  type: 'video';
  assetId: string;
  fit: 'contain' | 'cover' | 'fill';
  x: number;
  y: number;
  width: number | '';
  height: number | '';
}

export interface TimelineImageClip extends TimelineClipBase {
  type: 'image';
  assetId: string;
  fit: 'contain' | 'cover' | 'fill';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineTextClip extends TimelineClipBase {
  type: 'text';
  content: string;
  fontSize: number;
  fontId: ComposeFontId;
  textPosition: TextPosition;
  textMargin: number;
}

export interface TimelineAudioClip extends TimelineClipBase {
  type: 'audio';
  assetId: string;
  volume: number;
  loop: boolean;
}

export type TimelineClip = TimelineVideoClip | TimelineImageClip | TimelineTextClip | TimelineAudioClip;

export interface TimelinePreviewClip {
  key: string;
  track: TimelineVisualTrack | 'audio';
  type: TimelineClipType;
  label: string;
  start: number;
  duration: number;
  end: number;
  durationEstimated: boolean;
}

export const TIMELINE_TRACK_ORDER = ['video', 'image', 'text', 'audio'] as const;

export const TIMELINE_TRACK_LABELS: Record<(typeof TIMELINE_TRACK_ORDER)[number], string> = {
  video: '视频',
  image: '图片',
  text: '文字',
  audio: '音频'
};

const FALLBACK_MEDIA_DURATION = 10;

export function createTimelineClipKey(): string {
  return `tl_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultTimelineClip(type: TimelineClipType, assetId = ''): TimelineClip {
  const key = createTimelineClipKey();
  if (type === 'video') {
    return {
      key,
      type: 'video',
      assetId,
      start: 0,
      duration: '',
      fit: 'contain',
      x: 0,
      y: 0,
      width: '',
      height: ''
    };
  }
  if (type === 'image') {
    return {
      key,
      type: 'image',
      assetId,
      start: 0,
      duration: 3,
      fit: 'contain',
      x: 20,
      y: 20,
      width: 240,
      height: 135
    };
  }
  if (type === 'text') {
    return {
      key,
      type: 'text',
      content: '字幕示例',
      start: 0,
      duration: 3,
      fontSize: 48,
      fontId: DEFAULT_COMPOSE_FONT_ID,
      textPosition: 'bottom',
      textMargin: 40
    };
  }
  return {
    key,
    type: 'audio',
    assetId,
    start: 0,
    duration: '',
    volume: 0.8,
    loop: false
  };
}

export function timelineClipTrack(clip: TimelineClip): TimelinePreviewClip['track'] {
  return clip.type;
}

export function resolveClipDuration(
  clip: TimelineClip,
  assetDurations: Record<string, number>
): { duration: number; estimated: boolean } {
  if (clip.type === 'image' || clip.type === 'text') {
    const duration = typeof clip.duration === 'number' ? clip.duration : 0;
    return { duration: Math.max(0.1, duration), estimated: false };
  }

  if (clip.duration !== '' && clip.duration > 0) {
    return { duration: clip.duration, estimated: false };
  }

  const probed = clip.assetId ? assetDurations[clip.assetId] : undefined;
  if (probed && probed > 0) {
    return { duration: probed, estimated: false };
  }

  return { duration: FALLBACK_MEDIA_DURATION, estimated: true };
}

export function buildTimelinePreviewClips(
  clips: TimelineClip[],
  assetNames: Record<string, string>,
  assetDurations: Record<string, number>
): TimelinePreviewClip[] {
  return clips.map((clip) => {
    const { duration, estimated } = resolveClipDuration(clip, assetDurations);
    const start = Math.max(0, clip.start);

    let label = TIMELINE_TRACK_LABELS[clip.type];
    if (clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') {
      label = assetNames[clip.assetId] ?? label;
    } else if (clip.type === 'text') {
      const preview = clip.content.trim();
      label = preview.length > 16 ? `${preview.slice(0, 16)}…` : preview || '文字';
    }

    return {
      key: clip.key,
      track: timelineClipTrack(clip),
      type: clip.type,
      label,
      start,
      duration,
      end: start + duration,
      durationEstimated: estimated
    };
  });
}

export function computeTimelineSpan(
  clips: TimelineClip[],
  assetDurations: Record<string, number>,
  totalDurationOverride: number | ''
): number {
  if (totalDurationOverride !== '' && totalDurationOverride > 0) {
    return totalDurationOverride;
  }

  let span = 0;
  for (const clip of clips) {
    const { duration } = resolveClipDuration(clip, assetDurations);
    span = Math.max(span, Math.max(0, clip.start) + duration);
  }

  return span > 0 ? span : 1;
}

export function buildTimelineManifest(
  clips: TimelineClip[],
  totalDuration: number | '',
  output: { width: number; height: number; fps: number },
  manifestAssets: Array<{ id: string; type: string; field: string }>
): {
  mode: 'timeline';
  output: typeof output;
  assets: typeof manifestAssets;
  duration?: number;
  videoTracks: Array<{ clips: unknown[] }>;
  audioTracks?: Array<{ clips: unknown[] }>;
} {
  const visualClips = clips.filter((clip) => clip.type !== 'audio').map((clip) => {
    if (clip.type === 'video') {
      return {
        type: 'video' as const,
        assetId: clip.assetId,
        start: clip.start,
        ...(clip.duration !== '' ? { duration: clip.duration } : {}),
        x: clip.x,
        y: clip.y,
        ...(clip.width !== '' ? { width: clip.width } : {}),
        ...(clip.height !== '' ? { height: clip.height } : {}),
        fit: clip.fit
      };
    }
    if (clip.type === 'image') {
      return {
        type: 'image' as const,
        assetId: clip.assetId,
        start: clip.start,
        duration: clip.duration,
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        fit: clip.fit
      };
    }
    return {
      type: 'text' as const,
      content: clip.content.trim(),
      start: clip.start,
      duration: clip.duration,
      style: {
        fontSize: clip.fontSize,
        fontId: clip.fontId,
        position: clip.textPosition,
        margin: clip.textMargin
      }
    };
  });

  const audioClips = clips
    .filter((clip) => clip.type === 'audio')
    .map((clip) => ({
      assetId: clip.assetId,
      start: clip.start,
      volume: clip.volume,
      loop: clip.loop,
      ...(clip.duration !== '' ? { duration: clip.duration } : {})
    }));

  return {
    mode: 'timeline',
    output,
    assets: manifestAssets,
    ...(totalDuration !== '' ? { duration: totalDuration } : {}),
    videoTracks: [{ clips: visualClips }],
    audioTracks: audioClips.length > 0 ? [{ clips: audioClips }] : undefined
  };
}

export function validateTimelineClips(clips: TimelineClip[]): string | null {
  if (clips.length === 0) return '请至少添加一个时间线片段。';

  const hasVisual = clips.some((clip) => clip.type !== 'audio');
  if (!hasVisual) return '时间线至少需要一段视频、图片或文字（画布内容）。';

  for (const clip of clips) {
    if (clip.start < 0) return '开始时间不能为负数。';

    if (clip.type === 'text') {
      if (!clip.content.trim()) return '文字片段内容不能为空。';
      if (typeof clip.duration !== 'number' || clip.duration <= 0) return '文字片段时长必须大于 0。';
      continue;
    }

    if (clip.type === 'image') {
      if (!clip.assetId) return '存在未选择素材的图片片段。';
      if (typeof clip.duration !== 'number' || clip.duration <= 0) return '图片片段时长必须大于 0。';
      continue;
    }

    if (!clip.assetId) return `存在未选择素材的${TIMELINE_TRACK_LABELS[clip.type]}片段。`;
    if (clip.duration !== '' && clip.duration <= 0) {
      return `${TIMELINE_TRACK_LABELS[clip.type]}片段时长必须大于 0。`;
    }
  }

  return null;
}

export function suggestNextClipStart(clips: TimelineClip[], type: TimelineClipType): number {
  const sameType = clips.filter((clip) => clip.type === type);
  if (sameType.length === 0) return 0;

  let maxEnd = 0;
  for (const clip of sameType) {
    const duration =
      clip.type === 'image' || clip.type === 'text'
        ? clip.duration
        : clip.duration !== ''
          ? clip.duration
          : 0;
    maxEnd = Math.max(maxEnd, clip.start + (typeof duration === 'number' ? duration : 0));
  }
  return maxEnd;
}
