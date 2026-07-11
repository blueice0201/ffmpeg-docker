export const SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE = {
  mode: 'sequential' as const,
  output: {
    width: 1280,
    height: 720,
    fps: 30,
    preset: 'medium',
    backgroundColor: '#000000'
  },
  assets: [
    { id: 'clip', type: 'video', field: 'clip' },
    { id: 'slide', type: 'image', field: 'slide' },
    { id: 'bgm', type: 'audio', field: 'bgm' }
  ],
  segments: [
    { type: 'video', assetId: 'clip', keepAudio: false, fit: 'contain' },
    { type: 'image', assetId: 'slide', duration: 3, fit: 'contain' },
    {
      type: 'text',
      content: '欢迎观看',
      duration: 2,
      style: { position: 'bottom', fontSize: 48, fontId: 'noto-sans-sc', margin: 40 }
    }
  ],
  audioTracks: [{ assetId: 'bgm', volume: 0.5, loop: true, start: 0 }]
};

export const TIMELINE_COMPOSE_MANIFEST_EXAMPLE = {
  mode: 'timeline' as const,
  duration: 10,
  output: {
    width: 1280,
    height: 720,
    fps: 30,
    preset: 'medium',
    backgroundColor: '#000000'
  },
  assets: [
    { id: 'main', type: 'video', field: 'main' },
    { id: 'logo', type: 'image', field: 'logo' },
    { id: 'bgm', type: 'audio', field: 'bgm' }
  ],
  videoTracks: [
    {
      clips: [
        { type: 'video', assetId: 'main', start: 0, duration: 10, fit: 'contain' },
        {
          type: 'image',
          assetId: 'logo',
          start: 0,
          duration: 10,
          x: 20,
          y: 20,
          width: 240,
          height: 135,
          fit: 'contain'
        },
        {
          type: 'text',
          content: '字幕示例',
          start: 2,
          duration: 5,
          style: { position: 'bottom', fontSize: 48, fontId: 'noto-sans-sc', margin: 40 }
        }
      ]
    }
  ],
  audioTracks: [
    {
      clips: [{ assetId: 'bgm', start: 0, volume: 0.8, loop: true }]
    }
  ]
};

export const COMPOSE_MANIFEST_UPLOAD_NOTES = [
  'Submit manifest as a JSON string in the multipart field "manifest".',
  'Upload one binary file per assets[].field using the same field name (e.g. assets[].field="clip" → form field clip=@video.mp4).',
  'Sequential mode concatenates full-screen segments in order. Timeline mode overlays clips by start time (elements may overlap).',
  'Poll GET /convert/{taskId} for status; download with GET /convert/{taskId}?download=1 when completed.'
] as const;

export function stringifyManifestExample(example: Record<string, unknown>): string {
  return JSON.stringify(example, null, 2);
}
