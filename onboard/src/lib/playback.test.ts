import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlaybackTransition } from './playback';

const segments = [
  { startTime: 0, endTime: 2, playbackRate: 1 },
  { startTime: 2, endTime: 4, playbackRate: 1.5 },
  { startTime: 6, endTime: 8, playbackRate: 0.8 },
];

test('does not transition until the next source frame reaches the segment end', () => {
  assert.deepEqual(getPlaybackTransition(1.95, 1 / 30, segments), {
    type: 'rate',
    playbackRate: 1,
  });
});

test('changes playback speed at a contiguous boundary without seeking', () => {
  assert.deepEqual(getPlaybackTransition(1.99, 1 / 30, segments), {
    type: 'rate',
    playbackRate: 1.5,
  });
});

test('uses source-time frame deltas without multiplying by the clip playback rate', () => {
  const fastSegments = [
    { startTime: 0, endTime: 2, playbackRate: 2 },
    { startTime: 2, endTime: 4, playbackRate: 1 },
  ];
  assert.deepEqual(getPlaybackTransition(1.96, 0.02, fastSegments), {
    type: 'rate',
    playbackRate: 2,
  });
});

test('seeks to the next retained clip before playing a frame in the removed gap', () => {
  assert.deepEqual(getPlaybackTransition(3.99, 1 / 30, segments), {
    type: 'seek',
    time: 6,
    playbackRate: 0.8,
    segmentIndex: 2,
  });
});

test('wraps to the first clip at the end of the last retained clip', () => {
  assert.deepEqual(getPlaybackTransition(7.99, 1 / 30, segments), {
    type: 'seek',
    time: 0,
    playbackRate: 1,
    segmentIndex: 0,
  });
});

test('seeks out of an already-entered excluded range and handles empty sections', () => {
  assert.deepEqual(getPlaybackTransition(5, 1 / 30, segments), {
    type: 'seek',
    time: 6,
    playbackRate: 0.8,
    segmentIndex: 2,
  });
  assert.equal(getPlaybackTransition(5, 1 / 30, []), null);
});
