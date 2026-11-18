import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMp4Filter, buildPreviewTransferTable, getAdjustmentRange, getEditedDuration, getExportDimensions, isTimeInSegments, normalizeEditRecipe, preflightExport, validateSourceDimensions } from './recipe';
import type { VideoEditRecipe } from '../types';

const baseRecipe: VideoEditRecipe = {
  segments: [{ startTime: 0, endTime: 10, playbackRate: 1 }],
  rotation: 0,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  adjustments: {
    exposure: 0,
    brilliance: 0,
    highlights: 0,
    shadows: 0,
    contrast: 0,
    brightness: 0,
    saturation: 0,
    vibrance: 0,
    sharpness: 0,
    definition: 0,
    clarity: 0,
    denoise: 0,
  },
};

test('preview transfer follows the shared color curve and clips lighting extremes', () => {
  const identity = buildPreviewTransferTable(baseRecipe.adjustments);
  assert.ok(identity.every((value, index) => Math.abs(value - index / 255) < 1e-10));
  const lifted = buildPreviewTransferTable({ ...baseRecipe.adjustments, brightness: 50, shadows: 50 });
  assert.ok(lifted[0] > identity[0]);
  assert.equal(lifted[255], 1);
  assert.ok(lifted.every((value, index) => value >= 0 && value <= 1 && (index === 0 || value >= lifted[index - 1])));
});

test('uses finer lighting controls without changing the other adjustment ranges', () => {
  for (const name of ['exposure', 'brilliance', 'highlights', 'shadows', 'contrast', 'brightness']) {
    assert.deepEqual(getAdjustmentRange(name), { min: -50, max: 50, step: 5 });
  }
  assert.deepEqual(getAdjustmentRange('saturation'), { min: -100, max: 100, step: 10 });
  assert.deepEqual(getAdjustmentRange('denoise'), { min: 0, max: 100, step: 10 });
});

test('trims and retimes audio for the same kept sections as the video', () => {
  const recipe = {
    ...baseRecipe,
    segments: [{ startTime: 1, endTime: 3, playbackRate: 2 }, { startTime: 5, endTime: 6, playbackRate: 0.5 }],
  };
  const filter = buildMp4Filter(recipe, true);
  assert.match(filter, /atrim=start=1:end=3,asetpts=PTS-STARTPTS,atempo=2,apad,atrim=duration=1\[audio0\]/);
  assert.match(filter, /atrim=start=5:end=6,asetpts=PTS-STARTPTS,atempo=0\.5,apad,atrim=duration=2\[audio1\]/);
  assert.match(filter, /\[audio0\]\[audio1\]concat=n=2:v=0:a=1\[aout\]/);
  assert.doesNotMatch(buildMp4Filter(recipe, false), /\[0:a:0\]/);
});

test('normalizes valid multi-section editing settings and retains the selected adjustments', () => {
  const recipe = normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ startTime: 0, endTime: 2, playbackRate: 2 }, { startTime: 4, endTime: 7, playbackRate: 1 }],
    rotation: 90,
    adjustments: { ...baseRecipe.adjustments, contrast: 25 },
  }, 8);

  assert.equal(recipe.segments.length, 2);
  assert.equal(recipe.segments[0].playbackRate, 2);
  assert.equal(recipe.rotation, 90);
  assert.equal(recipe.adjustments.contrast, 25);
});

test('rejects invalid sections, unsafe crop bounds, and playback rates outside 0.5x to 2x in tenths', () => {
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, segments: [] }, 10), /at least one video section/);
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, crop: { ...baseRecipe.crop, x: 0.9 } }, 10), /Crop settings/);
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, segments: [{ ...baseRecipe.segments[0], playbackRate: 3 }] }, 10), /Playback speed/);
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, segments: [{ ...baseRecipe.segments[0], playbackRate: 1.25 }] }, 10), /0\.1x increments/);
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, segments: [{ ...baseRecipe.segments[0], playbackRate: 0.4 }] }, 10), /0\.1x increments/);
  assert.equal(normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ ...baseRecipe.segments[0], playbackRate: 0.7 }],
  }, 10).segments[0].playbackRate, 0.7);
});

test('preflights crop dimensions before encoder startup', () => {
  assert.throws(
    () => preflightExport({ ...baseRecipe, crop: { x: 0, y: 0, width: 0.05, height: 1 } }, 10, 20, 1080),
    /crop is too small/,
  );
  assert.equal(preflightExport(baseRecipe, 10, 1920, 1080).crop.width, 1);
});

test('requires a shared section aspect ratio and scales matching crops without letterboxing', () => {
  const square = { x: 0.25, y: 0, width: 0.5, height: 1 };
  const smallerSquare = { x: 0.3, y: 0.1, width: 0.4, height: 0.8 };
  const wide = { x: 0, y: 0.25, width: 1, height: 0.5 };
  const recipe = preflightExport({
    ...baseRecipe,
    segments: [
      { startTime: 0, endTime: 4, playbackRate: 1, crop: square },
      { startTime: 4, endTime: 8, playbackRate: 1, crop: smallerSquare },
    ],
  }, 10, 1920, 960);
  assert.deepEqual(recipe.segments[0].crop, square);
  assert.deepEqual(getExportDimensions(recipe, 1920, 960), { width: 960, height: 960 });
  const filter = buildMp4Filter(recipe, false, false, true, { width: 1920, height: 960 });
  assert.match(filter, /scale=960:960/);
  assert.doesNotMatch(filter, /pad=/);
  assert.throws(() => preflightExport({
    ...recipe,
    segments: [recipe.segments[0], { ...recipe.segments[1], crop: wide }],
  }, 10, 1920, 960), /same aspect ratio/);
  assert.throws(() => preflightExport({
    ...recipe,
    segments: [recipe.segments[0], { ...recipe.segments[1], crop: { ...wide, x: 0.5 } }],
  }, 10, 1920, 960), /Crop settings/);
  assert.throws(() => preflightExport({
    ...recipe,
    segments: [recipe.segments[0], { ...recipe.segments[1], crop: { x: 0, y: 0, width: 0.05, height: 0.1 } }],
  }, 10, 20, 960), /crop is too small/);
});

test('requires detail adjustments to be increase-only', () => {
  for (const name of ['sharpness', 'definition', 'clarity', 'denoise']) {
    assert.throws(() => normalizeEditRecipe({
      ...baseRecipe,
      adjustments: { ...baseRecipe.adjustments, [name]: -10 },
    }, 10), new RegExp(`${name} must be between 0 and 100`));
  }
});

test('applies clarity as an increase-only unsharp filter in MP4 exports', () => {
  const recipe = normalizeEditRecipe({
    ...baseRecipe,
    adjustments: { ...baseRecipe.adjustments, clarity: 40 },
  }, 10);

  assert.match(buildMp4Filter(recipe), /unsharp=7:7:0\.400:7:7:0/);
});

test('builds an MP4 filter with edits, 30fps output, and browser-compatible dimensions', () => {
  const recipe = normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ startTime: 0, endTime: 2, playbackRate: 1.5 }, { startTime: 4, endTime: 8, playbackRate: 1 }],
    rotation: 90,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    adjustments: { ...baseRecipe.adjustments, denoise: 10, sharpness: 30, definition: 20 },
  }, 10);
  const filter = buildMp4Filter(recipe);

  assert.match(filter, /transpose=clock/);
  assert.match(filter, /crop=iw\*0\.7:ih\*0\.6:iw\*0\.1:ih\*0\.2/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\/1\.5/);
  assert.match(filter, /fps=30,/);
  assert.match(filter, /concat=n=2:v=1:a=0\[joined\]/);
  assert.match(filter, /unsharp=5:5:0\.440:5:5:0/);
  assert.match(filter, /scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2,setsar=1\[out\]/);
});

test('accepts large source durations and dimensions without product-imposed limits', () => {
  assert.equal(normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ startTime: 0, endTime: 3600, playbackRate: 1 }],
  }, 3600).segments[0].endTime, 3600);
  assert.doesNotThrow(() => validateSourceDimensions(1920, 1080));
  assert.doesNotThrow(() => validateSourceDimensions(12000, 8000));
});

test('identifies playhead positions inside kept segments, excluding removed gaps and trim endpoints', () => {
  const segments = [
    { startTime: 1, endTime: 3, playbackRate: 1 },
    { startTime: 5, endTime: 8, playbackRate: 1 },
  ];

  assert.equal(isTimeInSegments(1, segments), true);
  assert.equal(isTimeInSegments(2.99, segments), true);
  assert.equal(isTimeInSegments(3, segments), false);
  assert.equal(isTimeInSegments(4, segments), false);
  assert.equal(isTimeInSegments(5, segments), true);
  assert.equal(isTimeInSegments(8, segments), false);
});

test('calculates output duration after segment playback speeds are applied', () => {
  assert.equal(getEditedDuration([
    { startTime: 0, endTime: 2, playbackRate: 2 },
    { startTime: 4, endTime: 7, playbackRate: 1.5 },
  ]), 3);
});
