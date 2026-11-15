import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { VideoEditRecipe } from '../types';
import { buildMp4Filter, preflightExport } from './recipe';
import { describeFfmpegFailure } from './exportDiagnostics';
import { videoHasAudio } from './mediaProbe';
import { getVideoContainerExtension } from './videoSource';

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
) {
  if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  const normalizedRecipe = preflightExport(recipe, sourceDuration, sourceWidth, sourceHeight);
  const ffmpeg = new FFmpeg();
  const inputPath = `source-${crypto.randomUUID()}${getVideoContainerExtension(file)}`;
  const outputPath = `export-${crypto.randomUUID()}.mp4`;
  const onAbort = () => ffmpeg.terminate();
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    if (!Number.isFinite(progress)) return;
    const boundedProgress = Math.max(0, Math.min(1, progress));
    onProgress(Math.max(5, Math.min(95, Math.round(5 + boundedProgress * 90))));
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

    const hasAudio = await videoHasAudio(ffmpeg, inputPath);
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    const args = [
        '-i', inputPath,
        '-filter_complex', buildMp4Filter(normalizedRecipe, hasAudio),
        '-map', '[out]',
        ...(hasAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        '-c:v', 'libx264',
        '-preset', 'superfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-f', 'mp4',
        outputPath,
    ];
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(args, 10 * 60 * 1000);
    } catch (executionError) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const errorMessage = executionError instanceof Error ? executionError.message : String(executionError);
      if (/timeout|time limit/i.test(errorMessage)) {
        throw new Error(`Export timed out after 10 minutes. The browser could not finish processing this video within the encoder's execution limit.`);
      }
      throw new Error(describeFfmpegFailure('mp4', null, ffmpegLogs, errorMessage));
    }
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    if (exitCode !== 0) throw new Error(describeFfmpegFailure('mp4', exitCode, ffmpegLogs));

    let output: Uint8Array | string;
    try {
      output = await ffmpeg.readFile(outputPath);
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : String(readError);
      throw new Error(`FFmpeg finished encoding but the browser could not read the exported file. Details: ${message}`);
    }
    if (typeof output === 'string' || output.byteLength === 0) {
      throw new Error('MP4 export produced no output.');
    }
    if (output.byteLength < 12 || String.fromCharCode(...output.subarray(4, 8)) !== 'ftyp') {
      throw new Error('MP4 export returned an invalid file.');
    }
    onProgress(100);
    const bytes = new Uint8Array(output.byteLength);
    bytes.set(output);
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.off('log', onFfmpegLog);
    ffmpeg.terminate();
  }
}
