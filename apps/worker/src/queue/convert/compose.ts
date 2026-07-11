import { writeFile } from 'fs/promises';
import path from 'path';
import type { ComposeManifest, OutputConfig, TextStyle } from '@shared/queue/convert/schemas';
import { OutputSchema } from '@shared/queue/convert/schemas';
import {
  buildDrawtextFilter,
  buildScaleFilter,
  concatListLine,
  durationToMicroseconds,
  hexToFfmpegColor,
  probeDuration,
  runFfmpeg,
  type RunFfmpegOptions
} from './ffmpeg-utils';
import { ComposeProgressTracker } from './progress';

type AssetPaths = Record<string, string>;

type FfmpegStepProgress = Pick<RunFfmpegOptions, 'expectedDurationUs' | 'onProgress'>;

function resolveOutput(manifest: ComposeManifest): OutputConfig {
  return OutputSchema.parse(manifest.output ?? {});
}

function resolveAssets(manifest: ComposeManifest, assetPaths: AssetPaths) {
  const map = new Map<string, { type: 'video' | 'audio' | 'image'; path: string }>();
  for (const asset of manifest.assets) {
    const resolved = assetPaths[asset.id];
    if (!resolved) {
      throw new Error(`Missing asset path for ${asset.id}`);
    }
    map.set(asset.id, { type: asset.type, path: resolved });
  }
  return map;
}

function toFfmpegProgress(
  step: { onFfmpegProgress: (ratio: number) => void } | undefined,
  durationSeconds: number
): FfmpegStepProgress | undefined {
  if (!step) return undefined;
  return {
    expectedDurationUs: durationToMicroseconds(durationSeconds),
    onProgress: step.onFfmpegProgress
  };
}

async function renderTextSegment(
  workDir: string,
  index: number,
  content: string,
  duration: number,
  output: OutputConfig,
  style?: TextStyle,
  progress?: FfmpegStepProgress
): Promise<string> {
  const segmentPath = path.join(workDir, `seg_${index}.mp4`);
  const drawtext = await buildDrawtextFilter({ text: content, style });
  const bg = hexToFfmpegColor(output.backgroundColor);

  await runFfmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      `color=c=${bg}:s=${output.width}x${output.height}:d=${duration}:r=${output.fps}`,
      '-vf',
      drawtext,
      '-pix_fmt',
      'yuv420p',
      '-y',
      segmentPath
    ],
    progress
  );

  return segmentPath;
}

async function renderVideoSegment(
  workDir: string,
  index: number,
  inputPath: string,
  output: OutputConfig,
  options: {
    trimStart?: number;
    trimEnd?: number;
    fit?: 'contain' | 'cover' | 'fill';
  },
  progress?: FfmpegStepProgress
): Promise<string> {
  const segmentPath = path.join(workDir, `seg_${index}.mp4`);
  const fit = options.fit ?? 'contain';
  const vf = buildScaleFilter(output.width, output.height, fit, output.backgroundColor);

  const args = ['-ss', String(options.trimStart ?? 0)];
  if (options.trimEnd !== undefined) {
    args.push('-to', String(options.trimEnd));
  }

  args.push('-i', inputPath, '-vf', vf, '-r', String(output.fps), '-pix_fmt', 'yuv420p', '-an', '-y', segmentPath);
  await runFfmpeg(args, progress);
  return segmentPath;
}

async function renderImageSegment(
  workDir: string,
  index: number,
  inputPath: string,
  duration: number,
  output: OutputConfig,
  fit?: 'contain' | 'cover' | 'fill',
  progress?: FfmpegStepProgress
): Promise<string> {
  const segmentPath = path.join(workDir, `seg_${index}.mp4`);
  const vf = buildScaleFilter(output.width, output.height, fit ?? 'contain', output.backgroundColor);

  await runFfmpeg(
    [
      '-loop',
      '1',
      '-i',
      inputPath,
      '-t',
      String(duration),
      '-vf',
      vf,
      '-r',
      String(output.fps),
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-y',
      segmentPath
    ],
    progress
  );

  return segmentPath;
}

async function concatVideoSegments(
  segmentPaths: string[],
  workDir: string,
  outputPath: string,
  progress?: FfmpegStepProgress
): Promise<void> {
  const listPath = path.join(workDir, 'concat.txt');
  await writeFile(listPath, segmentPaths.map(concatListLine).join('\n'));

  await runFfmpeg(
    [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-an',
      '-y',
      outputPath
    ],
    progress
  );
}

async function mixAudioTracks(
  videoPath: string,
  outputPath: string,
  clips: Array<{
    inputPath: string;
    start: number;
    duration?: number;
    trimStart?: number;
    volume: number;
    loop?: boolean;
  }>,
  totalDuration: number,
  progress?: FfmpegStepProgress
): Promise<void> {
  if (clips.length === 0) {
    await runFfmpeg(['-i', videoPath, '-c', 'copy', '-y', outputPath], progress);
    return;
  }

  const args: string[] = ['-i', videoPath];
  const filterParts: string[] = [];
  const mixInputs: string[] = [];

  clips.forEach((clip, index) => {
    args.push('-i', clip.inputPath);
    const inputIndex = index + 1;
    const delayMs = Math.round(clip.start * 1000);
    const trimStart = clip.trimStart ?? 0;
    const playDuration =
      clip.duration ?? (clip.loop ? Math.max(0.1, totalDuration - clip.start) : undefined);
    let chain = `[${inputIndex}:a]`;
    if (clip.loop) {
      chain += 'aloop=loop=-1:size=4800000,';
    }
    chain += `atrim=start=${trimStart}`;
    if (playDuration !== undefined) {
      chain += `:duration=${playDuration}`;
    }
    chain += `,asetpts=PTS-STARTPTS,volume=${clip.volume},adelay=${delayMs}|${delayMs}[a${index}]`;
    filterParts.push(chain);
    mixInputs.push(`[a${index}]`);
  });

  filterParts.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0,apad,atrim=duration=${totalDuration}[outa]`
  );

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '0:v',
    '-map',
    '[outa]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    '-y',
    outputPath
  );

  await runFfmpeg(args, progress);
}

async function resolveSequentialSegmentDurations(
  manifest: Extract<ComposeManifest, { mode: 'sequential' }>,
  assets: Map<string, { type: 'video' | 'audio' | 'image'; path: string }>
): Promise<number[]> {
  const durations: number[] = [];

  for (const segment of manifest.segments) {
    if (segment.type === 'video') {
      const asset = assets.get(segment.assetId);
      if (!asset || asset.type !== 'video') {
        throw new Error(`Invalid video asset: ${segment.assetId}`);
      }

      const sourceDuration = await probeDuration(asset.path);
      const trimStart = segment.trimStart ?? 0;
      const trimEnd = segment.trimEnd ?? sourceDuration;
      durations.push(Math.max(0.1, trimEnd - trimStart));
      continue;
    }

    if (segment.type === 'image') {
      durations.push(segment.duration);
      continue;
    }

    durations.push(segment.duration);
  }

  return durations;
}

function sequentialNeedsAudioMix(
  manifest: Extract<ComposeManifest, { mode: 'sequential' }>
): boolean {
  if ((manifest.audioTracks?.length ?? 0) > 0) {
    return true;
  }

  return manifest.segments.some((segment) => segment.type === 'video' && segment.keepAudio);
}

export async function composeSequential(
  manifest: Extract<ComposeManifest, { mode: 'sequential' }>,
  assetPaths: AssetPaths,
  workDir: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const assets = resolveAssets(manifest, assetPaths);
  const output = resolveOutput(manifest);
  const segmentDurations = await resolveSequentialSegmentDurations(manifest, assets);
  const totalVideoDuration = segmentDurations.reduce((sum, duration) => sum + duration, 0);
  const mixWeight = sequentialNeedsAudioMix(manifest) ? totalVideoDuration : Math.max(0.5, totalVideoDuration * 0.05);
  const totalWeight = segmentDurations.reduce((sum, duration) => sum + duration, 0) + totalVideoDuration + mixWeight;
  const tracker = onProgress ? new ComposeProgressTracker(totalWeight, onProgress) : null;

  const segmentPaths: string[] = [];
  const audioClips: Array<{
    inputPath: string;
    start: number;
    duration?: number;
    trimStart?: number;
    volume: number;
    loop?: boolean;
  }> = [];

  let timelineOffset = 0;

  for (const [index, segment] of manifest.segments.entries()) {
    const duration = segmentDurations[index] ?? 0.1;
    const step = tracker?.startStep(duration);

    if (segment.type === 'video') {
      const asset = assets.get(segment.assetId);
      if (!asset || asset.type !== 'video') {
        throw new Error(`Invalid video asset: ${segment.assetId}`);
      }

      const trimStart = segment.trimStart ?? 0;
      const trimEnd = segment.trimEnd ?? trimStart + duration;

      const segPath = await renderVideoSegment(
        workDir,
        index,
        asset.path,
        output,
        {
          trimStart,
          trimEnd,
          fit: segment.fit
        },
        toFfmpegProgress(step, duration)
      );
      segmentPaths.push(segPath);

      if (segment.keepAudio) {
        audioClips.push({
          inputPath: asset.path,
          start: timelineOffset,
          duration,
          trimStart,
          volume: 1
        });
      }

      timelineOffset += duration;
    } else if (segment.type === 'image') {
      const asset = assets.get(segment.assetId);
      if (!asset || asset.type !== 'image') {
        throw new Error(`Invalid image asset: ${segment.assetId}`);
      }

      const segPath = await renderImageSegment(
        workDir,
        index,
        asset.path,
        segment.duration,
        output,
        segment.fit,
        toFfmpegProgress(step, duration)
      );
      segmentPaths.push(segPath);
      timelineOffset += segment.duration;
    } else {
      const segPath = await renderTextSegment(
        workDir,
        index,
        segment.content,
        segment.duration,
        output,
        segment.style,
        toFfmpegProgress(step, duration)
      );
      segmentPaths.push(segPath);
      timelineOffset += segment.duration;
    }

    tracker?.completeStep(duration);
  }

  const videoOnlyPath = path.join(workDir, 'video_only.mp4');
  const concatStep = tracker?.startStep(totalVideoDuration);
  await concatVideoSegments(
    segmentPaths,
    workDir,
    videoOnlyPath,
    toFfmpegProgress(concatStep, totalVideoDuration)
  );
  tracker?.completeStep(totalVideoDuration);

  for (const track of manifest.audioTracks ?? []) {
    const asset = assets.get(track.assetId);
    if (!asset || asset.type !== 'audio') {
      throw new Error(`Invalid audio asset: ${track.assetId}`);
    }

    audioClips.push({
      inputPath: asset.path,
      start: track.start ?? 0,
      duration: track.duration,
      volume: track.volume,
      loop: track.loop
    });
  }

  const mixStep = tracker?.startStep(mixWeight);
  await mixAudioTracks(
    videoOnlyPath,
    outputPath,
    audioClips,
    timelineOffset,
    toFfmpegProgress(mixStep, timelineOffset)
  );
  tracker?.completeStep(mixWeight);
  tracker?.finish();
}

async function resolveTimelineDuration(
  manifest: Extract<ComposeManifest, { mode: 'timeline' }>,
  assets: Map<string, { type: 'video' | 'audio' | 'image'; path: string }>
): Promise<number> {
  if (manifest.duration) {
    return manifest.duration;
  }

  let totalDuration = 0;
  const visualClips = manifest.videoTracks.flatMap((track) => track.clips);
  const audioClips = manifest.audioTracks?.flatMap((track) => track.clips) ?? [];

  for (const clip of visualClips) {
    if (clip.type === 'text' || clip.type === 'image') {
      totalDuration = Math.max(totalDuration, clip.start + clip.duration);
      continue;
    }

    const asset = assets.get(clip.assetId);
    if (!asset) continue;
    const sourceDuration = await probeDuration(asset.path);
    const clipDuration = clip.duration ?? sourceDuration - (clip.trimStart ?? 0);
    totalDuration = Math.max(totalDuration, clip.start + clipDuration);
  }

  for (const clip of audioClips) {
    const asset = assets.get(clip.assetId);
    if (!asset) continue;
    const sourceDuration = await probeDuration(asset.path);
    const clipDuration = clip.duration ?? sourceDuration - (clip.trimStart ?? 0);
    totalDuration = Math.max(totalDuration, clip.start + clipDuration);
  }

  if (totalDuration <= 0) {
    throw new Error('Unable to determine timeline duration');
  }

  return totalDuration;
}

export async function composeTimeline(
  manifest: Extract<ComposeManifest, { mode: 'timeline' }>,
  assetPaths: AssetPaths,
  workDir: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const assets = resolveAssets(manifest, assetPaths);
  const output = resolveOutput(manifest);
  const visualClips = manifest.videoTracks.flatMap((track) => track.clips).sort((a, b) => a.start - b.start);
  const audioClips = manifest.audioTracks?.flatMap((track) => track.clips) ?? [];
  const totalDuration = await resolveTimelineDuration(manifest, assets);
  const tracker = onProgress ? new ComposeProgressTracker(totalDuration, onProgress) : null;
  const step = tracker?.startStep(totalDuration);

  const inputArgs: string[] = [
    '-f',
    'lavfi',
    '-i',
    `color=c=${hexToFfmpegColor(output.backgroundColor)}:s=${output.width}x${output.height}:d=${totalDuration}:r=${output.fps}`
  ];

  const visualInputIndex = new Map<string, number>();
  let nextInputIndex = 1;
  for (const asset of manifest.assets) {
    if (asset.type === 'video' || asset.type === 'image') {
      const resolved = assets.get(asset.id);
      if (!resolved) continue;
      visualInputIndex.set(asset.id, nextInputIndex);
      inputArgs.push('-i', resolved.path);
      nextInputIndex += 1;
    }
  }

  const audioInputIndex = new Map<string, number>();
  for (const asset of manifest.assets) {
    if (asset.type === 'audio') {
      const resolved = assets.get(asset.id);
      if (!resolved) continue;
      audioInputIndex.set(asset.id, nextInputIndex);
      inputArgs.push('-i', resolved.path);
      nextInputIndex += 1;
    }
  }

  const filterParts: string[] = [];
  let streamLabel = '[0:v]';
  let stepIndex = 0;

  for (const clip of visualClips) {
    const outLabel = `[v${stepIndex}]`;

    if (clip.type === 'text') {
      const drawtext = await buildDrawtextFilter({
        text: clip.content,
        style: clip.style,
        x: clip.x,
        y: clip.y,
        enable: `between(t\\,${clip.start}\\,${clip.start + clip.duration})`
      });
      filterParts.push(`${streamLabel}${drawtext}${outLabel}`);
      streamLabel = outLabel;
      stepIndex += 1;
      continue;
    }

    const inputIndex = visualInputIndex.get(clip.assetId);
    if (inputIndex === undefined) {
      throw new Error(`Missing visual input for asset ${clip.assetId}`);
    }

    const clipWidth = clip.width ?? output.width;
    const clipHeight = clip.height ?? output.height;
    const scale = buildScaleFilter(clipWidth, clipHeight, clip.fit ?? 'contain', output.backgroundColor);
    const clipDuration =
      clip.type === 'image'
        ? clip.duration
        : clip.duration ??
          (await probeDuration(assets.get(clip.assetId)!.path)) - (clip.trimStart ?? 0);
    const enable = `between(t\\,${clip.start}\\,${clip.start + clipDuration})`;
    const prepLabel = `[p${stepIndex}]`;

    if (clip.type === 'image') {
      filterParts.push(
        `[${inputIndex}:v]loop=loop=-1:size=1:start=0,trim=duration=${clipDuration},setpts=PTS-STARTPTS,${scale},format=yuva420p${prepLabel}`
      );
      filterParts.push(`${streamLabel}${prepLabel}overlay=x=${clip.x}:y=${clip.y}:enable='${enable}'${outLabel}`);
    } else {
      filterParts.push(
        `[${inputIndex}:v]trim=start=${clip.trimStart ?? 0}${clip.duration !== undefined ? `:duration=${clip.duration}` : ''},setpts=PTS-STARTPTS,${scale},format=yuva420p${prepLabel}`
      );
      filterParts.push(`${streamLabel}${prepLabel}overlay=x=${clip.x}:y=${clip.y}:enable='${enable}'${outLabel}`);
    }

    streamLabel = outLabel;
    stepIndex += 1;
  }

  const audioFilterParts: string[] = [];
  const mixLabels: string[] = [];

  audioClips.forEach((clip, index) => {
    const inputIndex = audioInputIndex.get(clip.assetId);
    if (inputIndex === undefined) {
      throw new Error(`Missing audio input for asset ${clip.assetId}`);
    }

    const delayMs = Math.round(clip.start * 1000);
    const playDuration =
      clip.duration ?? (clip.loop ? Math.max(0.1, totalDuration - clip.start) : undefined);
    let chain = `[${inputIndex}:a]`;
    if (clip.loop) {
      chain += 'aloop=loop=-1:size=4800000,';
    }
    chain += `atrim=start=${clip.trimStart ?? 0}`;
    if (playDuration !== undefined) {
      chain += `:duration=${playDuration}`;
    }
    chain += `,asetpts=PTS-STARTPTS,volume=${clip.volume},adelay=${delayMs}|${delayMs}[ta${index}]`;
    audioFilterParts.push(chain);
    mixLabels.push(`[ta${index}]`);
  });

  const filterComplex = [...filterParts, ...audioFilterParts];
  if (mixLabels.length > 0) {
    filterComplex.push(
      `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0,apad,atrim=duration=${totalDuration}[outa]`
    );
  }

  const finalArgs = [...inputArgs, '-filter_complex', filterComplex.join(';'), '-map', streamLabel];

  if (mixLabels.length > 0) {
    finalArgs.push('-map', '[outa]', '-c:a', 'aac');
  } else {
    finalArgs.push('-an');
  }

  finalArgs.push(
    '-c:v',
    'libx264',
    '-preset',
    output.preset,
    '-crf',
    String(output.crf),
    '-pix_fmt',
    'yuv420p',
    '-t',
    String(totalDuration),
    '-y',
    outputPath
  );

  await runFfmpeg(finalArgs, toFfmpegProgress(step, totalDuration));
  tracker?.completeStep(totalDuration);
  tracker?.finish();
}
