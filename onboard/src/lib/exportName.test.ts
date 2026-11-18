import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportFileName } from './exportName';

test('formats export tags as a safe MP4 filename', () => {
  assert.equal(exportFileName(' dog  golden playful '), 'dog-golden-playful.mp4');
  assert.equal(exportFileName('../dog / cat.MP4'), 'dog-cat.mp4');
  assert.throws(() => exportFileName(' ... '), /Enter at least/);
  assert.throws(() => exportFileName('___'), /Enter at least/);
});
