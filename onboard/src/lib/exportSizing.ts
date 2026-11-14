export type ExportFormat = 'gif' | 'mp4';
export type GifExportLevel = 'low' | 'medium' | 'high';
export type GifExportSettings = {
  frameRate: GifExportLevel;
  resolution: GifExportLevel;
  colors: GifExportLevel;
};

export type GifEncodingProfile = {
  frameRate: number;
  maxDimension?: number;
  maxColors: number;
  dither: string;
};

export const DEFAULT_GIF_EXPORT_SETTINGS: GifExportSettings = {
  frameRate: 'medium',
  resolution: 'medium',
  colors: 'medium',
};

export const GIF_EXPORT_SETTING_VALUES = {
  frameRate: {
    low: { label: '10 fps', value: 10 },
    medium: { label: '15 fps', value: 15 },
    high: { label: '25 fps', value: 25 },
  },
  resolution: {
    low: { label: '720 px', value: 720 },
    medium: { label: '960 px', value: 960 },
    high: { label: 'Source', value: undefined },
  },
  colors: {
    low: { label: '64 colors', value: 64 },
    medium: { label: '192 colors', value: 192 },
    high: { label: '256 colors', value: 256 },
  },
} as const;

export function getGifEncodingProfile(settings: GifExportSettings): GifEncodingProfile {
  return {
    frameRate: GIF_EXPORT_SETTING_VALUES.frameRate[settings.frameRate].value,
    maxDimension: GIF_EXPORT_SETTING_VALUES.resolution[settings.resolution].value,
    maxColors: GIF_EXPORT_SETTING_VALUES.colors[settings.colors].value,
    dither: settings.colors === 'high' ? 'sierra2_4a' : 'bayer:bayer_scale=3',
  };
}

export const GIF_EXPORT_SETTING_LEVELS: GifExportLevel[] = ['low', 'medium', 'high'];
