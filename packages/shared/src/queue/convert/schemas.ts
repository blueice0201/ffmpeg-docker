import { z } from 'zod';
import { COMPOSE_FONT_IDS } from './fonts';

export const ComposeFontIdSchema = z.enum(COMPOSE_FONT_IDS);

export const AssetIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

export const AssetSchema = z.object({
  id: AssetIdSchema,
  type: z.enum(['video', 'audio', 'image']),
  field: z.string().min(1)
});

export const OutputSchema = z.object({
  width: z.number().int().min(64).max(3840).default(1920),
  height: z.number().int().min(64).max(2160).default(1080),
  fps: z.number().min(1).max(60).default(30),
  crf: z.number().min(0).max(51).default(23),
  preset: z
    .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
    .default('medium'),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#000000')
});

export const FitSchema = z.enum(['contain', 'cover', 'fill']).default('contain');

export const TextPositionSchema = z.enum(['top', 'bottom', 'left', 'right', 'center']).default('bottom');

export const TextStyleSchema = z.object({
  fontSize: z.number().min(8).max(256).default(48),
  fontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#FFFFFF'),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
    .optional(),
  align: z.enum(['left', 'center', 'right']).default('center'),
  position: TextPositionSchema,
  margin: z.number().min(0).max(200).default(40),
  fontId: ComposeFontIdSchema.optional()
});

export const SequentialVideoSegmentSchema = z.object({
  type: z.literal('video'),
  assetId: AssetIdSchema,
  trimStart: z.number().min(0).optional(),
  trimEnd: z.number().min(0).optional(),
  keepAudio: z.boolean().default(true),
  fit: FitSchema.optional()
});

export const SequentialImageSegmentSchema = z.object({
  type: z.literal('image'),
  assetId: AssetIdSchema,
  duration: z.number().min(0.1).max(3600),
  fit: FitSchema.optional()
});

export const SequentialTextSegmentSchema = z.object({
  type: z.literal('text'),
  content: z.string().min(1).max(500),
  duration: z.number().min(0.1).max(3600),
  style: TextStyleSchema.optional()
});

export const SequentialSegmentSchema = z.discriminatedUnion('type', [
  SequentialVideoSegmentSchema,
  SequentialImageSegmentSchema,
  SequentialTextSegmentSchema
]);

export const SequentialAudioTrackSchema = z.object({
  assetId: AssetIdSchema,
  volume: z.number().min(0).max(2).default(1),
  loop: z.boolean().default(false),
  start: z.number().min(0).default(0),
  duration: z.number().min(0.1).optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional()
});

export const SequentialComposeManifestSchema = z.object({
  mode: z.literal('sequential'),
  output: OutputSchema.optional(),
  assets: z.array(AssetSchema).max(20),
  segments: z.array(SequentialSegmentSchema).min(1).max(100),
  audioTracks: z.array(SequentialAudioTrackSchema).max(10).optional()
});

export const TimelineVisualClipSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('video'),
    assetId: AssetIdSchema,
    start: z.number().min(0),
    duration: z.number().min(0.1).optional(),
    trimStart: z.number().min(0).default(0),
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    opacity: z.number().min(0).max(1).default(1),
    fit: FitSchema.optional()
  }),
  z.object({
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
  }),
  z.object({
    type: z.literal('text'),
    content: z.string().min(1).max(500),
    start: z.number().min(0),
    duration: z.number().min(0.1),
    x: z.number().optional(),
    y: z.number().optional(),
    style: TextStyleSchema.optional()
  })
]);

export const TimelineAudioClipSchema = z.object({
  assetId: AssetIdSchema,
  start: z.number().min(0),
  duration: z.number().min(0.1).optional(),
  trimStart: z.number().min(0).default(0),
  volume: z.number().min(0).max(2).default(1),
  loop: z.boolean().default(false),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional()
});

export const TimelineVideoTrackSchema = z.object({
  clips: z.array(TimelineVisualClipSchema).min(1).max(50)
});

export const TimelineAudioTrackSchema = z.object({
  clips: z.array(TimelineAudioClipSchema).min(1).max(50)
});

export const TimelineComposeManifestSchema = z.object({
  mode: z.literal('timeline'),
  output: OutputSchema.optional(),
  assets: z.array(AssetSchema).max(20),
  duration: z.number().min(0.1).max(7200).optional(),
  videoTracks: z.array(TimelineVideoTrackSchema).min(1).max(10),
  audioTracks: z.array(TimelineAudioTrackSchema).max(10).optional()
});

export const ComposeManifestSchema = z.discriminatedUnion('mode', [
  SequentialComposeManifestSchema,
  TimelineComposeManifestSchema
]);

export type ComposeManifest = z.infer<typeof ComposeManifestSchema>;
export type OutputConfig = z.infer<typeof OutputSchema>;
export type TextPosition = z.infer<typeof TextPositionSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const ConvertJobDataSchema = z.object({
  jobDir: z.string(),
  outputPath: z.string(),
  manifest: ComposeManifestSchema,
  assetPaths: z.record(z.string(), z.string()),
  uploadToS3: z.boolean().default(false)
});

export type ConvertJobData = z.infer<typeof ConvertJobDataSchema>;

export const TaskStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
