import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGifFilter, buildMp4Filter, buildPreviewTransferTable, getEditedDuration, isTimeInSegments, normalizeEditRecipe, preflightExport, validateSourceDimensions } from './recipe';
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

test('requires detail adjustments to be increase-only', () => {
  for (const name of ['sharpness', 'definition', 'clarity', 'denoise']) {
    assert.throws(() => normalizeEditRecipe({
      ...baseRecipe,
      adjustments: { ...baseRecipe.adjustments, [name]: -10 },
    }, 10), new RegExp(`${name} must be between 0 and 100`));
  }
});

test('builds a GIF filter with cuts, rotations, crop, adjustments, and palette output', () => {
  const recipe = normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ startTime: 0, endTime: 2, playbackRate: 2 }, { startTime: 4, endTime: 8, playbackRate: 1 }],
    rotation: 90,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    adjustments: { ...baseRecipe.adjustments, denoise: 10, sharpness: 30, definition: 20 },
  }, 10);
  const filter = buildGifFilter(recipe);

  assert.match(filter, /transpose=clock/);
  assert.match(filter, /crop=iw\*0\.7:ih\*0\.6:iw\*0\.1:ih\*0\.2/);
  assert.match(filter, /hqdn3d=/);
  assert.match(filter, /unsharp=5:5:0\.440:5:5:0/);
  assert.match(filter, /lutrgb=r='/);
  assert.match(filter, /eq=saturation=1/);
  assert.match(filter, /concat=n=2/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\/2/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\/1/);
  assert.match(filter, /paletteuse=dither=sierra2_4a/);
});

test('uses lower frame rates, dimensions, and stable dithering for GIF size fallbacks', () => {
  const filter = buildGifFilter(baseRecipe, {
    frameRate: 10,
    maxDimension: 480,
    dither: 'bayer:bayer_scale=3',
  });

  assert.match(filter, /scale=w='min\(iw,480\)'/);
  assert.match(filter, /fps=10,scale=w='min\(iw,480\)'/);
  assert.match(filter, /paletteuse=dither=bayer:bayer_scale=3/);
});

test('samples output frames before frame-local adjustments but keeps temporal denoise before sampling', () => {
  const defaultFilter = buildGifFilter(baseRecipe);
  assert.ok(defaultFilter.indexOf('fps=15') < defaultFilter.indexOf('lutrgb='));

  const scaledFilter = buildGifFilter(baseRecipe, { maxDimension: 480 });
  assert.ok(scaledFilter.indexOf('fps=15') < scaledFilter.indexOf('scale=w='));

  const denoisedFilter = buildGifFilter({
    ...baseRecipe,
    adjustments: { ...baseRecipe.adjustments, denoise: 20 },
  });
  assert.ok(denoisedFilter.indexOf('hqdn3d=') < denoisedFilter.indexOf('fps=15'));
});

test('applies clarity as an increase-only unsharp filter in GIF and MP4 exports', () => {
  const recipe = normalizeEditRecipe({
    ...baseRecipe,
    adjustments: { ...baseRecipe.adjustments, clarity: 40 },
  }, 10);

  assert.match(buildGifFilter(recipe), /unsharp=7:7:0\.400:7:7:0/);
  assert.match(buildMp4Filter(recipe), /unsharp=7:7:0\.400:7:7:0/);
});

test('uses the same tonal transfer for the preview and encoded video', () => {
  const identity = buildPreviewTransferTable(baseRecipe.adjustments);
  assert.equal(identity.length, 256);
  assert.equal(identity[0], 0);
  assert.equal(identity[128], 128);
  assert.equal(identity[255], 255);

  const adjustments = { ...baseRecipe.adjustments, exposure: 40, shadows: 30, highlights: -20 };
  const transfer = buildPreviewTransferTable(adjustments);
  const recipe = normalizeEditRecipe({ ...baseRecipe, adjustments }, 10);
  const filter = buildMp4Filter(recipe);

  assert.notDeepEqual(transfer, identity);
  assert.match(filter, /lutrgb=r='/);
  assert.match(filter, /pow\(/);
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

test('bounds MP4 fallback dimensions while retaining the output frame rate', () => {
  const filter = buildMp4Filter(baseRecipe, 720);

  assert.match(filter, /fps=30,/);
  assert.match(filter, /scale=w='min\(iw,720\)'/);
  assert.match(filter, /fps=30,scale=w='min\(iw,720\)'/);
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
