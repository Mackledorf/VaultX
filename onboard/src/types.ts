export type CropRect = { x: number; y: number; width: number; height: number };

export type VideoEditRecipe = {
  segments: Array<{
    startTime: number;
    endTime: number;
    playbackRate: number;
    crop?: CropRect;
    cropAspectRatio?: number | null;
  }>;
  rotation: 0 | 90 | 180 | 270;
  crop: CropRect;
  adjustments: Record<string, number>;
};
