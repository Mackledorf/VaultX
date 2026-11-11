import type { VideoEditRecipe } from '../types';

type VideoSegment = VideoEditRecipe['segments'][number];

export type PlaybackTransition =
  | { type: 'rate'; playbackRate: number }
  | { type: 'seek'; time: number; playbackRate: number; segmentIndex: number };

export function getPlaybackTransition(
  mediaTime: number,
  frameDuration: number,
  segments: VideoSegment[],
): PlaybackTransition | null {
  if (!segments.length) return null;

  const segmentIndex = segments.findIndex(
    (segment) => mediaTime >= segment.startTime && mediaTime < segment.endTime,
  );
  if (segmentIndex < 0) {
    const nextSegmentIndex = segments.findIndex((segment) => segment.startTime > mediaTime);
    const targetIndex = nextSegmentIndex >= 0 ? nextSegmentIndex : 0;
    const target = segments[targetIndex];
    return {
      type: 'seek',
      time: target.startTime,
      playbackRate: target.playbackRate,
      segmentIndex: targetIndex,
    };
  }

  const current = segments[segmentIndex];
  if (mediaTime + frameDuration < current.endTime) {
    return { type: 'rate', playbackRate: current.playbackRate };
  }

  const nextIndex = segmentIndex + 1 < segments.length ? segmentIndex + 1 : 0;
  const next = segments[nextIndex];
  const boundaryTolerance = Math.max(frameDuration / 4, 0.001);
  if (Math.abs(next.startTime - current.endTime) <= boundaryTolerance) {
    return { type: 'rate', playbackRate: next.playbackRate };
  }

  return {
    type: 'seek',
    time: next.startTime,
    playbackRate: next.playbackRate,
    segmentIndex: nextIndex,
  };
}
