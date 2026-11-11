import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GIF_FALLBACK_PROFILES,
  MAX_EXPORT_BYTES,
  MP4_FALLBACK_PROFILES,
  getMp4TargetBitrate,
  outputLimitMessage,
} from './exportSizing';

test('defines hard byte ceilings for both export formats', () => {
  assert.equal(MAX_EXPORT_BYTES.gif, 5_000_000);
  assert.equal(MAX_EXPORT_BYTES.mp4, 20_000_000);
});

test('uses progressively smaller fallback profiles for GIF size control', () => {
  assert.deepEqual(GIF_FALLBACK_PROFILES.map(({ frameRate }) => frameRate), [15, 12, 10, 8]);
  assert.deepEqual(GIF_FALLBACK_PROFILES.map(({ maxDimension }) => maxDimension), [960, 720, 480, 320]);
});

test('reduces MP4 fallback bitrate within the output budget and rejects unusably low targets', () => {
  const duration = 30;
  const bitrates = MP4_FALLBACK_PROFILES.map((profile) => getMp4TargetBitrate(duration, profile));
  assert.ok(bitrates.every((bitrate) => bitrate !== null));
  assert.ok(bitrates.every((bitrate, index) => index === 0 || bitrate! < bitrates[index - 1]!));
  assert.equal(getMp4TargetBitrate(3600, MP4_FALLBACK_PROFILES[0]), null);
  assert.throws(() => getMp4TargetBitrate(0, MP4_FALLBACK_PROFILES[0]), /Could not calculate/);
});

test('explains output cap failures with actionable edit suggestions', () => {
  assert.match(outputLimitMessage('gif'), /5 MB output limit/);
  assert.match(outputLimitMessage('mp4'), /20 MB output limit/);
  assert.match(outputLimitMessage('gif'), /Shorten the retained section or use a smaller crop/);
});
