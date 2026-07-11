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

export type ConvertSubmitHandlerResult =
  | { ok: true; taskId: string; status: 'queued' }
  | { ok: false; statusCode: 400 | 413 | 500; body: { error: string; message?: string } };

export async function parseAndSubmitConvert(
  c: Context,
  expectedMode?: ComposeMode
): Promise<ConvertSubmitHandlerResult> {
  try {
    const body = await c.req.parseBody();
    const manifestRaw = body['manifest'];
    if (typeof manifestRaw !== 'string') {
      return { ok: false, statusCode: 400, body: { error: 'manifest is required and must be a JSON string' } };
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      return { ok: false, statusCode: 400, body: { error: 'manifest must be valid JSON' } };
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
      return { ok: false, statusCode: result.statusCode, body: { error: result.error } };
    }

    return {
      ok: true,
      taskId: result.taskId,
      status: result.status
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      statusCode: 500,
      body: { error: 'Failed to queue convert task', message: errorMessage }
    };
  }
}
