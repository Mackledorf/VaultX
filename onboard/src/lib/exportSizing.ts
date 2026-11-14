export type ExportFormat = 'gif' | 'mp4';
export type GifQuality = 'low' | 'medium' | 'high';

export type GifEncodingProfile = {
  frameRate: number;
  maxDimension?: number;
  maxColors: number;
  dither: string;
};

export const DEFAULT_GIF_QUALITY: GifQuality = 'medium';

export const GIF_QUALITY_PROFILES: Record<GifQuality, GifEncodingProfile> = {
  low: {
    frameRate: 15,
    maxDimension: 720,
    maxColors: 128,
    dither: 'bayer:bayer_scale=3',
  },
  medium: {
    frameRate: 15,
    maxDimension: 960,
    maxColors: 192,
    dither: 'bayer:bayer_scale=3',
  },
  high: {
    frameRate: 15,
    maxColors: 256,
    dither: 'sierra2_4a',
  },
};

export const GIF_QUALITY_DESCRIPTIONS: Record<GifQuality, string> = {
  low: '15 fps · up to 720 px · 128 colors',
  medium: '15 fps · up to 960 px · 192 colors',
  high: '15 fps · source resolution · 256 colors',
};
