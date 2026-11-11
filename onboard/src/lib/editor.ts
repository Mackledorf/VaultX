import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { VideoEditRecipe } from '../types';
import { buildGifFilter, buildMp4Filter, getEditedDuration, preflightExport } from './recipe';
import { describeFfmpegFailure } from './exportDiagnostics';
import {
  GIF_FALLBACK_PROFILES,
  MAX_EXPORT_BYTES,
  MP4_FALLBACK_PROFILES,
  getMp4TargetBitrate,
  outputLimitMessage,
} from './exportSizing';

export async function exportGif(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  sourceWidth: number,
  sourceHeight: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  const blob = await exportWithFfmpeg(
    file,
    recipe,
    sourceDuration,
    sourceWidth,
    sourceHeight,
    onProgress,
    signal,
    'gif',
  );
  if (blob.type !== 'image/gif') throw new Error('GIF export returned an invalid file.');
  return blob;
}

export async function exportMp4(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  sourceWidth: number,
  sourceHeight: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  const blob = await exportWithFfmpeg(
    file,
    recipe,
    sourceDuration,
    sourceWidth,
    sourceHeight,
    onProgress,
    signal,
    'mp4',
  );
  if (blob.type !== 'video/mp4') throw new Error('MP4 export returned an invalid file.');
  return blob;
}

async function exportWithFfmpeg(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  sourceWidth: number,
  sourceHeight: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
  format: 'gif' | 'mp4',
) {
  if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  const normalizedRecipe = preflightExport(recipe, sourceDuration, sourceWidth, sourceHeight);
  const ffmpeg = new FFmpeg();
  const inputPath = `source-${crypto.randomUUID()}.mp4`;
  const outputPath = `export-${crypto.randomUUID()}.${format}`;
  const outputLimit = MAX_EXPORT_BYTES[format];
  const totalFallbacks = format === 'gif' ? GIF_FALLBACK_PROFILES.length : MP4_FALLBACK_PROFILES.length;
  let activeAttempt = 0;
  const onAbort = () => ffmpeg.terminate();
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    if (!Number.isFinite(progress)) return;
    const boundedProgress = Math.max(0, Math.min(1, progress));
    const overallProgress = activeAttempt === 0
      ? 5 + boundedProgress * 70
      : 75 + ((activeAttempt - 1 + boundedProgress) / totalFallbacks) * 20;
    onProgress(Math.max(5, Math.min(95, Math.round(overallProgress))));
  };
  const ffmpegLogs: string[] = [];
  const onFfmpegLog = ({ message }: { message: string }) => {
    ffmpegLogs.push(message);
    if (ffmpegLogs.length > 200) ffmpegLogs.shift();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  ffmpeg.on('progress', onFfmpegProgress);
  ffmpeg.on('log', onFfmpegLog);

  try {
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    onProgress(1);
    try {
      await ffmpeg.load({ coreURL, wasmURL });
    } catch (loadError) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      throw new Error(`Could not initialize the local video encoder. Check that the page can load its bundled FFmpeg files and retry. Details: ${message}`);
    }
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    try {
      await ffmpeg.writeFile(inputPath, await fetchFile(file));
    } catch (sourceError) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const message = sourceError instanceof Error ? sourceError.message : String(sourceError);
      throw new Error(`Could not prepare the source video for local encoding. The source could not be read into the browser encoder. Details: ${message}`);
    }
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    onProgress(5);

    for (let attempt = 0; attempt <= totalFallbacks; attempt += 1) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      activeAttempt = attempt;
      if (attempt > 0) onProgress(Math.round(75 + ((attempt - 1) / totalFallbacks) * 20));

      let args: string[];
      if (format === 'gif') {
        const gifProfile = attempt === 0 ? undefined : GIF_FALLBACK_PROFILES[attempt - 1];
        args = [
          '-i', inputPath,
          '-filter_complex', buildGifFilter(normalizedRecipe, gifProfile),
          '-map', '[out]',
          '-an',
          '-loop', '0',
          '-f', 'gif',
          '-fs', String(outputLimit + 1),
          outputPath,
        ];
      } else {
        const mp4Profile = attempt === 0 ? undefined : MP4_FALLBACK_PROFILES[attempt - 1];
        const bitrate = mp4Profile
          ? getMp4TargetBitrate(getEditedDuration(normalizedRecipe.segments), mp4Profile)
          : null;
        if (mp4Profile && bitrate === null) continue;
        args = [
          '-i', inputPath,
          '-filter_complex', buildMp4Filter(normalizedRecipe, mp4Profile?.maxDimension),
          '-map', '[out]',
          '-an',
          '-c:v', 'libx264',
          '-preset', 'superfast',
          ...(bitrate === null
            ? ['-crf', '23']
            : ['-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)]),
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-f', 'mp4',
          '-fs', String(outputLimit + 1),
          outputPath,
        ];
      }

      let exitCode: number | null = null;
      let executionError: unknown;
      try {
        exitCode = await ffmpeg.exec(args, 10 * 60 * 1000);
      } catch (error) {
        if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
        executionError = error;
      }
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const executionMessage = executionError instanceof Error ? executionError.message : '';
      if (executionMessage && /timeout|time limit/i.test(executionMessage)) {
        throw new Error(`Export timed out after 10 minutes. The browser could not finish processing this video within the encoder's execution limit.`);
      }

      let output: Uint8Array | string;
      try {
        output = await ffmpeg.readFile(outputPath);
      } catch (readError) {
        if (executionError || (exitCode !== null && exitCode !== 0)) {
          const errorMessage = executionError instanceof Error ? executionError.message : undefined;
          if (errorMessage && /timeout|time limit/i.test(errorMessage)) {
            throw new Error(`Export timed out after 10 minutes. The browser could not finish processing this video within the encoder's execution limit.`);
          }
          throw new Error(describeFfmpegFailure(format, exitCode, ffmpegLogs, errorMessage));
        }
        const message = readError instanceof Error ? readError.message : String(readError);
        throw new Error(`FFmpeg finished encoding but the browser could not read the exported file. Details: ${message}`);
      }
      if (typeof output === 'string' || output.byteLength === 0) {
        if (executionError || (exitCode !== null && exitCode !== 0)) {
          const errorMessage = executionError instanceof Error ? executionError.message : undefined;
          throw new Error(describeFfmpegFailure(format, exitCode, ffmpegLogs, errorMessage));
        }
        throw new Error(`${format.toUpperCase()} export produced no output.`);
      }
      if (output.byteLength > outputLimit) {
        if (attempt === totalFallbacks) break;
        await ffmpeg.deleteFile(outputPath);
        continue;
      }
      if (executionError || (exitCode !== null && exitCode !== 0)) {
        const errorMessage = executionError instanceof Error ? executionError.message : undefined;
        if (errorMessage && /timeout|time limit/i.test(errorMessage)) {
          throw new Error(`Export timed out after 10 minutes. The browser could not finish processing this video within the encoder's execution limit.`);
        }
        throw new Error(describeFfmpegFailure(format, exitCode, ffmpegLogs, errorMessage));
      }
      if (format === 'gif') {
        if (String.fromCharCode(...output.subarray(0, 3)) !== 'GIF' || output[output.byteLength - 1] !== 0x3b) {
          throw new Error('GIF export returned an invalid file.');
        }
      } else if (output.byteLength < 12 || String.fromCharCode(...output.subarray(4, 8)) !== 'ftyp') {
        throw new Error('MP4 export returned an invalid file.');
      }
      onProgress(100);
      const bytes = new Uint8Array(output.byteLength);
      bytes.set(output);
      return new Blob([bytes], { type: format === 'gif' ? 'image/gif' : 'video/mp4' });
    }
    throw new Error(outputLimitMessage(format));
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.off('log', onFfmpegLog);
    ffmpeg.terminate();
  }
}
