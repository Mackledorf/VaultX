import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { describeFfmpegFailure } from './exportDiagnostics';

export async function convertGifToMp4(
  file: File,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');

  const ffmpeg = new FFmpeg();
  const uniqueId = crypto.randomUUID();
  const inputPath = `source-${uniqueId}.gif`;
  const outputPath = `prepared-${uniqueId}.mp4`;
  const ffmpegLogs: string[] = [];
  const onAbort = () => ffmpeg.terminate();
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      onProgress(Math.max(1, Math.min(95, Math.round(Math.max(0, Math.min(1, progress)) * 95))));
    }
  };
  const onFfmpegLog = ({ message }: { message: string }) => {
    ffmpegLogs.push(message);
    if (ffmpegLogs.length > 200) ffmpegLogs.shift();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  ffmpeg.on('progress', onFfmpegProgress);
  ffmpeg.on('log', onFfmpegLog);

  try {
    try {
      await ffmpeg.load({ coreURL, wasmURL });
    } catch (error) {
      if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not initialize the local video encoder to prepare this GIF. Details: ${message}`);
    }
    if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');

    onProgress(1);
    try {
      await ffmpeg.writeFile(inputPath, await fetchFile(file));
    } catch (error) {
      if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not prepare ${file.name} for local editing. Details: ${message}`);
    }
    if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
        '-i', inputPath,
        '-map', '0:v:0',
        '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2:flags=lanczos,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'superfast',
        '-crf', '18',
        '-an',
        '-movflags', '+faststart',
        '-f', 'mp4',
        outputPath,
      ]);
    } catch (error) {
      if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(describeFfmpegFailure('mp4', null, ffmpegLogs, message));
    }
    if (signal.aborted) throw new DOMException('GIF conversion cancelled.', 'AbortError');
    if (exitCode !== 0) throw new Error(describeFfmpegFailure('mp4', exitCode, ffmpegLogs));

    let output: Uint8Array | string;
    try {
      output = await ffmpeg.readFile(outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`FFmpeg prepared the GIF but the browser could not read the temporary MP4. Details: ${message}`);
    }
    if (typeof output === 'string' || output.byteLength < 12 || String.fromCharCode(...output.subarray(4, 8)) !== 'ftyp') {
      throw new Error('GIF preparation did not produce a valid MP4 video.');
    }

    onProgress(100);
    const bytes = new Uint8Array(output.byteLength);
    bytes.set(output);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'video';
    return new File([bytes], `${baseName}.mp4`, { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.off('log', onFfmpegLog);
    ffmpeg.terminate();
  }
}
