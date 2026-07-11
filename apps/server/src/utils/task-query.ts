import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { queue, validateJobResult, type JobResult } from '~/queue';
import { TaskStatusSchema, type TaskStatus } from '@shared/queue/convert/schemas';

export interface ConvertTaskResponse {
  taskId: string;
  status: TaskStatus;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  progress?: number;
  result?: {
    contentType: string;
    filename: string;
    size: number;
    url?: string;
    downloadUrl?: string;
  };
  metadata?: Record<string, unknown>;
  error?: string;
}

function mapJobState(state: string): TaskStatus {
  if (state === 'active') return 'processing';
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  return 'queued';
}

function buildDownloadUrl(taskId: string): string {
  return `/convert/${taskId}?download=1`;
}

async function buildCompletedResult(
  taskId: string,
  jobResult: JobResult
): Promise<ConvertTaskResponse['result']> {
  if (jobResult.outputUrl) {
    return {
      contentType: 'video/mp4',
      filename: 'composed.mp4',
      size: 0,
      url: jobResult.outputUrl
    };
  }

  if (!jobResult.outputPath || !existsSync(jobResult.outputPath)) {
    return undefined;
  }

  const fileStat = await stat(jobResult.outputPath);
  return {
    contentType: 'video/mp4',
    filename: 'composed.mp4',
    size: fileStat.size,
    downloadUrl: buildDownloadUrl(taskId)
  };
}

export async function getConvertTask(taskId: string): Promise<ConvertTaskResponse | null> {
  const job = await queue.getJob(taskId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const status = mapJobState(state);
  const response: ConvertTaskResponse = {
    taskId,
    status,
    createdAt: job.timestamp,
    startedAt: job.processedOn,
    completedAt: job.finishedOn,
    progress: typeof job.progress === 'number' ? job.progress : undefined
  };

  if (status === 'completed') {
    const rawResult = job.returnvalue as unknown;
    try {
      const jobResult = validateJobResult(rawResult);
      if (!jobResult.success) {
        response.status = 'failed';
        response.error = jobResult.error ?? 'Convert task failed';
        return response;
      }

      response.result = await buildCompletedResult(taskId, jobResult);
      response.metadata = jobResult.metadata;
    } catch {
      response.status = 'failed';
      response.error = 'Invalid job result from worker';
    }
    return response;
  }

  if (status === 'failed') {
    response.error = job.failedReason ?? 'Convert task failed';
  }

  return response;
}

export async function readConvertTaskOutput(taskId: string): Promise<{
  buffer: Buffer;
  filename: string;
} | null> {
  const job = await queue.getJob(taskId);
  if (!job) return null;

  const state = await job.getState();
  if (state !== 'completed') return null;

  const jobResult = validateJobResult(job.returnvalue as unknown);
  if (!jobResult.success || !jobResult.outputPath || !existsSync(jobResult.outputPath)) {
    return null;
  }

  const buffer = await readFile(jobResult.outputPath);
  return {
    buffer,
    filename: 'composed.mp4'
  };
}

export { TaskStatusSchema };
