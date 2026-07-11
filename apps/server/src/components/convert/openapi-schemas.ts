import { z } from '@hono/zod-openapi';
import { COMPOSE_FONT_IDS } from '@shared/queue/convert/fonts';
import {
  SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE,
  TIMELINE_COMPOSE_MANIFEST_EXAMPLE
} from './openapi-examples';

const SEQUENTIAL_MANIFEST_WITHOUT_MODE = {
  output: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE.output,
  assets: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE.assets,
  segments: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE.segments,
  audioTracks: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE.audioTracks
};

const TIMELINE_MANIFEST_WITHOUT_MODE = {
  duration: TIMELINE_COMPOSE_MANIFEST_EXAMPLE.duration,
  output: TIMELINE_COMPOSE_MANIFEST_EXAMPLE.output,
  assets: TIMELINE_COMPOSE_MANIFEST_EXAMPLE.assets,
  videoTracks: TIMELINE_COMPOSE_MANIFEST_EXAMPLE.videoTracks,
  audioTracks: TIMELINE_COMPOSE_MANIFEST_EXAMPLE.audioTracks
};

const AssetIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .describe('Stable asset identifier referenced by segments or clips.');

export const ComposeAssetSchema = z
  .object({
    id: AssetIdSchema,
    type: z.enum(['video', 'audio', 'image']).describe('Asset media type.'),
    field: z
      .string()
      .min(1)
      .describe('Multipart form field name for this asset file (must match uploaded file field).')
  })
  .openapi('ComposeAsset');

export const ComposeOutputSchema = z
  .object({
    width: z.number().int().min(64).max(3840).default(1920).describe('Output video width in pixels.'),
    height: z.number().int().min(64).max(2160).default(1080).describe('Output video height in pixels.'),
    fps: z.number().min(1).max(60).default(30).describe('Output frame rate.'),
    crf: z.number().min(0).max(51).default(23).describe('x264 constant rate factor (lower = higher quality).'),
    preset: z
      .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
      .default('medium')
      .describe('x264 encoding preset.'),
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default('#000000')
      .describe('Hex background color for letterboxing and timeline canvas.')
  })
  .openapi('ComposeOutput');

const FitSchema = z.enum(['contain', 'cover', 'fill']).describe('How media is scaled into its target box.');

export const ComposeTextStyleSchema = z
  .object({
    fontSize: z.number().min(8).max(256).default(48),
    fontColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#FFFFFF'),
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
      .optional(),
    align: z.enum(['left', 'center', 'right']).default('center'),
    position: z.enum(['top', 'bottom', 'left', 'right', 'center']).default('bottom'),
    margin: z.number().min(0).max(200).default(40),
    fontId: z.enum(COMPOSE_FONT_IDS).optional().describe('Built-in CJK font id.')
  })
  .openapi('ComposeTextStyle');

export const SequentialVideoSegmentSchema = z
  .object({
    type: z.literal('video'),
    assetId: AssetIdSchema,
    trimStart: z.number().min(0).optional().describe('Trim start time in source video (seconds).'),
    trimEnd: z.number().min(0).optional().describe('Trim end time in source video (seconds).'),
    keepAudio: z.boolean().default(true).describe('Keep this video clip audio in the final mix.'),
    fit: FitSchema.optional()
  })
  .openapi('SequentialVideoSegment');

export const SequentialImageSegmentSchema = z
  .object({
    type: z.literal('image'),
    assetId: AssetIdSchema,
    duration: z.number().min(0.1).max(3600).describe('Full-screen slide duration in seconds.'),
    fit: FitSchema.optional()
  })
  .openapi('SequentialImageSegment');

export const SequentialTextSegmentSchema = z
  .object({
    type: z.literal('text'),
    content: z.string().min(1).max(500),
    duration: z.number().min(0.1).max(3600).describe('Full-screen text card duration in seconds.'),
    style: ComposeTextStyleSchema.optional()
  })
  .openapi('SequentialTextSegment');

export const SequentialSegmentSchema = z
  .discriminatedUnion('type', [
    SequentialVideoSegmentSchema,
    SequentialImageSegmentSchema,
    SequentialTextSegmentSchema
  ])
  .openapi('SequentialSegment');

export const SequentialAudioTrackSchema = z
  .object({
    assetId: AssetIdSchema,
    volume: z.number().min(0).max(2).default(1),
    loop: z.boolean().default(false),
    start: z.number().min(0).default(0).describe('Audio start offset on the final timeline (seconds).'),
    duration: z.number().min(0.1).optional().describe('Playback duration; omit to use source length or loop span.'),
    fadeIn: z.number().min(0).optional(),
    fadeOut: z.number().min(0).optional()
  })
  .openapi('SequentialAudioTrack');

export const SequentialComposeManifestSchema = z
  .object({
    mode: z.literal('sequential').describe('Concatenates segments back-to-back (each segment fills the frame).'),
    output: ComposeOutputSchema.optional(),
    assets: z.array(ComposeAssetSchema).max(20),
    segments: z
      .array(SequentialSegmentSchema)
      .min(1)
      .max(100)
      .describe('Ordered list of video/image/text segments to concatenate.'),
    audioTracks: z.array(SequentialAudioTrackSchema).max(10).optional()
  })
  .openapi('SequentialComposeManifest');

export const TimelineVideoClipSchema = z
  .object({
    type: z.literal('video'),
    assetId: AssetIdSchema,
    start: z.number().min(0).describe('Clip start time on the timeline (seconds).'),
    duration: z.number().min(0.1).optional().describe('Clip duration; omit to use probed source duration.'),
    trimStart: z.number().min(0).default(0),
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    opacity: z.number().min(0).max(1).default(1),
    fit: FitSchema.optional()
  })
  .openapi('TimelineVideoClip');

export const TimelineImageClipSchema = z
  .object({
    type: z.literal('image'),
    assetId: AssetIdSchema,
    start: z.number().min(0),
    duration: z.number().min(0.1),
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    opacity: z.number().min(0).max(1).default(1),
    fit: FitSchema.optional()
  })
  .openapi('TimelineImageClip');

export const TimelineTextClipSchema = z
  .object({
    type: z.literal('text'),
    content: z.string().min(1).max(500),
    start: z.number().min(0),
    duration: z.number().min(0.1),
    x: z.number().optional(),
    y: z.number().optional(),
    style: ComposeTextStyleSchema.optional()
  })
  .openapi('TimelineTextClip');

export const TimelineVisualClipSchema = z
  .discriminatedUnion('type', [TimelineVideoClipSchema, TimelineImageClipSchema, TimelineTextClipSchema])
  .openapi('TimelineVisualClip');

export const TimelineAudioClipSchema = z
  .object({
    assetId: AssetIdSchema,
    start: z.number().min(0),
    duration: z.number().min(0.1).optional(),
    trimStart: z.number().min(0).default(0),
    volume: z.number().min(0).max(2).default(1),
    loop: z.boolean().default(false),
    fadeIn: z.number().min(0).optional(),
    fadeOut: z.number().min(0).optional()
  })
  .openapi('TimelineAudioClip');

export const TimelineVideoTrackSchema = z
  .object({
    clips: z.array(TimelineVisualClipSchema).min(1).max(50)
  })
  .openapi('TimelineVideoTrack');

export const TimelineAudioTrackSchema = z
  .object({
    clips: z.array(TimelineAudioClipSchema).min(1).max(50)
  })
  .openapi('TimelineAudioTrack');

export const TimelineComposeManifestSchema = z
  .object({
    mode: z.literal('timeline').describe('Overlays clips on a shared timeline (clips may overlap).'),
    output: ComposeOutputSchema.optional(),
    assets: z.array(ComposeAssetSchema).max(20),
    duration: z
      .number()
      .min(0.1)
      .max(7200)
      .optional()
      .describe('Optional output duration cap in seconds.'),
    videoTracks: z
      .array(TimelineVideoTrackSchema)
      .min(1)
      .max(10)
      .describe('Visual tracks; clips from all tracks are merged by start time.'),
    audioTracks: z.array(TimelineAudioTrackSchema).max(10).optional()
  })
  .openapi('TimelineComposeManifest');

export const ComposeManifestSchema = z
  .discriminatedUnion('mode', [SequentialComposeManifestSchema, TimelineComposeManifestSchema])
  .openapi('ComposeManifest');

export const ComposeManifestDocumentationSchema = z
  .object({
    notes: z.array(z.string()),
    sequentialExample: SequentialComposeManifestSchema,
    timelineExample: TimelineComposeManifestSchema,
    composeManifest: ComposeManifestSchema
  })
  .openapi('ComposeManifestDocumentation');

function manifestFieldSchema(options: {
  schemaRef: 'SequentialComposeManifest' | 'TimelineComposeManifest' | 'ComposeManifest';
  example: Record<string, unknown>;
  modeNote: string;
}) {
  return z.string().openapi({
    description: [
      `Stringified JSON matching #/components/schemas/${options.schemaRef}.`,
      options.modeNote,
      'Upload one multipart file field per assets[].field (field name must match exactly).',
      'See GET /doc/compose-manifest for full schema reference and copy-paste examples.'
    ].join(' '),
    example: JSON.stringify(options.example, null, 2)
  });
}

export function sequentialManifestFieldSchema() {
  return manifestFieldSchema({
    schemaRef: 'SequentialComposeManifest',
    example: SEQUENTIAL_MANIFEST_WITHOUT_MODE,
    modeNote: 'mode is optional on /convert/sequential and defaults to "sequential".'
  });
}

export function timelineManifestFieldSchema() {
  return manifestFieldSchema({
    schemaRef: 'TimelineComposeManifest',
    example: TIMELINE_MANIFEST_WITHOUT_MODE,
    modeNote: 'mode is optional on /convert/timeline and defaults to "timeline".'
  });
}

export function composeManifestFieldSchema() {
  return manifestFieldSchema({
    schemaRef: 'ComposeManifest',
    example: SEQUENTIAL_COMPOSE_MANIFEST_EXAMPLE as unknown as Record<string, unknown>,
    modeNote: 'mode is required on /convert and must be "sequential" or "timeline".'
  });
}
