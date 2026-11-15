import type { FFmpeg } from '@ffmpeg/ffmpeg';

export async function videoHasAudio(ffmpeg: FFmpeg, inputPath: string) {
  const outputPath = `probe-${crypto.randomUUID()}.json`;
  await ffmpeg.ffprobe([
    '-v', 'error',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    '-o', outputPath,
    inputPath,
  ], 30_000);

  let probeOutput: string | Uint8Array;
  try {
    probeOutput = await ffmpeg.readFile(outputPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not inspect the source video for audio. Details: ${message}`);
  }
  if (typeof probeOutput !== 'string') {
    throw new Error('Could not inspect the source video for audio: invalid probe output.');
  }

  let result: unknown;
  try {
    result = JSON.parse(probeOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not inspect the source video for audio. Details: ${message}`);
  }
  if (!result || typeof result !== 'object' || !('streams' in result) || !Array.isArray(result.streams)) {
    throw new Error('Could not inspect the source video for audio: no stream information was returned.');
  }
  const streams: unknown[] = result.streams;
  const hasStream = (type: string) => streams.some((stream) => (
    !!stream && typeof stream === 'object' && 'codec_type' in stream && stream.codec_type === type
  ));
  if (!hasStream('video')) {
    throw new Error('Could not inspect the source video for audio: no video stream was found.');
  }
  return hasStream('audio');
}
