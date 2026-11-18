import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { VideoEditRecipe } from '../types';
import { buildMp4Filter, buildMp4InputArgs, getEditedDuration, preflightExport } from './recipe';
import { describeFfmpegFailure } from './exportDiagnostics';
import { runWithSeekFallback } from './exportExecution';
import { videoHasAudio } from './mediaProbe';
import { getVideoContainerExtension } from './videoSource';

export async function exportMp4(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  sourceWidth: number,
  sourceHeight: number,
  onProgress: (progress: number) => void,
  onFallback: (reason: string) => void,
  signal: AbortSignal,
) {
  const blob = await exportWithFfmpeg(
    file,
    recipe,
    sourceDuration,
    sourceWidth,
    sourceHeight,
    onProgress,
    onFallback,
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
  onFallback: (reason: string) => void,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  const normalizedRecipe = preflightExport(recipe, sourceDuration, sourceWidth, sourceHeight);
  const ffmpeg = new FFmpeg();
  const inputPath = `source-${crypto.randomUUID()}${getVideoContainerExtension(file)}`;
  const outputPath = `export-${crypto.randomUUID()}.mp4`;
  const onAbort = () => ffmpeg.terminate();
  const expectedFrames = getEditedDuration(normalizedRecipe.segments) * 30;
  let reportedProgress = 5;
  let seekFailure = '';
  const ffmpegLogs: string[] = [];
  const onFfmpegLog = ({ message }: { message: string }) => {
    ffmpegLogs.push(message);
    if (ffmpegLogs.length > 200) ffmpegLogs.shift();
    if (/could not seek to position|failed to seek|error while seeking/i.test(message)) seekFailure = message;
    const frameCount = message.match(/^\s*frame=\s*(\d+)/);
    if (frameCount) {
      const progress = Math.min(95, Math.round(5 + Number(frameCount[1]) / expectedFrames * 90));
      if (progress > reportedProgress) {
        reportedProgress = progress;
        onProgress(progress);
      }
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });
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
    let exitCode: number;
    try {
      exitCode = await runWithSeekFallback(
        (seek) => {
          const args = [
            '-loglevel', 'info',
            ...buildMp4InputArgs(normalizedRecipe, inputPath, seek),
            '-filter_complex', buildMp4Filter(normalizedRecipe, hasAudio, true, seek, { width: sourceWidth, height: sourceHeight }),
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
          return ffmpeg.exec(args, 10 * 60 * 1000);
        },
        () => signal.aborted ? '' : seekFailure,
        (reason) => {
          onFallback(reason.slice(0, 240));
          ffmpegLogs.length = 0;
          reportedProgress = 5;
          onProgress(5);
        },
      );
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
    ffmpeg.off('log', onFfmpegLog);
    ffmpeg.terminate();
  }
}
