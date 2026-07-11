export type ConvertTaskStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ConvertTaskResult {
  contentType: string;
  filename: string;
  size: number;
  url?: string;
  downloadUrl?: string;
}

export interface ConvertTaskResponse {
  taskId: string;
  status: ConvertTaskStatus;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  progress?: number;
  result?: ConvertTaskResult;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface SubmitConvertResponse {
  taskId: string;
  status: 'queued';
}

export class ConvertTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'ConvertTaskNotFoundError';
  }
}

async function parseApiError(response: Response, endpoint: string): Promise<Error> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      const message = payload.message || payload.error;
      if (message) return new Error(message);
    } catch {
      return new Error(`Request failed (${response.status})`);
    }
  }
  if (contentType.includes('text/html')) {
    return new Error(`Received HTML from ${endpoint}. Check apps/web/.env BACKEND_URL.`);
  }
  const body = await response.text();
  return new Error(body.trim() || `Request failed (${response.status})`);
}

export async function submitConvertTask(
  manifest: unknown,
  files: Map<string, File>
): Promise<SubmitConvertResponse> {
  const formData = new FormData();
  formData.append('manifest', JSON.stringify(manifest));
  for (const [field, file] of files.entries()) {
    formData.append(field, file, file.name);
  }

  const response = await fetch('/api/convert', { method: 'POST', body: formData });
  if (!response.ok) {
    throw await parseApiError(response, '/api/convert');
  }

  return (await response.json()) as SubmitConvertResponse;
}

export async function fetchConvertTask(taskId: string): Promise<ConvertTaskResponse | null> {
  const response = await fetch(`/api/convert/${taskId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await parseApiError(response, `/api/convert/${taskId}`);
  }
  return (await response.json()) as ConvertTaskResponse;
}

export async function downloadConvertResult(taskId: string): Promise<Blob> {
  const response = await fetch(`/api/convert/${taskId}?download=1`);
  if (!response.ok) {
    throw await parseApiError(response, `/api/convert/${taskId}?download=1`);
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error('Download returned an empty file');
  }
  return blob;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queuedTask(taskId: string): ConvertTaskResponse {
  return { taskId, status: 'queued' };
}

export async function pollConvertTask(
  taskId: string,
  onUpdate: (task: ConvertTaskResponse) => void,
  intervalMs = 1500,
  timeoutMs = 600000,
  notFoundGraceMs = 15000
): Promise<ConvertTaskResponse> {
  const started = Date.now();
  let sawTask = false;

  await sleep(Math.min(intervalMs, 500));

  while (Date.now() - started < timeoutMs) {
    const task = await fetchConvertTask(taskId);

    if (task) {
      sawTask = true;
      onUpdate(task);
      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }
    } else if (!sawTask && Date.now() - started < notFoundGraceMs) {
      onUpdate(queuedTask(taskId));
    } else {
      throw new ConvertTaskNotFoundError(taskId);
    }

    await sleep(intervalMs);
  }

  throw new Error('Timed out waiting for compose task');
}
