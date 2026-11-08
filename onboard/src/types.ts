export type VideoEditRecipe = {
  segments: Array<{ startTime: number; endTime: number; playbackRate: number }>;
  rotation: 0 | 90 | 180 | 270;
  crop: { x: number; y: number; width: number; height: number };
  adjustments: Record<string, number>;
};
