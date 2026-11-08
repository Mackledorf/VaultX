import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGifFilter, normalizeEditRecipe, validateSourceDimensions } from './recipe';
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

test('rejects invalid sections, unsafe crop bounds, and unsupported playback rates', () => {
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, segments: [] }, 10), /at least one video section/);
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, crop: { ...baseRecipe.crop, x: 0.9 } }, 10), /Crop settings/);
  assert.throws(() => normalizeEditRecipe({ ...baseRecipe, segments: [{ ...baseRecipe.segments[0], playbackRate: 3 }] }, 10), /Playback speed/);
});

test('builds a GIF filter with cuts, rotations, crop, adjustments, and palette output', () => {
  const recipe = normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ startTime: 0, endTime: 2, playbackRate: 2 }, { startTime: 4, endTime: 8, playbackRate: 1 }],
    rotation: 90,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    adjustments: { ...baseRecipe.adjustments, denoise: 10, sharpness: 30 },
  }, 10);
  const filter = buildGifFilter(recipe);

  assert.match(filter, /transpose=clock/);
  assert.match(filter, /crop=iw\*0\.7:ih\*0\.6:iw\*0\.1:ih\*0\.2/);
  assert.match(filter, /hqdn3d=/);
  assert.match(filter, /concat=n=2/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\/2/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\/1/);
  assert.match(filter, /paletteuse=dither=sierra2_4a/);
});

test('accepts large source durations and dimensions without product-imposed limits', () => {
  assert.equal(normalizeEditRecipe({
    ...baseRecipe,
    segments: [{ startTime: 0, endTime: 3600, playbackRate: 1 }],
  }, 3600).segments[0].endTime, 3600);
  assert.doesNotThrow(() => validateSourceDimensions(1920, 1080));
  assert.doesNotThrow(() => validateSourceDimensions(12000, 8000));
});
