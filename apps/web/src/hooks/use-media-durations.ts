import { useEffect, useState } from 'react';

type MediaKind = 'video' | 'audio';

interface MediaAsset {
  id: string;
  type: MediaKind;
  previewUrl: string;
}

function probeMediaDuration(previewUrl: string, kind: MediaKind): Promise<number | null> {
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    element.preload = 'metadata';
    element.src = previewUrl;

    const cleanup = (): void => {
      element.removeAttribute('src');
      element.load();
    };

    element.addEventListener(
      'loadedmetadata',
      () => {
        const duration = element.duration;
        cleanup();
        resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
      },
      { once: true }
    );

    element.addEventListener(
      'error',
      () => {
        cleanup();
        resolve(null);
      },
      { once: true }
    );
  });
}

export function useMediaDurations(assets: MediaAsset[]): Record<string, number> {
  const [durations, setDurations] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const entries = await Promise.all(
        assets.map(async (asset) => {
          const duration = await probeMediaDuration(asset.previewUrl, asset.type);
          return duration ? ([asset.id, duration] as const) : null;
        })
      );

      if (cancelled) return;

      const next: Record<string, number> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setDurations(next);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [assets]);

  return durations;
}
