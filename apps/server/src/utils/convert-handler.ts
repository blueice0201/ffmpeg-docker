import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '~/config/env';
import { logger } from '~/config/logger';
import { addJob, JobType } from '~/queue';
import {
  ComposeManifestSchema,
  type ComposeManifest
} from '@shared/queue/convert/schemas';

export type ComposeMode = 'sequential' | 'timeline';

export interface SubmitConvertOptions {
  manifest: unknown;
  files: Map<string, File>;
  uploadToS3?: boolean;
  expectedMode?: ComposeMode;
}

export interface SubmitConvertResult {
  success: true;
  taskId: string;
  status: 'queued';
}

export interface SubmitConvertError {
  success: false;
  error: string;
  statusCode: 400 | 413;
}

function validateManifestAssets(manifest: ComposeManifest, files: Map<string, File>): string | null {
  const assetIds = new Set(manifest.assets.map((asset) => asset.id));

  for (const asset of manifest.assets) {
    const file = files.get(asset.field);
    if (!file) {
      return `Missing upload field "${asset.field}" for asset "${asset.id}"`;
    }
    if (file.size > env.MAX_FILE_SIZE) {
      return `File "${asset.field}" exceeds MAX_FILE_SIZE (${env.MAX_FILE_SIZE} bytes)`;
    }
  }

  let totalSize = 0;
  for (const file of files.values()) {
    totalSize += file.size;
  }
  if (totalSize > env.CONVERT_MAX_TOTAL_SIZE) {
    return `__PAYLOAD_TOO_LARGE__:Total upload size exceeds CONVERT_MAX_TOTAL_SIZE (${env.CONVERT_MAX_TOTAL_SIZE} bytes)`;
  }

  const referencedAssetIds = new Set<string>();
  if (manifest.mode === 'sequential') {
    for (const segment of manifest.segments) {
      if ('assetId' in segment) {
        referencedAssetIds.add(segment.assetId);
      }
    }
    for (const track of manifest.audioTracks ?? []) {
      referencedAssetIds.add(track.assetId);
    }
  } else {
    for (const track of manifest.videoTracks) {
      for (const clip of track.clips) {
        if ('assetId' in clip) {
          referencedAssetIds.add(clip.assetId);
        }
      }
    }
    for (const track of manifest.audioTracks ?? []) {
      for (const clip of track.clips) {
        referencedAssetIds.add(clip.assetId);
      }
    }
  }

  for (const assetId of referencedAssetIds) {
    if (!assetIds.has(assetId)) {
      return `Manifest references unknown asset "${assetId}"`;
    }
  }

  return null;
}

export function normalizeComposeManifest(
  manifest: unknown,
  expectedMode?: ComposeMode
): { success: true; value: unknown } | { success: false; error: string } {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return { success: false, error: 'manifest must be a JSON object' };
  }

  const record = manifest as Record<string, unknown>;
  const mode = record.mode;

  if (expectedMode) {
    if (mode === undefined || mode === null || mode === '') {
      return { success: true, value: { ...record, mode: expectedMode } };
    }
    if (mode !== expectedMode) {
      return {
        success: false,
        error: `Manifest mode must be "${expectedMode}" for this endpoint (received "${String(mode)}")`
      };
    }
    return { success: true, value: manifest };
  }

  if (mode === undefined || mode === null || mode === '') {
    return {
      success: false,
      error:
        'manifest.mode is required. Use "sequential" or "timeline", or submit to /convert/sequential or /convert/timeline.'
    };
  }

  return { success: true, value: manifest };
}

export async function submitConvertJob(
  options: SubmitConvertOptions
): Promise<SubmitConvertResult | SubmitConvertError> {
  const normalized = normalizeComposeManifest(options.manifest, options.expectedMode);
  if (!normalized.success) {
    return {
      success: false,
      statusCode: 400,
      error: normalized.error
    };
  }

  const parsed = ComposeManifestSchema.safeParse(normalized.value);
  if (!parsed.success) {
    return {
      success: false,
      statusCode: 400,
      error: `Invalid manifest: ${parsed.error.message}`
    };
  }

  const manifest = parsed.data;
  const assetError = validateManifestAssets(manifest, options.files);
  if (assetError) {
    const statusCode = assetError.startsWith('__PAYLOAD_TOO_LARGE__:') ? 413 : 400;
    return {
      success: false,
      statusCode,
      error: assetError.replace('__PAYLOAD_TOO_LARGE__:', '')
    };
  }

  const taskId = randomUUID();
  const jobDir = path.join(env.TEMP_DIR, 'convert', taskId);
  const assetsDir = path.join(jobDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const assetPaths: Record<string, string> = {};

  for (const asset of manifest.assets) {
    const file = options.files.get(asset.field);
    if (!file) {
      return {
        success: false,
        statusCode: 400,
        error: `Missing upload field "${asset.field}"`
      };
    }

    const extension = path.extname(file.name) || '.bin';
    const assetPath = path.join(assetsDir, `${asset.id}${extension}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(assetPath, buffer);
    assetPaths[asset.id] = assetPath;
  }

  const outputPath = path.join(jobDir, 'output.mp4');

  try {
    const job = await addJob(
      JobType.VIDEO_CONVERT,
      {
        jobDir,
        outputPath,
        manifest,
        assetPaths,
        uploadToS3: options.uploadToS3 ?? false
      },
      { jobId: taskId }
    );

    logger.info({ taskId: job.id, mode: manifest.mode }, 'Convert task queued');

    return {
      success: true,
      taskId: job.id ?? taskId,
      status: 'queued'
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      statusCode: 400,
      error: errorMessage
    };
  }
}
