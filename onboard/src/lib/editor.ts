import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { VideoEditRecipe } from '../types';
import { buildGifFilter, buildMp4Filter, normalizeEditRecipe } from './recipe';

export async function exportGif(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  const blob = await exportWithFfmpeg(file, recipe, sourceDuration, onProgress, signal, 'gif');
  if (blob.type !== 'image/gif') throw new Error('GIF export returned an invalid file.');
  return blob;
}

export async function exportMp4(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  const blob = await exportWithFfmpeg(file, recipe, sourceDuration, onProgress, signal, 'mp4');
  if (blob.type !== 'video/mp4') throw new Error('MP4 export returned an invalid file.');
  return blob;
}

async function exportWithFfmpeg(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
  format: 'gif' | 'mp4',
) {
  const ffmpeg = new FFmpeg();
  const inputPath = `source-${crypto.randomUUID()}.mp4`;
  const outputPath = `export-${crypto.randomUUID()}.${format}`;
  const onAbort = () => ffmpeg.terminate();
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress(Math.max(5, Math.min(95, Math.round(5 + progress * 90))));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  ffmpeg.on('progress', onFfmpegProgress);

  try {
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    onProgress(1);
    await ffmpeg.load({ coreURL, wasmURL });
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    const normalizedRecipe = normalizeEditRecipe(recipe, sourceDuration);
    await ffmpeg.writeFile(inputPath, await fetchFile(file));
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    onProgress(5);

    const args = format === 'gif'
      ? [
        '-i', inputPath,
        '-filter_complex', buildGifFilter(normalizedRecipe),
        '-map', '[out]',
        '-an',
        '-loop', '0',
        '-f', 'gif',
        outputPath,
      ]
      : [
        '-i', inputPath,
        '-filter_complex', buildMp4Filter(normalizedRecipe),
        '-map', '[out]',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-f', 'mp4',
        outputPath,
      ];
    const exitCode = await ffmpeg.exec(args, 10 * 60 * 1000);
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    if (exitCode !== 0) throw new Error(`${format.toUpperCase()} export failed. Try a shorter trim or a smaller crop.`);

    const output = await ffmpeg.readFile(outputPath);
    if (typeof output === 'string' || output.byteLength === 0) {
      throw new Error(`${format.toUpperCase()} export produced no output.`);
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
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.terminate();
  }
}
