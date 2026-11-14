import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GIF_EXPORT_SETTINGS,
  GIF_EXPORT_SETTING_VALUES,
  getGifEncodingProfile,
} from './exportSizing';

test('defaults GIF frame rate, resolution, and palette choices to Medium', () => {
  assert.deepEqual(DEFAULT_GIF_EXPORT_SETTINGS, {
    frameRate: 'medium',
    resolution: 'medium',
    colors: 'medium',
  });
  assert.deepEqual(getGifEncodingProfile(DEFAULT_GIF_EXPORT_SETTINGS), {
    frameRate: 15,
    maxDimension: 960,
    maxColors: 192,
    dither: 'bayer:bayer_scale=3',
  });
});

test('offers three independent choices for GIF frame rate, resolution, and palette colors', () => {
  const rates = GIF_EXPORT_SETTING_VALUES.frameRate;
  const resolutions = GIF_EXPORT_SETTING_VALUES.resolution;
  const colors = GIF_EXPORT_SETTING_VALUES.colors;

  assert.deepEqual([rates.low.value, rates.medium.value, rates.high.value], [10, 15, 25]);
  assert.ok(resolutions.low.value < resolutions.medium.value);
  assert.equal(resolutions.high.value, undefined);
  assert.deepEqual([colors.low.value, colors.medium.value, colors.high.value], [64, 192, 256]);
});

test('combines GIF settings independently into the requested encoding profile', () => {
  const profile = getGifEncodingProfile({
    frameRate: 'high',
    resolution: 'low',
    colors: 'medium',
  });

  assert.deepEqual(profile, {
    frameRate: 25,
    maxDimension: 720,
    maxColors: 192,
    dither: 'bayer:bayer_scale=3',
  });
  assert.equal(getGifEncodingProfile({
    frameRate: 'medium',
    resolution: 'high',
    colors: 'high',
  }).maxDimension, undefined);
});
