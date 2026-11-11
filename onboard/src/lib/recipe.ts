import type { VideoEditRecipe } from '../types';

const PLAYBACK_RATE_MIN = 0.5;
const PLAYBACK_RATE_MAX = 2;
const ROTATIONS = [0, 90, 180, 270] as const;
const ADJUSTMENT_NAMES = [
  'exposure',
  'brilliance',
  'highlights',
  'shadows',
  'contrast',
  'brightness',
  'saturation',
  'vibrance',
  'sharpness',
  'definition',
  'clarity',
  'denoise',
] as const;
const INCREASE_ONLY_ADJUSTMENTS = new Set(['sharpness', 'definition', 'clarity', 'denoise']);

export function isIncreaseOnlyAdjustment(name: string) {
  return INCREASE_ONLY_ADJUSTMENTS.has(name);
}

export function normalizeEditRecipe(value: unknown, sourceDuration: number): VideoEditRecipe {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('Could not read the source video duration.');
  }
  const recipe = asRecord(value, 'Editing settings are required.');
  const rawSegments = Array.isArray(recipe.segments)
    ? recipe.segments
    : [{ startTime: recipe.startTime, endTime: recipe.endTime }];
  if (!rawSegments.length) {
    throw new Error('Keep at least one video section.');
  }

  const segments: VideoEditRecipe['segments'] = [];
  let previousEnd = 0;
  for (const rawSegment of rawSegments) {
    const segment = asRecord(rawSegment, 'Video section settings are invalid.');
    const startTime = finiteNumber(segment.startTime, 'Section start');
    const endTime = finiteNumber(segment.endTime, 'Section end');
    if (startTime < previousEnd || endTime <= startTime || endTime > sourceDuration) {
      throw new Error('Choose non-overlapping video sections within the source video.');
    }
    const playbackRate = finiteNumber(segment.playbackRate ?? 1, 'Playback speed');
    if (
      playbackRate < PLAYBACK_RATE_MIN
      || playbackRate > PLAYBACK_RATE_MAX
      || Math.abs(playbackRate * 10 - Math.round(playbackRate * 10)) > 1e-8
    ) {
      throw new Error('Playback speed must be between 0.5x and 2x in 0.1x increments.');
    }
    segments.push({ startTime, endTime, playbackRate });
    previousEnd = endTime;
  }
  const rotation = finiteNumber(recipe.rotation ?? 0, 'Rotation');
  if (!isRotation(rotation)) {
    throw new Error('Rotation must be 0, 90, 180, or 270 degrees.');
  }

  const rawCrop = asRecord(recipe.crop, 'A crop selection is required.');
  const crop = {
    x: finiteNumber(rawCrop.x, 'Crop left'),
    y: finiteNumber(rawCrop.y, 'Crop top'),
    width: finiteNumber(rawCrop.width, 'Crop width'),
    height: finiteNumber(rawCrop.height, 'Crop height'),
  };
  if (
    crop.x < 0 || crop.y < 0 || crop.width < 0.05 || crop.height < 0.05 ||
    crop.x + crop.width > 1.0001 || crop.y + crop.height > 1.0001
  ) {
    throw new Error('Crop settings must stay within the video frame.');
  }

  const rawAdjustments = recipe.adjustments === undefined
    ? {}
    : asRecord(recipe.adjustments, 'Adjustment settings are invalid.');
  const adjustments: Record<string, number> = {};
  for (const name of ADJUSTMENT_NAMES) {
    const amount = finiteNumber(rawAdjustments[name] ?? 0, name);
    const minimum = isIncreaseOnlyAdjustment(name) ? 0 : -100;
    if (amount < minimum || amount > 100) {
      throw new Error(`${name} must be between ${minimum} and 100.`);
    }
    adjustments[name] = amount;
  }

  return {
    segments,
    rotation,
    crop,
    adjustments,
  };
}

export function validateSourceDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Could not read the source video dimensions.');
  }
}

export function isTimeInSegments(time: number, segments: VideoEditRecipe['segments']) {
  return segments.some((segment) => time >= segment.startTime && time < segment.endTime);
}

export function getEditedDuration(segments: VideoEditRecipe['segments']) {
  return segments.reduce(
    (total, segment) => total + (segment.endTime - segment.startTime) / segment.playbackRate,
    0,
  );
}

export function buildGifFilter(recipe: VideoEditRecipe) {
  const segmentFilters = buildVideoSegmentFilters(recipe, 15);
  segmentFilters.push('[joined]split[gifsrc][palettesrc]');
  segmentFilters.push('[palettesrc]palettegen=stats_mode=diff[palette]');
  segmentFilters.push('[gifsrc][palette]paletteuse=dither=sierra2_4a[out]');
  return segmentFilters.join(';');
}

export function buildMp4Filter(recipe: VideoEditRecipe) {
  return `${buildVideoSegmentFilters(recipe, 30).join(';')};[joined]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[out]`;
}

export function buildPreviewTransferTable(adjustments: Record<string, number>) {
  const transform = getColorTransform(adjustments);
  return Array.from({ length: 256 }, (_, value) => applyColorTransform(value / 255, transform) * 255);
}

function buildVideoSegmentFilters(recipe: VideoEditRecipe, frameRate: number) {
  const { crop, adjustments, rotation } = recipe;
  const transform = getColorTransform(adjustments);
  const unsharpAmount = (adjustments.sharpness + adjustments.definition * 0.7) / 100;
  const clarityAmount = adjustments.clarity / 100;
  const denoiseAmount = adjustments.denoise;
  const rotationFilters = rotation === 90
    ? ['transpose=clock']
    : rotation === 180
      ? ['hflip', 'vflip']
      : rotation === 270
        ? ['transpose=cclock']
        : [];
  const filters = [
    ...rotationFilters,
    `crop=iw*${crop.width}:ih*${crop.height}:iw*${crop.x}:ih*${crop.y}`,
    `lutrgb=r='${buildColorTransformExpression(transform)}':g='${buildColorTransformExpression(transform)}':b='${buildColorTransformExpression(transform)}'`,
    `eq=saturation=${transform.saturation}`,
  ];
  if (unsharpAmount > 0) {
    filters.push(`unsharp=5:5:${Math.min(2, unsharpAmount).toFixed(3)}:5:5:0`);
  }
  if (clarityAmount > 0) {
    filters.push(`unsharp=7:7:${clarityAmount.toFixed(3)}:7:7:0`);
  }
  if (denoiseAmount > 0) {
    const spatialLuma = (denoiseAmount * 0.06).toFixed(2);
    const spatialChroma = (denoiseAmount * 0.03).toFixed(2);
    const temporalLuma = (denoiseAmount * 0.1).toFixed(2);
    const temporalChroma = (denoiseAmount * 0.05).toFixed(2);
    filters.push(`hqdn3d=${spatialLuma}:${spatialChroma}:${temporalLuma}:${temporalChroma}`);
  }
  const segmentFilters = recipe.segments.map((segment, index) => (
    `[0:v]trim=start=${segment.startTime}:end=${segment.endTime},setpts=(PTS-STARTPTS)/${segment.playbackRate},${filters.join(',')},fps=${frameRate}[segment${index}]`
  ));
  const segmentInputs = recipe.segments.map((_segment, index) => `[segment${index}]`).join('');
  segmentFilters.push(`${segmentInputs}concat=n=${recipe.segments.length}:v=1:a=0[joined]`);
  return segmentFilters;
}

type ColorTransform = ReturnType<typeof getColorTransform>;

function getColorTransform(adjustments: Record<string, number>) {
  const brightness = clamp((adjustments.brightness + adjustments.exposure * 0.35) / 100, -1, 1);
  const contrast = Math.max(0.1, 1 + adjustments.contrast / 100);
  const gamma = 2 ** (adjustments.exposure / 100);
  const shadowOutput = clamp(0.25 + adjustments.shadows * 0.0015, 0.05, 0.45);
  const midOutput = clamp(0.5 + adjustments.brilliance * 0.0015, shadowOutput + 0.05, 0.75);
  const highlightOutput = clamp(0.75 + adjustments.highlights * 0.0015, midOutput + 0.05, 0.95);

  return {
    brightness,
    contrast,
    gamma,
    saturation: Math.max(0, 1 + (adjustments.saturation + adjustments.vibrance * 0.6) / 100),
    curvePoints: [
      [0, 0],
      [0.25, shadowOutput],
      [0.5, midOutput],
      [0.75, highlightOutput],
      [1, 1],
    ] as const,
  };
}

function applyColorTransform(value: number, transform: ColorTransform) {
  const adjusted = clamp((value - 0.5) * transform.contrast + 0.5 + transform.brightness, 0, 1);
  const gammaAdjusted = Math.pow(adjusted, 1 / transform.gamma);
  const points = transform.curvePoints;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [startX, startY] = points[index];
    const [endX, endY] = points[index + 1];
    if (gammaAdjusted <= endX) {
      return startY + ((gammaAdjusted - startX) / (endX - startX)) * (endY - startY);
    }
  }
  return 1;
}

function buildColorTransformExpression(transform: ColorTransform) {
  const input = `clip((val/255-0.5)*${formatFilterNumber(transform.contrast)}+0.5+${formatFilterNumber(transform.brightness)},0,1)`;
  const gammaAdjusted = `pow(${input},${formatFilterNumber(1 / transform.gamma)})`;
  let curveExpression = '1';

  for (let index = transform.curvePoints.length - 2; index >= 0; index -= 1) {
    const [startX, startY] = transform.curvePoints[index];
    const [endX] = transform.curvePoints[index + 1];
    const slope = (transform.curvePoints[index + 1][1] - startY) / (endX - startX);
    const segmentExpression = `${formatFilterNumber(startY)}+(${gammaAdjusted}-${formatFilterNumber(startX)})*${formatFilterNumber(slope)}`;
    curveExpression = index === 0
      ? segmentExpression
      : `if(lt(${gammaAdjusted},${formatFilterNumber(endX)}),${segmentExpression},${curveExpression})`;
  }

  return `clip(${curveExpression},0,1)*255`;
}

function formatFilterNumber(value: number) {
  return value.toFixed(6);
}

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(error);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number.`);
  }
  return number;
}

function isRotation(value: number): value is VideoEditRecipe['rotation'] {
  return ROTATIONS.some((rotation) => rotation === value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
