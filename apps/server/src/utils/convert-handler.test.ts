import { describe, expect, it } from 'vitest';
import { normalizeComposeManifest } from './convert-handler';

describe('normalizeComposeManifest', () => {
  it('passes through manifest when mode is set and no expected mode', () => {
    const manifest = { mode: 'sequential', assets: [], segments: [] };
    expect(normalizeComposeManifest(manifest)).toEqual({ success: true, value: manifest });
  });

  it('requires mode on generic /convert endpoint', () => {
    expect(normalizeComposeManifest({ assets: [], segments: [] })).toEqual({
      success: false,
      error:
        'manifest.mode is required. Use "sequential" or "timeline", or submit to /convert/sequential or /convert/timeline.'
    });
  });

  it('rejects empty mode on generic /convert endpoint', () => {
    expect(normalizeComposeManifest({ mode: '', assets: [], segments: [] })).toEqual({
      success: false,
      error:
        'manifest.mode is required. Use "sequential" or "timeline", or submit to /convert/sequential or /convert/timeline.'
    });
  });

  it('injects sequential mode when missing on sequential endpoint', () => {
    const manifest = { assets: [], segments: [] };
    expect(normalizeComposeManifest(manifest, 'sequential')).toEqual({
      success: true,
      value: { assets: [], segments: [], mode: 'sequential' }
    });
  });

  it('injects timeline mode when missing on timeline endpoint', () => {
    const manifest = { assets: [], videoTracks: [{ clips: [] }] };
    expect(normalizeComposeManifest(manifest, 'timeline')).toEqual({
      success: true,
      value: { assets: [], videoTracks: [{ clips: [] }], mode: 'timeline' }
    });
  });

  it('rejects mismatched mode', () => {
    const manifest = { mode: 'timeline', assets: [], videoTracks: [{ clips: [] }] };
    expect(normalizeComposeManifest(manifest, 'sequential')).toEqual({
      success: false,
      error: 'Manifest mode must be "sequential" for this endpoint (received "timeline")'
    });
  });

  it('rejects non-object manifest', () => {
    expect(normalizeComposeManifest('bad')).toEqual({
      success: false,
      error: 'manifest must be a JSON object'
    });
  });
});
