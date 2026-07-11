import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '~/app';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { Worker } from 'bullmq';
import { createTestWorker } from '~/test-utils/worker';
import { createTestAviFile, createTestPngFile } from '~/test-utils/fixtures';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'convert-controller');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'convert-controller');

async function waitForTask(app: ReturnType<typeof createApp>, taskId: string, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await app.request(`/convert/${taskId}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; error?: string };
    if (json.status === 'completed') return json;
    if (json.status === 'failed') {
      throw new Error(json.error ?? 'Convert task failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for convert task');
}

describe('Convert Controller', () => {
  const app = createApp();
  let worker: Worker;

  beforeAll(async () => {
    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    worker = createTestWorker();
  });

  afterAll(async () => {
    await worker?.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    if (existsSync(FIXTURES_DIR)) rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it('should queue sequential convert task and return MP4 on download', async () => {
    const videoPath = path.join(FIXTURES_DIR, 'clip.avi');
    const imagePath = path.join(FIXTURES_DIR, 'slide.png');
    createTestAviFile(videoPath);
    createTestPngFile(imagePath);

    const manifest = {
      mode: 'sequential',
      output: { width: 640, height: 360, fps: 24, preset: 'ultrafast' },
      assets: [
        { id: 'clip', type: 'video', field: 'clip' },
        { id: 'slide', type: 'image', field: 'slide' }
      ],
      segments: [
        { type: 'video', assetId: 'clip', keepAudio: false },
        { type: 'image', assetId: 'slide', duration: 1, fit: 'contain' },
        { type: 'text', content: 'Hello', duration: 1 }
      ]
    };

    const formData = new FormData();
    formData.append('manifest', JSON.stringify(manifest));
    formData.append('clip', new File([readFileSync(videoPath)], 'clip.avi', { type: 'video/x-msvideo' }));
    formData.append('slide', new File([readFileSync(imagePath)], 'slide.png', { type: 'image/png' }));

    const submitRes = await app.request('/convert', { method: 'POST', body: formData });
    expect(submitRes.status).toBe(202);
    const submitJson = (await submitRes.json()) as { taskId: string; status: string };
    expect(submitJson.status).toBe('queued');
    expect(submitJson.taskId).toMatch(/^[0-9a-f-]{36}$/);

    const completed = await waitForTask(app, submitJson.taskId);
    expect(completed.status).toBe('completed');

    const downloadRes = await app.request(`/convert/${submitJson.taskId}?download=1`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-type')).toContain('video/mp4');
    const buffer = await downloadRes.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('should queue sequential convert task via /convert/sequential without mode field', async () => {
    const videoPath = path.join(FIXTURES_DIR, 'clip-seq.avi');
    createTestAviFile(videoPath);

    const manifest = {
      output: { width: 640, height: 360, fps: 24, preset: 'ultrafast' },
      assets: [{ id: 'clip', type: 'video', field: 'clip' }],
      segments: [{ type: 'video', assetId: 'clip', keepAudio: false }]
    };

    const formData = new FormData();
    formData.append('manifest', JSON.stringify(manifest));
    formData.append('clip', new File([readFileSync(videoPath)], 'clip.avi', { type: 'video/x-msvideo' }));

    const submitRes = await app.request('/convert/sequential', { method: 'POST', body: formData });
    expect(submitRes.status).toBe(202);
    const submitJson = (await submitRes.json()) as { taskId: string; status: string };
    expect(submitJson.status).toBe('queued');

    const completed = await waitForTask(app, submitJson.taskId);
    expect(completed.status).toBe('completed');
  });

  it('should queue timeline convert task via /convert/timeline', async () => {
    const videoPath = path.join(FIXTURES_DIR, 'clip-tl.avi');
    const imagePath = path.join(FIXTURES_DIR, 'overlay-tl.png');
    createTestAviFile(videoPath);
    createTestPngFile(imagePath, 160, 120);

    const manifest = {
      duration: 2,
      output: { width: 640, height: 360, fps: 24, preset: 'ultrafast', backgroundColor: '#101010' },
      assets: [
        { id: 'main', type: 'video', field: 'main' },
        { id: 'overlay', type: 'image', field: 'overlay' }
      ],
      videoTracks: [
        {
          clips: [
            { type: 'video', assetId: 'main', start: 0, duration: 2 },
            {
              type: 'image',
              assetId: 'overlay',
              start: 0,
              duration: 2,
              x: 10,
              y: 10,
              width: 80,
              height: 60
            }
          ]
        }
      ]
    };

    const formData = new FormData();
    formData.append('manifest', JSON.stringify(manifest));
    formData.append('main', new File([readFileSync(videoPath)], 'main.avi', { type: 'video/x-msvideo' }));
    formData.append('overlay', new File([readFileSync(imagePath)], 'overlay.png', { type: 'image/png' }));

    const submitRes = await app.request('/convert/timeline', { method: 'POST', body: formData });
    expect(submitRes.status).toBe(202);
    const submitJson = (await submitRes.json()) as { taskId: string; status: string };
    expect(submitJson.status).toBe('queued');

    const completed = await waitForTask(app, submitJson.taskId);
    expect(completed.status).toBe('completed');
  });

  it('should return 400 when /convert/sequential receives timeline manifest', async () => {
    const formData = new FormData();
    formData.append(
      'manifest',
      JSON.stringify({
        mode: 'timeline',
        assets: [{ id: 'main', type: 'video', field: 'main' }],
        videoTracks: [{ clips: [{ type: 'video', assetId: 'main', start: 0, duration: 1 }] }]
      })
    );

    const res = await app.request('/convert/sequential', { method: 'POST', body: formData });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('Manifest mode must be "sequential"');
  });

  it('should return 400 when /convert receives manifest without mode', async () => {
    const formData = new FormData();
    formData.append(
      'manifest',
      JSON.stringify({
        assets: [{ id: 'clip', type: 'video', field: 'clip' }],
        segments: [{ type: 'video', assetId: 'clip', keepAudio: false }]
      })
    );

    const res = await app.request('/convert', { method: 'POST', body: formData });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('manifest.mode is required');
  });

  it('should return 400 for invalid manifest JSON', async () => {
    const formData = new FormData();
    formData.append('manifest', '{invalid');

    const res = await app.request('/convert', { method: 'POST', body: formData });
    expect(res.status).toBe(400);
  });

  it('should return 404 for unknown task id', async () => {
    const res = await app.request('/convert/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('should return compose manifest documentation', async () => {
    const res = await app.request('/doc/compose-manifest');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      notes: string[];
      sequentialExample: { mode: string };
      timelineExample: { mode: string };
    };
    expect(json.notes.length).toBeGreaterThan(0);
    expect(json.sequentialExample.mode).toBe('sequential');
    expect(json.timelineExample.mode).toBe('timeline');
  });
});
