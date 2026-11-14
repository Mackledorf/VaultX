import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { describeFfmpegFailure } from './exportDiagnostics';
import { buildStitchFilter, getStitchOutputDimensions, type VideoDimensions } from './stitchRecipe';
import { getVideoContainerExtension, isSupportedVideoFile } from './videoSource';

export async function stitchVideos(
  files: File[],
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  if (files.length < 2) throw new Error('Select at least two videos to stitch.');
  if (files.some((file) => !isSupportedVideoFile(file))) {
    throw new Error('Choose MP4 or MOV video files.');
  }
  if (signal.aborted) throw new DOMException('Stitch cancelled.', 'AbortError');

  onProgress(0);
  const dimensions: VideoDimensions[] = [];
  for (let index = 0; index < files.length; index += 1) {
    dimensions.push(await readVideoDimensions(
      files[index],
      signal,
      (progress) => onProgress(Math.round(((index + progress) / files.length) * 5)),
    ));
  }
  const outputSize = getStitchOutputDimensions(dimensions);
  const ffmpeg = new FFmpeg();
  const uniqueId = crypto.randomUUID();
  const inputPaths = files.map((file, index) => `stitch-source-${uniqueId}-${index}${getVideoContainerExtension(file)}`);
  const outputPath = `stitched-${uniqueId}.mp4`;
  const ffmpegLogs: string[] = [];
  const onAbort = () => ffmpeg.terminate();
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      onProgress(Math.max(5, Math.min(95, Math.round(5 + Math.max(0, Math.min(1, progress)) * 90))));
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
      if (signal.aborted) throw new DOMException('Stitch cancelled.', 'AbortError');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not initialize the local video encoder for stitching. Details: ${message}`);
    }

    for (let index = 0; index < files.length; index += 1) {
      if (signal.aborted) throw new DOMException('Stitch cancelled.', 'AbortError');
      try {
        await ffmpeg.writeFile(inputPaths[index], await fetchFile(files[index]));
      } catch (error) {
        if (signal.aborted) throw new DOMException('Stitch cancelled.', 'AbortError');
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not prepare ${files[index].name} for local stitching. Details: ${message}`);
      }
    }

    const filter = buildStitchFilter(outputSize.width, outputSize.height, files.length);
    const args = [
      ...inputPaths.flatMap((inputPath) => ['-i', inputPath]),
      '-filter_complex', filter,
      '-map', '[outv]',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-crf', '15',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-f', 'mp4',
      outputPath,
    ];

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(args, 10 * 60 * 1000);
    } catch (error) {
      if (signal.aborted) throw new DOMException('Stitch cancelled.', 'AbortError');
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout|time limit/i.test(message)) {
        throw new Error('Stitching timed out after 10 minutes. The browser could not finish processing these videos within the encoder execution limit.');
      }
      throw new Error(describeFfmpegFailure('mp4', null, ffmpegLogs, message));
    }
    if (signal.aborted) throw new DOMException('Stitch cancelled.', 'AbortError');
    if (exitCode !== 0) throw new Error(describeFfmpegFailure('mp4', exitCode, ffmpegLogs));

    let output: Uint8Array | string;
    try {
      output = await ffmpeg.readFile(outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`FFmpeg finished stitching but the browser could not read the combined video. Details: ${message}`);
    }
    if (typeof output === 'string' || output.byteLength < 12 || String.fromCharCode(...output.subarray(4, 8)) !== 'ftyp') {
      throw new Error('Stitching did not produce a valid MP4 video.');
    }
    onProgress(100);
    const bytes = new Uint8Array(output.byteLength);
    bytes.set(output);
    return new File([bytes], 'stitched-video.mp4', { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.off('log', onFfmpegLog);
    ffmpeg.terminate();
  }
}

function readVideoDimensions(
  file: File,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<VideoDimensions> {
  if (signal.aborted) return Promise.reject(new DOMException('Stitch cancelled.', 'AbortError'));

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.preload = 'metadata';

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };
    const onLoadedMetadata = () => {
      const { videoWidth: width, videoHeight: height } = video;
      cleanup();
      if (width < 2 || height < 2) {
        reject(new Error(`Could not read the dimensions of ${file.name}.`));
        return;
      }
      onProgress(1);
      resolve({ width, height });
    };
    const onError = () => {
      cleanup();
      reject(new Error(`The browser could not read ${file.name} for stitching. Its codec may not be supported for preview.`));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Stitch cancelled.', 'AbortError'));
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    video.src = objectUrl;
    video.load();
  });
}
