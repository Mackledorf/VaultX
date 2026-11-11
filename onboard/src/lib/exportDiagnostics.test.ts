import assert from 'node:assert/strict';
import test from 'node:test';
import { describeFfmpegFailure } from './exportDiagnostics';

test('distinguishes source decoding failures from edit filter failures', () => {
  assert.match(
    describeFfmpegFailure('gif', 1, ['Invalid data found when processing input']),
    /could not decode the source video/,
  );
  assert.match(
    describeFfmpegFailure('mp4', 1, ['Error initializing filter crop']),
    /could not apply the current crop or image adjustments/,
  );
});

test('reports GIF palette and browser memory failures with targeted guidance', () => {
  assert.match(
    describeFfmpegFailure('gif', 1, ['Error initializing filter palettegen']),
    /GIF palette encoding failed/,
  );
  assert.match(
    describeFfmpegFailure('mp4', 1, ['Cannot allocate memory']),
    /ran out of memory/,
  );
});

test('keeps generic failures explicit and includes a bounded diagnostic excerpt', () => {
  const message = describeFfmpegFailure('gif', 1, ['frame processing stopped', 'Conversion failed!']);
  assert.match(message, /does not establish that the video is damaged/);
  assert.match(message, /Conversion failed!/);
});
