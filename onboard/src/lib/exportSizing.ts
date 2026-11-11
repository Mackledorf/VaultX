export type ExportFormat = 'gif' | 'mp4';

export type GifEncodingProfile = {
  frameRate: number;
  maxDimension?: number;
  maxColors: number;
  dither: string;
};

export type Mp4EncodingProfile = {
  maxDimension?: number;
  bitrateFraction: number;
};

export const MAX_EXPORT_BYTES: Record<ExportFormat, number> = {
  gif: 5_000_000,
  mp4: 20_000_000,
};

export const GIF_FALLBACK_PROFILES: GifEncodingProfile[] = [
  { frameRate: 15, maxColors: 192, dither: 'bayer:bayer_scale=3' },
  { frameRate: 15, maxColors: 128, dither: 'bayer:bayer_scale=3' },
  { frameRate: 15, maxDimension: 960, maxColors: 128, dither: 'bayer:bayer_scale=3' },
  { frameRate: 15, maxDimension: 720, maxColors: 96, dither: 'bayer:bayer_scale=3' },
  { frameRate: 15, maxDimension: 480, maxColors: 64, dither: 'bayer:bayer_scale=3' },
];

export const MP4_FALLBACK_PROFILES: Mp4EncodingProfile[] = [
  { bitrateFraction: 0.8 },
  { maxDimension: 1920, bitrateFraction: 0.7 },
  { maxDimension: 1280, bitrateFraction: 0.6 },
  { maxDimension: 960, bitrateFraction: 0.5 },
  { maxDimension: 640, bitrateFraction: 0.4 },
];

const MIN_MP4_BITRATE = 64_000;

export function getMp4TargetBitrate(duration: number, profile: Mp4EncodingProfile) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Could not calculate the MP4 output size target.');
  }
  const bitrate = Math.floor((MAX_EXPORT_BYTES.mp4 * 8 * profile.bitrateFraction) / duration);
  return bitrate >= MIN_MP4_BITRATE ? bitrate : null;
}

export function outputLimitMessage(format: ExportFormat) {
  if (format === 'gif') {
    return 'This GIF cannot fit under the 5 MB output limit at the minimum supported quality. Shorten the retained section or use a smaller crop and retry.';
  }
  return 'This MP4 cannot fit under the 20 MB output limit at the minimum supported quality. Shorten the retained section or use a smaller crop and retry.';
}
