import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addTimelineClip, zoomTimeline } from './timeline';

test('adds non-overlapping clips in source order without changing their speeds', () => {
  const existing = [{ startTime: 20, endTime: 30, playbackRate: 1.5 }];
  const added = addTimelineClip(existing, 5, 10, 60);
  assert.deepEqual(added, [
    { startTime: 5, endTime: 10, playbackRate: 1 },
    { startTime: 20, endTime: 30, playbackRate: 1.5 },
  ]);
  assert.equal(addTimelineClip(added, 10, 20, 60).length, 3);
  assert.equal(existing.length, 1);
});

test('rejects reversed, out-of-bounds, and overlapping clip selections', () => {
  const segments = [{ startTime: 10, endTime: 20, playbackRate: 1 }];
  assert.throws(() => addTimelineClip(segments, 20, 10, 30), /in point/);
  assert.throws(() => addTimelineClip(segments, -1, 5, 30), /in point/);
  assert.throws(() => addTimelineClip(segments, 0, 31, 30), /in point/);
  assert.throws(() => addTimelineClip(segments, 0, 1, NaN), /in point/);
  assert.throws(() => addTimelineClip(segments, 15, 25, 30), /overlaps/);
});

test('zooms around the playhead and clamps the visible window at source boundaries', () => {
  assert.deepEqual(zoomTimeline(100, 0, 100, 25, 2, 1), { start: 12.5, span: 50 });
  assert.deepEqual(zoomTimeline(100, 80, 20, 100, 0.5, 1), { start: 60, span: 40 });
  assert.deepEqual(zoomTimeline(100, 0, 1, 0, 2, 1), { start: 0, span: 1 });
  assert.deepEqual(zoomTimeline(100, 20, 50, 25, 0.25, 1), { start: 0, span: 100 });
});
