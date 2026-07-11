import {
  TIMELINE_TRACK_LABELS,
  TIMELINE_TRACK_ORDER,
  type TimelinePreviewClip
} from '~/lib/timeline-clips';

interface TimelinePreviewProps {
  clips: TimelinePreviewClip[];
  totalDuration: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

const TRACK_BAR_CLASS: Record<(typeof TIMELINE_TRACK_ORDER)[number], string> = {
  video: 'bg-accent/80 border-accent/40',
  image: 'bg-signal/80 border-signal/40',
  text: 'bg-info/80 border-info/40',
  audio: 'bg-success/80 border-success/40'
};

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toFixed(0).padStart(2, '0')}`;
}

function rulerTicks(totalDuration: number): number[] {
  const tickCount = totalDuration <= 10 ? 5 : totalDuration <= 30 ? 6 : 8;
  const step = totalDuration / tickCount;
  return Array.from({ length: tickCount + 1 }, (_, index) => step * index);
}

export function TimelinePreview(props: TimelinePreviewProps): React.JSX.Element {
  const { clips, totalDuration, selectedKey, onSelect } = props;
  const ticks = rulerTicks(totalDuration);

  const clipsByTrack = Object.fromEntries(
    TIMELINE_TRACK_ORDER.map((track) => [track, clips.filter((clip) => clip.track === track)])
  ) as Record<(typeof TIMELINE_TRACK_ORDER)[number], TimelinePreviewClip[]>;

  if (clips.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-stone-strong bg-page px-3 py-6 text-center text-xs text-ink-muted">
        添加片段后，此处会显示简单时间轴预览（按开始时间与时长定位，可重叠）。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-ink-secondary">时间轴预览</p>
        <p className="text-[10px] text-ink-muted">总长 {formatTime(totalDuration)}</p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-stone-strong bg-page p-3">
        <div className="min-w-[480px] space-y-2">
          <div className="relative h-4 border-b border-stone-strong/80">
            {ticks.map((tick) => {
              const left = (tick / totalDuration) * 100;
              return (
                <div
                  key={tick}
                  className="absolute top-0 flex h-full flex-col items-center"
                  style={{ left: `${left}%`, transform: 'translateX(-50%)' }}
                >
                  <span className="h-2 w-px bg-stone-strong" />
                  <span className="mt-0.5 text-[9px] tabular-nums text-ink-muted">{formatTime(tick)}</span>
                </div>
              );
            })}
          </div>

          {TIMELINE_TRACK_ORDER.map((track) => {
            const trackClips = clipsByTrack[track];
            return (
              <div key={track} className="grid grid-cols-[52px_1fr] items-center gap-2">
                <span className="text-[10px] text-ink-muted">{TIMELINE_TRACK_LABELS[track]}</span>
                <div className="relative h-8 rounded-[var(--radius-sm)] bg-elevated/60">
                  {trackClips.length === 0 ? (
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-ink-muted/70">—</span>
                  ) : (
                    trackClips.map((clip) => {
                      const left = (clip.start / totalDuration) * 100;
                      const width = Math.max(2, (clip.duration / totalDuration) * 100);
                      const selected = selectedKey === clip.key;
                      return (
                        <button
                          key={clip.key}
                          type="button"
                          title={`${clip.label} · ${formatTime(clip.start)} – ${formatTime(clip.end)}${clip.durationEstimated ? ' (时长估算)' : ''}`}
                          onClick={() => onSelect(clip.key)}
                          className={`absolute top-1 bottom-1 overflow-hidden rounded-[var(--radius-sm)] border px-1 text-left text-[9px] leading-tight text-ink transition-shadow ${TRACK_BAR_CLASS[track]} ${selected ? 'ring-2 ring-ink/80 ring-offset-1 ring-offset-page' : 'hover:brightness-110'}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <span className="block truncate font-medium">{clip.label}</span>
                          <span className="block truncate opacity-80">
                            {formatTime(clip.start)}–{formatTime(clip.end)}
                            {clip.durationEstimated ? '*' : ''}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-ink-muted">
        * 未指定时长的视频/音频使用素材探测时长；探测失败时预览按 10s 估算。重叠区域表示同时出现在画面上。
      </p>
    </div>
  );
}
