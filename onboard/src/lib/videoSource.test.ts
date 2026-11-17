import assert from 'node:assert/strict';
import test from 'node:test';
import { getVideoContainerExtension, isGifFile, isSupportedStitchFile, isSupportedVideoFile } from './videoSource';

test('accepts iPhone QuickTime videos and MP4 videos by extension or video MIME type', () => {
  assert.equal(isSupportedVideoFile({ name: 'clip.MOV', type: 'video/quicktime' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip.mov', type: 'application/octet-stream' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip', type: 'video/mp4' }), true);
});

test('accepts WEBM and GIF sources by extension or MIME type', () => {
  assert.equal(isSupportedVideoFile({ name: 'clip.webm', type: 'application/octet-stream' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip', type: 'video/webm' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip.gif', type: 'application/octet-stream' }), true);
  assert.equal(isSupportedVideoFile({ name: 'clip', type: 'image/gif' }), true);
  assert.equal(isGifFile({ name: 'clip.gif', type: 'application/octet-stream' }), true);
  assert.equal(isGifFile({ name: 'clip', type: 'image/gif' }), true);
  assert.equal(isGifFile({ name: 'clip.gif', type: 'video/webm' }), false);
});

test('does not treat HEIC still images or unrelated files as videos', () => {
  assert.equal(isSupportedVideoFile({ name: 'photo.heic', type: 'image/heic' }), false);
  assert.equal(isSupportedVideoFile({ name: 'document.pdf', type: 'application/pdf' }), false);
});

test('preserves source containers when choosing the FFmpeg input filename', () => {
  assert.equal(getVideoContainerExtension({ name: 'clip.MOV', type: 'video/quicktime' }), '.mov');
  assert.equal(getVideoContainerExtension({ name: 'clip.mov', type: 'application/octet-stream' }), '.mov');
  assert.equal(getVideoContainerExtension({ name: 'clip.mp4', type: 'video/mp4' }), '.mp4');
  assert.equal(getVideoContainerExtension({ name: 'clip.webm', type: 'video/webm' }), '.webm');
  assert.equal(getVideoContainerExtension({ name: 'clip', type: 'video/webm' }), '.webm');
  assert.equal(getVideoContainerExtension({ name: 'clip.gif', type: 'image/gif' }), '.gif');
  assert.equal(getVideoContainerExtension({ name: 'clip', type: 'image/gif' }), '.gif');
});

test('keeps animated GIF and WEBM out of the existing MP4/MOV stitch workflow', () => {
  assert.equal(isSupportedStitchFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isSupportedStitchFile({ name: 'clip.mov', type: 'video/quicktime' }), true);
  assert.equal(isSupportedStitchFile({ name: 'clip.webm', type: 'video/webm' }), false);
  assert.equal(isSupportedStitchFile({ name: 'clip.gif', type: 'image/gif' }), false);
});
