import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStitchFilter, getStitchOutputDimensions } from './stitchRecipe';

test('normalizes each source and concatenates clips in selection order', () => {
  const filter = buildStitchFilter(1920, 1080, 3);

  assert.match(filter, /^\[0:v:0\].*\[v0\];\[1:v:0\].*\[v1\];\[2:v:0\].*\[v2\];\[v0\]\[v1\]\[v2\]concat=n=3:v=1:a=0\[outv\]$/);
  assert.match(filter, /scale=1920:1080:force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2,setsar=1,fps=30,format=yuv420p/);
});

test('rejects invalid stitch dimensions and a single source', () => {
  assert.throws(() => buildStitchFilter(1, 1080, 2), /dimensions and source count are invalid/);
  assert.throws(() => buildStitchFilter(1920, 1080, 1), /dimensions and source count are invalid/);
});

test('uses the largest source pixel dimensions as the common output canvas', () => {
  assert.deepEqual(getStitchOutputDimensions([
    { width: 640, height: 480 },
    { width: 1921, height: 1081 },
    { width: 1080, height: 1920 },
  ]), { width: 1920, height: 1080 });
  assert.throws(() => getStitchOutputDimensions([{ width: 0, height: 1080 }]), /dimensions of every video/);
});
