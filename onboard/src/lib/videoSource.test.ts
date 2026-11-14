import assert from 'node:assert/strict';
import test from 'node:test';
import { getVideoContainerExtension, isSupportedVideoFile } from './videoSource';

test('accepts iPhone QuickTime videos and MP4 videos by extension or video MIME type', () => {
  assert.equal(isSupportedVideoFile({ name: 'clip.MOV', type: 'video/quicktime' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip.mov', type: 'application/octet-stream' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip', type: 'video/mp4' }), true);
});

test('does not treat HEIC still images or unrelated files as videos', () => {
  assert.equal(isSupportedVideoFile({ name: 'photo.heic', type: 'image/heic' }), false);
  assert.equal(isSupportedVideoFile({ name: 'document.pdf', type: 'application/pdf' }), false);
});

test('preserves the MOV container when choosing the FFmpeg input filename', () => {
  assert.equal(getVideoContainerExtension({ name: 'clip.MOV', type: 'video/quicktime' }), '.mov');
  assert.equal(getVideoContainerExtension({ name: 'clip.mov', type: 'application/octet-stream' }), '.mov');
  assert.equal(getVideoContainerExtension({ name: 'clip.mp4', type: 'video/mp4' }), '.mp4');
});
