import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TextPosition } from '@shared/queue/convert/schemas';
import { ensureComposeFontPath, formatFontPathForFfmpeg } from './font';

const execFileAsync = promisify(execFile);

export const PROCESSING_TIMEOUT = 600000;
export { ensureComposeFontPath } from './font';

export interface RunFfmpegOptions {
  expectedDurationUs?: number;
  onProgress?: (ratio: number) => void;
}

export function parseFfmpegProgressBlock(
  block: string,
  expectedDurationUs?: number
): number | undefined {
  let outTimeUs: number | undefined;

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);

    if (key === 'out_time_us') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        outTimeUs = parsed;
      }
    } else if (key === 'out_time_ms' && outTimeUs === undefined) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        outTimeUs = parsed * 1000;
      }
    } else if (key === 'progress' && value === 'end') {
      return 1;
    }
  }

  if (outTimeUs !== undefined && expectedDurationUs && expectedDurationUs > 0) {
    return Math.min(1, outTimeUs / expectedDurationUs);
  }

  return undefined;
}

export async function runFfmpeg(args: string[], options?: RunFfmpegOptions): Promise<void> {
  if (!options?.onProgress) {
    await execFileAsync('ffmpeg', args, { timeout: PROCESSING_TIMEOUT });
    return;
  }

  const ffmpegArgs = ['-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', ...args];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    let stdoutBuffer = '';
    let progressBlock = '';
    let lastRatio = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('FFmpeg timed out'));
    }, PROCESSING_TIMEOUT);

    const reportRatio = (ratio: number): void => {
      const clamped = Math.min(1, Math.max(0, ratio));
      if (clamped > lastRatio) {
        lastRatio = clamped;
        options.onProgress?.(clamped);
      }
    };

    const handleProgressLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      progressBlock += `${trimmed}\n`;
      if (!trimmed.startsWith('progress=')) {
        return;
      }

      const ratio = parseFfmpegProgressBlock(progressBlock, options.expectedDurationUs);
      progressBlock = '';
      if (ratio !== undefined) {
        reportRatio(ratio);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleProgressLine(line);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (stdoutBuffer.trim()) {
        handleProgressLine(stdoutBuffer);
      }
      if (progressBlock.trim()) {
        const ratio = parseFfmpegProgressBlock(progressBlock, options.expectedDurationUs);
        if (ratio !== undefined) {
          reportRatio(ratio);
        }
      }

      if (code === 0) {
        reportRatio(1);
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function runFfprobe(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('ffprobe', args, { timeout: 30000 });
  return stdout.trim();
}

export async function probeDuration(filePath: string): Promise<number> {
  const stdout = await runFfprobe([
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);
  const value = Number.parseFloat(stdout);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Unable to probe duration for ${filePath}`);
  }
  return value;
}

export function hexToFfmpegColor(hex: string): string {
  return `0x${hex.replace('#', '')}`;
}

export function buildScaleFilter(
  width: number,
  height: number,
  fit: 'contain' | 'cover' | 'fill',
  backgroundColor: string
): string {
  const bg = hexToFfmpegColor(backgroundColor);
  if (fit === 'fill') {
    return `scale=${width}:${height},setsar=1`;
  }
  if (fit === 'cover') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
  }
  // Crop after scale:decrease avoids pad failures when rounding pushes iw/ih 1px over the box.
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,crop=min(${width}\\,iw):min(${height}\\,ih),pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bg},setsar=1`;
}

export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, '\\n');
}

export function formatVerticalText(text: string): string {
  const chars = [...text.replace(/\r\n/g, '\n')].filter((char) => char !== '\n' && char !== '\r');
  return chars.join('\n');
}

export function resolveDrawtextLayout(options: {
  text: string;
  position?: TextPosition;
  margin?: number;
  align?: 'left' | 'center' | 'right';
  x?: number;
  y?: number;
}): {
  text: string;
  xExpr: string;
  yExpr: string;
  vertical: boolean;
} {
  if (options.x !== undefined && options.y !== undefined) {
    return {
      text: options.text,
      xExpr: String(options.x),
      yExpr: String(options.y),
      vertical: false
    };
  }

  const position = options.position ?? 'bottom';
  const margin = options.margin ?? 40;
  const align = options.align ?? 'center';

  if (position === 'left' || position === 'right') {
    return {
      text: formatVerticalText(options.text),
      xExpr: position === 'left' ? String(margin) : `(w-text_w-${margin})`,
      yExpr: String(margin),
      vertical: true
    };
  }

  const xExpr =
    align === 'left' ? String(margin) : align === 'right' ? `(w-text_w-${margin})` : '(w-text_w)/2';

  if (position === 'top') {
    return { text: options.text, xExpr, yExpr: String(margin), vertical: false };
  }
  if (position === 'center') {
    return { text: options.text, xExpr: '(w-text_w)/2', yExpr: '(h-text_h)/2', vertical: false };
  }

  return { text: options.text, xExpr, yExpr: `(h-text_h-${margin})`, vertical: false };
}

export async function buildDrawtextFilter(options: {
  text: string;
  style?: {
    fontSize?: number;
    fontColor?: string;
    backgroundColor?: string;
    align?: 'left' | 'center' | 'right';
    position?: TextPosition;
    margin?: number;
    fontId?: string;
  };
  x?: number;
  y?: number;
  enable?: string;
}): Promise<string> {
  const style = options.style ?? {};
  const fontFile = formatFontPathForFfmpeg(await ensureComposeFontPath(style.fontId));
  const fontSize = style.fontSize ?? 48;
  const fontColor = hexToFfmpegColor(style.fontColor ?? '#FFFFFF');
  const layout = resolveDrawtextLayout({
    text: options.text,
    position: style.position,
    margin: style.margin,
    align: style.align,
    x: options.x,
    y: options.y
  });

  const parts = [
    `fontfile=${fontFile}`,
    `text='${escapeDrawtext(layout.text)}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${fontColor}`,
    `x=${layout.xExpr}`,
    `y=${layout.yExpr}`
  ];

  if (layout.vertical) {
    parts.push(`line_spacing=${Math.max(2, Math.round(fontSize * 0.08))}`);
  }

  if (style.backgroundColor) {
    parts.push(`box=1`, `boxcolor=${hexToFfmpegColor(style.backgroundColor)}`, `boxborderw=8`);
  }

  if (options.enable) {
    parts.push(`enable='${options.enable}'`);
  }

  return `drawtext=${parts.join(':')}`;
}

export function concatListLine(filePath: string): string {
  const normalized = filePath.replace(/'/g, "'\\''");
  return `file '${normalized}'`;
}

export function durationToMicroseconds(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds * 1_000_000));
}
