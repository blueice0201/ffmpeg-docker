import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type { Job } from 'bullmq';
import { ComposeManifestSchema } from '@shared/queue/convert/schemas';
import { processVideoConvert } from './processor';
import { ensureComposeFontPath } from './font';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'convert-processor');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'convert-processor');

function createTestAviFile(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=1000:duration=2:sample_rate=44100 -ac 2 -pix_fmt yuv420p -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function createTestPngFile(outputPath: string, width = 320, height = 240): void {
  execSync(`ffmpeg -f lavfi -i color=c=blue:s=${width}x${height}:d=1 -frames:v 1 -y "${outputPath}"`, {
    stdio: 'pipe'
  });
}

function createTestWavFile(outputPath: string): void {
  execSync(`ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -ar 44100 -ac 2 -y "${outputPath}"`, {
    stdio: 'pipe'
  });
}

function createMockJob(data: Parameters<typeof processVideoConvert>[0]['data']): Job<typeof data> {
  return {
    id: 'test-convert-job',
    data
  } as Job<typeof data>;
}

describe('Convert Processor', () => {
  beforeAll(() => {
    if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    if (existsSync(FIXTURES_DIR)) rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it('should compose sequential video, image, and Chinese text', async () => {
    await ensureComposeFontPath();

    const videoPath = path.join(FIXTURES_DIR, 'clip.avi');
    const imagePath = path.join(FIXTURES_DIR, 'slide.png');
    createTestAviFile(videoPath);
    createTestPngFile(imagePath);

    const jobDir = path.join(TEST_DIR, 'sequential-job');
    const outputPath = path.join(jobDir, 'output.mp4');
    mkdirSync(jobDir, { recursive: true });

    const result = await processVideoConvert(
      createMockJob({
        jobDir,
        outputPath,
        uploadToS3: false,
        assetPaths: {
          clip: videoPath,
          slide: imagePath
        },
        manifest: ComposeManifestSchema.parse({
          mode: 'sequential',
          output: {
            width: 640,
            height: 360,
            fps: 24,
            crf: 23,
            preset: 'ultrafast',
            backgroundColor: '#000000'
          },
          assets: [
            { id: 'clip', type: 'video', field: 'clip' },
            { id: 'slide', type: 'image', field: 'slide' }
          ],
          segments: [
            { type: 'video', assetId: 'clip', keepAudio: false },
            { type: 'image', assetId: 'slide', duration: 1, fit: 'contain' },
            {
              type: 'text',
              content: '中文标题',
              duration: 1,
              style: { fontSize: 36, position: 'center' }
            }
          ]
        })
      })
    );

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });

  it('should compose timeline with image overlay and audio track', async () => {
    const videoPath = path.join(FIXTURES_DIR, 'main.avi');
    const imagePath = path.join(FIXTURES_DIR, 'overlay.png');
    const audioPath = path.join(FIXTURES_DIR, 'voice.wav');
    createTestAviFile(videoPath);
    createTestPngFile(imagePath, 160, 120);
    createTestWavFile(audioPath);

    const jobDir = path.join(TEST_DIR, 'timeline-job');
    const outputPath = path.join(jobDir, 'output.mp4');
    mkdirSync(jobDir, { recursive: true });

    const result = await processVideoConvert(
      createMockJob({
        jobDir,
        outputPath,
        uploadToS3: false,
        assetPaths: {
          main: videoPath,
          overlay: imagePath,
          voice: audioPath
        },
        manifest: ComposeManifestSchema.parse({
          mode: 'timeline',
          duration: 2,
          output: {
            width: 640,
            height: 360,
            fps: 24,
            crf: 23,
            preset: 'ultrafast',
            backgroundColor: '#101010'
          },
          assets: [
            { id: 'main', type: 'video', field: 'main' },
            { id: 'overlay', type: 'image', field: 'overlay' },
            { id: 'voice', type: 'audio', field: 'voice' }
          ],
          videoTracks: [
            {
              clips: [{ type: 'video', assetId: 'main', start: 0, duration: 2 }]
            },
            {
              clips: [
                {
                  type: 'image',
                  assetId: 'overlay',
                  start: 0,
                  duration: 2,
                  x: 20,
                  y: 20,
                  width: 160,
                  height: 120,
                  fit: 'contain'
                }
              ]
            }
          ],
          audioTracks: [
            {
              clips: [{ assetId: 'voice', start: 0, duration: 2, volume: 0.8 }]
            }
          ]
        })
      })
    );

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
  });

  it('should compose timeline with multiple videos, overlays, text, and looping audio', async () => {
    const videoAPath = path.join(FIXTURES_DIR, 'timeline-a.avi');
    const videoBPath = path.join(FIXTURES_DIR, 'timeline-b.avi');
    const imagePath = path.join(FIXTURES_DIR, 'timeline-overlay.png');
    const audioPath = path.join(FIXTURES_DIR, 'timeline-bgm.wav');
    createTestAviFile(videoAPath);
    createTestAviFile(videoBPath);
    createTestPngFile(imagePath, 160, 120);
    createTestWavFile(audioPath);

    const jobDir = path.join(TEST_DIR, 'timeline-multi-job');
    const outputPath = path.join(jobDir, 'output.mp4');
    mkdirSync(jobDir, { recursive: true });

    const result = await processVideoConvert(
      createMockJob({
        jobDir,
        outputPath,
        uploadToS3: false,
        assetPaths: {
          video_a: videoAPath,
          video_b: videoBPath,
          overlay: imagePath,
          bgm: audioPath
        },
        manifest: ComposeManifestSchema.parse({
          mode: 'timeline',
          output: {
            width: 640,
            height: 360,
            fps: 24,
            crf: 23,
            preset: 'ultrafast',
            backgroundColor: '#101010'
          },
          assets: [
            { id: 'video_a', type: 'video', field: 'video_a' },
            { id: 'video_b', type: 'video', field: 'video_b' },
            { id: 'overlay', type: 'image', field: 'overlay' },
            { id: 'bgm', type: 'audio', field: 'bgm' }
          ],
          videoTracks: [
            {
              clips: [
                { type: 'video', assetId: 'video_a', start: 0, duration: 2 },
                { type: 'text', content: 'hello', start: 0, duration: 2, style: { position: 'center' } },
                { type: 'image', assetId: 'overlay', start: 0, duration: 2, x: 10, y: 10, width: 80, height: 60 },
                { type: 'text', content: 'world', start: 1, duration: 1, style: { position: 'bottom' } },
                { type: 'video', assetId: 'video_b', start: 2, duration: 2 }
              ]
            }
          ],
          audioTracks: [
            {
              clips: [{ assetId: 'bgm', start: 0, volume: 0.8, loop: true }]
            }
          ]
        })
      })
    );

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });

  it('should return error when asset file is missing', async () => {
    const result = await processVideoConvert(
      createMockJob({
        jobDir: path.join(TEST_DIR, 'missing'),
        outputPath: path.join(TEST_DIR, 'missing-output.mp4'),
        uploadToS3: false,
        assetPaths: { clip: path.join(FIXTURES_DIR, 'missing.avi') },
        manifest: ComposeManifestSchema.parse({
          mode: 'sequential',
          output: {
            width: 320,
            height: 240,
            fps: 24,
            crf: 23,
            preset: 'ultrafast',
            backgroundColor: '#000000'
          },
          assets: [{ id: 'clip', type: 'video', field: 'clip' }],
          segments: [{ type: 'video', assetId: 'clip', keepAudio: false }]
        })
      })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should compose sequential video with background music start, duration, and loop', async () => {
    const videoPath = path.join(FIXTURES_DIR, 'clip-bgm.avi');
    const audioPath = path.join(FIXTURES_DIR, 'bgm.wav');
    createTestAviFile(videoPath);
    createTestWavFile(audioPath);

    const jobDir = path.join(TEST_DIR, 'sequential-bgm-job');
    const outputPath = path.join(jobDir, 'output.mp4');
    mkdirSync(jobDir, { recursive: true });

    const result = await processVideoConvert(
      createMockJob({
        jobDir,
        outputPath,
        uploadToS3: false,
        assetPaths: {
          clip: videoPath,
          bgm: audioPath
        },
        manifest: ComposeManifestSchema.parse({
          mode: 'sequential',
          output: {
            width: 640,
            height: 360,
            fps: 24,
            crf: 23,
            preset: 'ultrafast',
            backgroundColor: '#000000'
          },
          assets: [
            { id: 'clip', type: 'video', field: 'clip' },
            { id: 'bgm', type: 'audio', field: 'bgm' }
          ],
          segments: [{ type: 'video', assetId: 'clip', keepAudio: false }],
          audioTracks: [{ assetId: 'bgm', volume: 0.5, loop: true, start: 0.5, duration: 1.5 }]
        })
      })
    );

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
  });
});
