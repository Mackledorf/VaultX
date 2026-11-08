import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { VideoEditRecipe } from '../types';
import { buildGifFilter, normalizeEditRecipe } from './recipe';

export async function exportGif(
  file: File,
  recipe: VideoEditRecipe,
  sourceDuration: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  const ffmpeg = new FFmpeg();
  const inputPath = `source-${crypto.randomUUID()}.mp4`;
  const outputPath = `export-${crypto.randomUUID()}.gif`;
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

    const exitCode = await ffmpeg.exec([
      '-i', inputPath,
      '-filter_complex', buildGifFilter(normalizedRecipe),
      '-map', '[out]',
      '-an',
      '-loop', '0',
      '-f', 'gif',
      outputPath,
    ], 10 * 60 * 1000);
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    if (exitCode !== 0) throw new Error('GIF export failed. Try a shorter trim or a smaller crop.');

    const output = await ffmpeg.readFile(outputPath);
    if (typeof output === 'string' || output.byteLength === 0) {
      throw new Error('GIF export produced no output.');
    }
    if (String.fromCharCode(...output.subarray(0, 3)) !== 'GIF' || output[output.byteLength - 1] !== 0x3b) {
      throw new Error('GIF export returned an invalid file.');
    }
    onProgress(100);
    const bytes = new Uint8Array(output.byteLength);
    bytes.set(output);
    return new Blob([bytes], { type: 'image/gif' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.terminate();
  }
}
