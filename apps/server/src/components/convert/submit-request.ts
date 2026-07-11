import type { Context } from 'hono';
import { submitConvertJob, type ComposeMode } from '~/utils/convert-handler';

function isFile(value: unknown): value is File {
  return value instanceof File;
}

export function collectConvertUploadedFiles(body: Record<string, unknown>): Map<string, File> {
  const files = new Map<string, File>();
  for (const [key, value] of Object.entries(body)) {
    if (key === 'manifest' || key === 'uploadToS3') continue;
    if (isFile(value)) {
      files.set(key, value);
    }
  }
  return files;
}

export async function handleConvertSubmit(c: Context, expectedMode?: ComposeMode): Promise<Response> {
  try {
    const body = await c.req.parseBody();
    const manifestRaw = body['manifest'];
    if (typeof manifestRaw !== 'string') {
      return c.json({ error: 'manifest is required and must be a JSON string' }, 400);
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      return c.json({ error: 'manifest must be valid JSON' }, 400);
    }

    const uploadFlag = body['uploadToS3'];
    const uploadToS3 = uploadFlag === 'true';

    const result = await submitConvertJob({
      manifest,
      files: collectConvertUploadedFiles(body as Record<string, unknown>),
      uploadToS3,
      expectedMode
    });

    if (!result.success) {
      return c.json({ error: result.error }, result.statusCode);
    }

    return c.json(
      {
        taskId: result.taskId,
        status: result.status
      },
      202
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ error: 'Failed to queue convert task', message: errorMessage }, 500);
  }
}
