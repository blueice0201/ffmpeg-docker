import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COMPOSE_FONTS,
  DEFAULT_COMPOSE_FONT_ID,
  getComposeFontDefinition,
  type ComposeFontId
} from '@shared/queue/convert/fonts';
import { env } from '@worker/config/env';
import { logger } from '@worker/config/logger';

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FONT_DIR = path.join(workerRoot, 'assets/fonts');

const SYSTEM_FONT_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Supplemental/Songti.ttc'
];

const cachedFontPaths = new Map<string, string>();
const downloadPromises = new Map<string, Promise<string>>();

function isValidFontFile(buffer: Buffer): boolean {
  if (buffer.length < 1024) return false;
  const signature = buffer.subarray(0, 4).toString('ascii');
  return signature === 'OTTO' || signature === 'true' || buffer.readUInt32BE(0) === 0x0001_0000;
}

function resolveFontPath(fontId: ComposeFontId): string {
  return path.join(FONT_DIR, getComposeFontDefinition(fontId).fileName);
}

async function downloadFont(fontId: ComposeFontId, destPath: string): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true });
  const definition = getComposeFontDefinition(fontId);
  let lastError: Error | undefined;

  for (const url of definition.downloadUrls) {
    try {
      logger.info({ fontId, url }, 'Downloading compose font');

      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!isValidFontFile(buffer)) {
        throw new Error('Downloaded file is not a valid font');
      }

      await writeFile(destPath, buffer);
      logger.info({ fontId, path: destPath, bytes: buffer.length, url }, 'Compose font ready');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = new Error(`Failed to download compose font "${fontId}" from ${url}: ${message}`);
      logger.warn({ fontId, url, error: message }, 'Compose font download failed, trying next source');
    }
  }

  throw lastError ?? new Error(`Failed to download compose font "${fontId}"`);
}

async function downloadFontOnce(fontId: ComposeFontId, destPath: string): Promise<string> {
  if (existsSync(destPath)) {
    return destPath;
  }

  const existing = downloadPromises.get(fontId);
  if (existing) {
    return existing;
  }

  const promise = downloadFont(fontId, destPath)
    .then(() => destPath)
    .finally(() => {
      downloadPromises.delete(fontId);
    });

  downloadPromises.set(fontId, promise);
  return promise;
}

export async function ensureComposeFontPath(fontId?: string): Promise<string> {
  const resolvedId = (fontId ?? DEFAULT_COMPOSE_FONT_ID) as ComposeFontId;
  const cached = cachedFontPaths.get(resolvedId);
  if (cached && existsSync(cached)) {
    return cached;
  }

  if (env.COMPOSE_FONT_PATH && existsSync(env.COMPOSE_FONT_PATH)) {
    cachedFontPaths.set(resolvedId, env.COMPOSE_FONT_PATH);
    return env.COMPOSE_FONT_PATH;
  }

  const bundledPath = resolveFontPath(resolvedId);
  if (existsSync(bundledPath)) {
    cachedFontPaths.set(resolvedId, bundledPath);
    return bundledPath;
  }

  if (resolvedId === DEFAULT_COMPOSE_FONT_ID) {
    for (const candidate of SYSTEM_FONT_CANDIDATES) {
      if (existsSync(candidate)) {
        cachedFontPaths.set(resolvedId, candidate);
        return candidate;
      }
    }
  }

  if (env.COMPOSE_FONT_AUTO_DOWNLOAD) {
    const downloaded = await downloadFontOnce(resolvedId, bundledPath);
    cachedFontPaths.set(resolvedId, downloaded);
    return downloaded;
  }

  throw new Error(
    `Compose font "${resolvedId}" not found. Enable COMPOSE_FONT_AUTO_DOWNLOAD or place ${getComposeFontDefinition(resolvedId).fileName} in apps/worker/assets/fonts/.`
  );
}

export function formatFontPathForFfmpeg(fontPath: string): string {
  return fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export { COMPOSE_FONTS, DEFAULT_COMPOSE_FONT_ID };
