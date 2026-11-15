import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchSharedVideo, parseSharedUrl, resolveSharedVideo } from './resolver.js';

test('accepts supported public post URLs and rejects unsafe or unrelated URLs', () => {
  assert.deepEqual(parseSharedUrl('https://x.com/name/status/123/video/1?ref=share'), { site: 'x', id: '123' });
  assert.deepEqual(parseSharedUrl('https://www.redgifs.com/watch/ExampleName'), { site: 'redgifs', id: 'examplename' });
  for (const value of [
    'https://x.com.evil.example/name/status/123',
    'https://user:pass@x.com/name/status/123',
    'http://x.com/name/status/123',
    'https://x.com/name/status/123/other',
    'https://redgifs.com/watch/../other',
  ]) {
    assert.throws(() => parseSharedUrl(value));
  }
});

test('selects the highest MP4 variant of the first supported X video and ignores unsafe URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, 'cdn.syndication.twimg.com');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return Response.json({ mediaDetails: [
      { type: 'photo' },
      { type: 'video', video_info: { variants: [
        { content_type: 'video/mp4', bitrate: 500, url: 'https://video.twimg.com/low.mp4' },
        { content_type: 'video/mp4', bitrate: 1000, url: 'https://video.twimg.com/high.mp4' },
        { content_type: 'video/mp4', bitrate: 2000, url: 'https://evil.example/unsafe.mp4' },
      ] } },
      { type: 'video', video_info: { variants: [
        { content_type: 'video/mp4', bitrate: 3000, url: 'https://video.twimg.com/second.mp4' },
      ] } },
    ] });
  };
  try {
    assert.equal(await resolveSharedVideo({ site: 'x', id: '123' }, new AbortController().signal), 'https://video.twimg.com/high.mp4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses a temporary token to resolve Redgifs metadata and falls back to SD', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/auth/temporary')) return Response.json({ token: 'temporary-test-token' });
    return Response.json({ gif: { urls: { hd: 'https://evil.example/video.mp4', sd: 'https://media.redgifs.com/sd.mp4' } } });
  };
  try {
    assert.equal(await resolveSharedVideo({ site: 'redgifs', id: 'sample' }, new AbortController().signal), 'https://media.redgifs.com/sd.mp4');
    assert.equal(requests[1].options.headers.authorization, 'Bearer temporary-test-token');
    assert.equal(requests[1].options.credentials, 'omit');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports inaccessible posts, unsupported streams and non-MP4 media', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(resolveSharedVideo({ site: 'x', id: '123' }, new AbortController().signal), /HTTP 403/);
    globalThis.fetch = async () => Response.json({ mediaDetails: [{ type: 'video', video_info: { variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a.m3u8' }] } }] });
    await assert.rejects(resolveSharedVideo({ site: 'x', id: '123' }, new AbortController().signal), /No supported MP4/);
    globalThis.fetch = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(fetchSharedVideo('https://video.twimg.com/a.mp4', new AbortController().signal), /directly readable MP4/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
