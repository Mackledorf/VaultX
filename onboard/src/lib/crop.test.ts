import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeCrop, type CropHandle } from './crop';

test('locked crop retains its aspect ratio and stays inside the frame for every handle', () => {
  const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as CropHandle[]) {
    for (const delta of [-2, -0.1, 0.1, 2]) {
      const result = resizeCrop(crop, handle, delta, delta, 1);
      assert.ok(Math.abs(result.width / result.height - 1) < 1e-10);
      assert.ok(result.x >= -1e-10 && result.y >= -1e-10);
      assert.ok(result.x + result.width <= 1 + 1e-10 && result.y + result.height <= 1 + 1e-10);
    }
  }
});

test('freeform crop moves only the dragged edge', () => {
  assert.deepEqual(resizeCrop({ x: 0, y: 0, width: 1, height: 1 }, 'w', 0.2, 0.5, null),
    { x: 0.2, y: 0, width: 0.8, height: 1 });
});

test('locked edge resize preserves a non-square source-relative ratio and centers the other axis', () => {
  const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
  const result = resizeCrop(crop, 's', 0, -0.5, 0.5);
  assert.deepEqual(result, { x: 0.375, y: 0, width: 0.25, height: 0.5 });
});
