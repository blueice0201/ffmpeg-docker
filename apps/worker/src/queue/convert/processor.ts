import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { ConvertJobData } from '@shared/queue/convert/schemas';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { uploadToS3 } from '@worker/utils/storage';
import { composeSequential, composeTimeline } from './compose';

async function reportJobProgress(job: Job<ConvertJobData>, percent: number): Promise<void> {
  const rounded = Math.min(100, Math.max(0, Math.round(percent)));
  const current = typeof job.progress === 'number' ? job.progress : -1;
  if (rounded === current) {
    return;
  }
  await job.updateProgress(rounded);
}

export async function processVideoConvert(job: Job<ConvertJobData>): Promise<JobResult> {
  const { jobDir, outputPath, manifest, assetPaths, uploadToS3: shouldUpload } = job.data;

  for (const assetPath of Object.values(assetPaths)) {
    if (!existsSync(assetPath)) {
      return {
        success: false,
        error: `Asset file does not exist: ${assetPath}`
      };
    }
  }

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    const workDir = `${jobDir}/work`;
    await mkdir(workDir, { recursive: true });

    const onProgress = (percent: number) => {
      void reportJobProgress(job, percent);
    };

    if (manifest.mode === 'sequential') {
      await composeSequential(manifest, assetPaths, workDir, outputPath, onProgress);
    } else {
      await composeTimeline(manifest, assetPaths, workDir, outputPath, onProgress);
    }

    await reportJobProgress(job, 100);

    if (!existsSync(outputPath)) {
      return { success: false, error: 'Compose finished without output file' };
    }

    if (shouldUpload) {
      const upload = await uploadToS3(outputPath, 'video/mp4');
      return {
        success: true,
        outputUrl: upload.url,
        metadata: {
          mode: manifest.mode,
          storageKey: upload.key
        }
      };
    }

    return {
      success: true,
      outputPath,
      metadata: {
        mode: manifest.mode
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Video compose failed: ${message}`
    };
  }
}
