import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GIF_QUALITY,
  GIF_QUALITY_PROFILES,
} from './exportSizing';

test('defaults to Medium and keeps every GIF quality profile at 15 fps', () => {
  assert.equal(DEFAULT_GIF_QUALITY, 'medium');
  assert.ok(Object.values(GIF_QUALITY_PROFILES).every(({ frameRate }) => frameRate === 15));
});

test('offers ordered quality trade-offs in palette size and output dimensions', () => {
  const { low, medium, high } = GIF_QUALITY_PROFILES;

  assert.ok(low.maxColors < medium.maxColors);
  assert.ok(medium.maxColors < high.maxColors);
  assert.ok(low.maxDimension! < medium.maxDimension!);
  assert.equal(high.maxDimension, undefined);
  assert.equal(low.dither, 'bayer:bayer_scale=3');
  assert.equal(medium.dither, 'bayer:bayer_scale=3');
  assert.equal(high.dither, 'sierra2_4a');
});
