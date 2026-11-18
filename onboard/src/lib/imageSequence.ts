import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { describeFfmpegFailure } from './exportDiagnostics';

export function isStillImage(file: Pick<File, 'name' | 'type'>) {
  return file.type.toLowerCase().startsWith('image/') && file.type.toLowerCase() !== 'image/gif'
    || /\.(png|jpe?g|webp|bmp|avif|heic|heif)$/i.test(file.name);
}

export async function prepareImageSequence(files: File[], onProgress: (progress: number) => void, signal: AbortSignal) {
  if (!files.length || files.some((file) => !isStillImage(file))) throw new Error('Choose only still images for an image sequence.');
  const ffmpeg = new FFmpeg();
  const logs: string[] = [];
  const abort = () => ffmpeg.terminate();
  const checkAbort = () => {
    if (signal.aborted) throw new DOMException('Image preparation cancelled.', 'AbortError');
  };
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 200) logs.shift();
  };
  const onEncodeProgress = ({ time }: { time: number }) => {
    if (Number.isFinite(time)) onProgress(Math.max(50, Math.min(95, Math.round(50 + time / 1_000_000 / files.length * 45))));
  };
  signal.addEventListener('abort', abort, { once: true });
  ffmpeg.on('log', onLog);
  ffmpeg.on('progress', onEncodeProgress);
  try {
    checkAbort();
    await ffmpeg.load({ coreURL, wasmURL });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create an image canvas.');
    for (let index = 0; index < files.length; index += 1) {
      checkAbort();
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(files[index]);
      } catch (error) {
        throw new Error(`The browser could not decode ${files[index].name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        if (index === 0) {
          canvas.width = Math.ceil(bitmap.width / 2) * 2;
          canvas.height = Math.ceil(bitmap.height / 2) * 2;
        }
        const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error(`Could not prepare ${files[index].name}.`)),
          'image/png',
        ));
        checkAbort();
        await ffmpeg.writeFile(`frame-${String(index).padStart(8, '0')}.png`, new Uint8Array(await blob.arrayBuffer()));
        onProgress(Math.round((index + 1) / files.length * 50));
      } finally {
        bitmap.close();
      }
    }
    checkAbort();
    const code = await ffmpeg.exec([
      '-framerate', '1', '-start_number', '0', '-i', 'frame-%08d.png',
      '-vf', 'tpad=stop_mode=clone:stop_duration=1,fps=30,format=yuv420p',
      '-t', String(files.length), '-an', '-c:v', 'libx264', '-preset', 'superfast',
      '-crf', '18', '-movflags', '+faststart', '-f', 'mp4', 'images.mp4',
    ]);
    checkAbort();
    if (code !== 0) throw new Error(describeFfmpegFailure('mp4', code, logs));
    const output = await ffmpeg.readFile('images.mp4');
    if (typeof output === 'string' || output.byteLength < 12 || String.fromCharCode(...output.subarray(4, 8)) !== 'ftyp') {
      throw new Error('Image preparation did not produce a valid MP4 video.');
    }
    const bytes = new Uint8Array(output.byteLength);
    bytes.set(output);
    onProgress(100);
    return new File([bytes], 'image-sequence.mp4', { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', abort);
    ffmpeg.off('log', onLog);
    ffmpeg.off('progress', onEncodeProgress);
    ffmpeg.terminate();
  }
}
