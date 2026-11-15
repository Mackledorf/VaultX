import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStitchFilter, getStitchOutputDimensions } from './stitchRecipe';

test('normalizes each source and concatenates clips in selection order', () => {
  const filter = buildStitchFilter(1920, 1080, [
    { duration: 1, hasAudio: false },
    { duration: 2, hasAudio: false },
    { duration: 3, hasAudio: false },
  ]);

  assert.match(filter, /^\[0:v:0\].*\[v0\];\[1:v:0\].*\[v1\];\[2:v:0\].*\[v2\];\[v0\]\[v1\]\[v2\]concat=n=3:v=1:a=0\[outv\]$/);
  assert.match(filter, /scale=1920:1080:force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2,setsar=1,fps=30,format=yuv420p/);
});

test('rejects invalid stitch dimensions and a single source', () => {
  const clip = { duration: 1, hasAudio: true };
  assert.throws(() => buildStitchFilter(1, 1080, [clip, clip]), /dimensions and source count are invalid/);
  assert.throws(() => buildStitchFilter(1920, 1080, [clip]), /dimensions and source count are invalid/);
  assert.throws(() => buildStitchFilter(1920, 1080, [clip, { ...clip, duration: 0 }]), /dimensions and source count are invalid/);
});

test('preserves audio and fills silent stitched clips with silence', () => {
  const filter = buildStitchFilter(1280, 720, [
    { duration: 2, hasAudio: true },
    { duration: 3, hasAudio: false },
  ]);
  assert.match(filter, /\[0:a:0\]aresample=48000:async=1:first_pts=0/);
  assert.match(filter, /anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=3/);
  assert.match(filter, /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[outv\]\[outa\]/);
});
test('uses the largest source pixel dimensions as the common output canvas', () => {
  assert.deepEqual(getStitchOutputDimensions([
    { width: 640, height: 480 },
    { width: 1921, height: 1081 },
    { width: 1080, height: 1920 },
  ]), { width: 1920, height: 1080 });
  assert.throws(() => getStitchOutputDimensions([{ width: 0, height: 1080 }]), /dimensions of every video/);
});
