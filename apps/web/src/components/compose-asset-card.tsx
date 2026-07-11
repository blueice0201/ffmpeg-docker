import { useEffect, useRef, useState } from 'react';

type AssetType = 'video' | 'audio' | 'image';

interface ComposeAssetCardProps {
  id: string;
  name: string;
  type: AssetType;
  file: File;
  previewUrl: string;
  typeLabel: string;
  playingAssetId: string | null;
  onPlayingChange: (id: string | null) => void;
  disabled?: boolean;
  onRemove: (id: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function AudioIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-10 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 10v4M3 9v6M19 10v4M21 9v6" strokeLinecap="round" />
      <path d="M9 8.5v7l6-3.5-6-3.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PlayIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? 'size-8 text-ink-inverted'} fill="currentColor">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

function PauseIcon(props: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={props.className ?? 'size-8 text-ink-inverted'} fill="currentColor">
      <path d="M7 6h3.5v12H7V6zm6.5 0H17v12h-3.5V6z" />
    </svg>
  );
}

function RemoveIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function MediaPlaybackOverlay(props: { playing: boolean }): React.JSX.Element {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-void/20 opacity-0 transition-opacity group-hover:opacity-100">
      <span className="flex size-12 items-center justify-center rounded-full bg-void/55 backdrop-blur-sm">
        {props.playing ? <PauseIcon /> : <PlayIcon />}
      </span>
    </span>
  );
}

function MediaProgressBar(props: {
  progress: number;
  disabled?: boolean;
  onSeek: (ratio: number) => void;
}): React.JSX.Element {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (props.disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    props.onSeek(ratio);
  };

  return (
    <div
      role="slider"
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.progress)}
      onClick={handleClick}
      className="absolute inset-x-0 bottom-0 z-20 h-1 cursor-pointer bg-void/45"
    >
      <div
        className="h-full bg-accent transition-[width] duration-75 ease-linear"
        style={{ width: `${Math.min(100, Math.max(0, props.progress))}%` }}
      />
    </div>
  );
}

function shouldShowProgress(progress: number, playing: boolean): boolean {
  if (playing) return true;
  return progress > 0 && progress < 100;
}

export function ComposeAssetCard(props: ComposeAssetCardProps): React.JSX.Element {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setDuration(null);
    setPlaying(false);
    setProgress(0);
  }, [props.previewUrl, props.type]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || props.type === 'image') return;
    if (props.playingAssetId !== props.id && !media.paused) {
      media.pause();
    }
  }, [props.playingAssetId, props.id, props.type]);

  const releasePlayback = (): void => {
    if (props.playingAssetId === props.id) {
      props.onPlayingChange(null);
    }
  };

  const handleLoadedMetadata = (): void => {
    const media = mediaRef.current;
    if (!media || props.type === 'image') return;
    setDuration(media.duration);
  };

  const handleTimeUpdate = (): void => {
    const media = mediaRef.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    setProgress((media.currentTime / media.duration) * 100);
  };

  const handleEnded = (): void => {
    const media = mediaRef.current;
    if (media) {
      media.currentTime = 0;
    }
    setPlaying(false);
    setProgress(0);
    releasePlayback();
  };

  const handleTogglePlayback = (): void => {
    if (props.disabled || props.type === 'image') return;

    const media = mediaRef.current;
    if (!media) return;

    if (media.paused) {
      props.onPlayingChange(props.id);
      void media.play();
      return;
    }

    media.pause();
  };

  const handleSeek = (ratio: number): void => {
    if (props.disabled || props.type === 'image') return;

    const media = mediaRef.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;

    const nextTime = ratio * media.duration;
    media.currentTime = nextTime;
    setProgress(ratio * 100);
  };

  const showProgress = shouldShowProgress(progress, playing);

  const metaLine =
    props.type === 'image'
      ? formatFileSize(props.file.size)
      : `${formatFileSize(props.file.size)} · ${formatDuration(duration ?? Number.NaN)}`;

  const mediaHandlers = {
    onLoadedMetadata: handleLoadedMetadata,
    onTimeUpdate: handleTimeUpdate,
    onEnded: handleEnded,
    onPause: () => {
      setPlaying(false);
      releasePlayback();
    },
    onPlay: () => {
      props.onPlayingChange(props.id);
      setPlaying(true);
    }
  };

  return (
    <article
      className={`group relative overflow-hidden rounded-[var(--radius-md)] border border-stone-strong bg-elevated ${
        props.type === 'image' ? 'cursor-pointer' : ''
      }`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-void">
        <span className="absolute left-2 top-2 z-10 rounded-full border border-stone-strong/60 bg-surface/90 px-2 py-0.5 text-[10px] font-medium text-ink-secondary backdrop-blur-sm">
          {props.typeLabel}
        </span>

        <button
          type="button"
          onClick={() => props.onRemove(props.id)}
          disabled={props.disabled}
          aria-label={`移除 ${props.name}`}
          className="absolute right-2 top-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border border-stone-strong/60 bg-surface/95 text-ink-muted opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:text-error disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-0"
        >
          <RemoveIcon />
        </button>

        {props.type === 'image' ? (
          <img src={props.previewUrl} alt={props.name} className="size-full object-cover" />
        ) : null}

        {props.type === 'video' ? (
          <div className="relative size-full">
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={props.previewUrl}
              className="size-full object-cover"
              preload="metadata"
              playsInline
              muted
              {...mediaHandlers}
            />
            <button
              type="button"
              onClick={handleTogglePlayback}
              disabled={props.disabled}
              className="absolute inset-0 z-10 cursor-pointer disabled:cursor-not-allowed"
              aria-label={playing ? `暂停 ${props.name}` : `播放 ${props.name}`}
            />
            <MediaPlaybackOverlay playing={playing} />
            {showProgress ? (
              <MediaProgressBar progress={progress} disabled={props.disabled} onSeek={handleSeek} />
            ) : null}
          </div>
        ) : null}

        {props.type === 'audio' ? (
          <div className="relative flex size-full flex-col items-center justify-center gap-2 bg-page">
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={props.previewUrl}
              preload="metadata"
              {...mediaHandlers}
            />
            <AudioIcon />
            <button
              type="button"
              onClick={handleTogglePlayback}
              disabled={props.disabled}
              className="absolute inset-0 z-10 cursor-pointer disabled:cursor-not-allowed"
              aria-label={playing ? `暂停 ${props.name}` : `播放 ${props.name}`}
            />
            <MediaPlaybackOverlay playing={playing} />
            {showProgress ? (
              <MediaProgressBar progress={progress} disabled={props.disabled} onSeek={handleSeek} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-0.5 px-3 py-2">
        <p className="truncate text-sm text-ink" title={props.name}>
          {props.name}
        </p>
        <p className="text-[11px] text-ink-muted">{metaLine}</p>
      </div>
    </article>
  );
}
