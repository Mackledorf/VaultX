import type { VideoEditRecipe } from '../types';

type Segment = VideoEditRecipe['segments'][number];

export function addTimelineClip(segments: Segment[], startTime: number, endTime: number, duration: number): Segment[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(startTime) || !Number.isFinite(endTime)
      || startTime < 0 || endTime > duration || endTime <= startTime) {
    throw new Error('Choose an in point before the out point within the source video.');
  }
  if (segments.some((segment) => startTime < segment.endTime && endTime > segment.startTime)) {
    throw new Error('The selected clip overlaps an existing section.');
  }
  return [...segments, { startTime, endTime, playbackRate: 1 }].sort((a, b) => a.startTime - b.startTime);
}

export function zoomTimeline(
  duration: number,
  start: number,
  span: number,
  anchor: number,
  factor: number,
  minimumSpan: number,
): { start: number; span: number } {
  const nextSpan = Math.min(duration, Math.max(Math.min(duration, minimumSpan), span / factor));
  const ratio = Math.max(0, Math.min(1, (anchor - start) / span));
  const nextStart = Math.max(0, Math.min(duration - nextSpan, anchor - ratio * nextSpan));
  return { start: nextStart, span: nextSpan };
}
