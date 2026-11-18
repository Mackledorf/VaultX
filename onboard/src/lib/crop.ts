import type { VideoEditRecipe } from '../types';

type CropRect = VideoEditRecipe['crop'];
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function resizeCrop(crop: CropRect, handle: CropHandle, dx: number, dy: number, ratio: number | null): CropRect {
  const { x, y, width, height } = crop;
  const min = 0.05;
  if (ratio === null) {
    const left = handle.includes('w') ? clamp(x + dx, 0, x + width - min) : x;
    const right = handle.includes('e') ? clamp(x + width + dx, x + min, 1) : x + width;
    const top = handle.includes('n') ? clamp(y + dy, 0, y + height - min) : y;
    const bottom = handle.includes('s') ? clamp(y + height + dy, y + min, 1) : y + height;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  const horizontal = handle.includes('w') || handle.includes('e');
  const vertical = handle.includes('n') || handle.includes('s');
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const anchorX = handle.includes('w') ? x + width : x;
  const anchorY = handle.includes('n') ? y + height : y;
  const maxWidth = horizontal ? (handle.includes('w') ? anchorX : 1 - anchorX) : 2 * Math.min(centerX, 1 - centerX);
  const maxHeight = vertical ? (handle.includes('n') ? anchorY : 1 - anchorY) : 2 * Math.min(centerY, 1 - centerY);
  const widthDelta = handle.includes('w') ? -dx : dx;
  const heightDelta = handle.includes('n') ? -dy : dy;
  const desiredHeight = horizontal && vertical
    ? height + (Math.abs(widthDelta / width) > Math.abs(heightDelta / height) ? widthDelta / ratio : heightDelta)
    : horizontal ? height + widthDelta / ratio : height + heightDelta;
  const limit = Math.min(maxHeight, maxWidth / ratio);
  const nextHeight = clamp(desiredHeight, Math.min(limit, Math.max(min, min / ratio)), limit);
  const nextWidth = nextHeight * ratio;
  return {
    x: horizontal ? (handle.includes('w') ? anchorX - nextWidth : anchorX) : centerX - nextWidth / 2,
    y: vertical ? (handle.includes('n') ? anchorY - nextHeight : anchorY) : centerY - nextHeight / 2,
    width: nextWidth,
    height: nextHeight,
  };
}
