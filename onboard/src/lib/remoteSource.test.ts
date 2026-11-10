import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchRemoteMp4, parseRemoteMp4Url } from './remoteSource';

test('parses absolute HTTP(S) URLs and removes source fragments', () => {
  assert.equal(parseRemoteMp4Url('https://cdn.example/video.mp4?token=abc#t=5').href, 'https://cdn.example/video.mp4?token=abc');
  assert.equal(parseRemoteMp4Url('http://cdn.example/video.mp4').protocol, 'http:');
});

test('rejects invalid, non-HTTP, and credential-bearing URLs', () => {
  assert.throws(() => parseRemoteMp4Url(null), /did not include/);
  assert.throws(() => parseRemoteMp4Url('file:///tmp/video.mp4'), /HTTP\(S\)/);
  assert.throws(() => parseRemoteMp4Url('https://user:pass@cdn.example/video.mp4'), /HTTP\(S\)/);
});

test('fetches a CORS-readable MP4 and reports byte progress', async () => {
  const originalFetch = globalThis.fetch;
  const progress: Array<{ loaded: number; total: number | null }> = [];
  globalThis.fetch = async (_input, options) => {
    assert.equal(options?.mode, 'cors');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.referrerPolicy, 'no-referrer');
    return new Response(new Uint8Array([0, 0, 0, 1]), {
      headers: { 'content-type': 'video/mp4', 'content-length': '4' },
    });
  };

  try {
    const file = await fetchRemoteMp4(
      new URL('https://cdn.example/clip'),
      (value) => progress.push(value),
      new AbortController().signal,
    );
    assert.equal(file.name, 'onboard-video.mp4');
    assert.equal(file.type, 'video/mp4');
    assert.equal(file.size, 4);
    assert.equal(progress.at(-1)?.loaded, 4);
    assert.equal(progress.at(-1)?.total, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects non-MP4 responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not a video', {
    headers: { 'content-type': 'text/html' },
  });

  try {
    await assert.rejects(
      fetchRemoteMp4(new URL('https://cdn.example/watch'), () => {}, new AbortController().signal),
      /did not return a directly readable MP4/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports a cross-origin fetch failure with the local-file fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await assert.rejects(
      fetchRemoteMp4(new URL('https://cdn.example/clip.mp4'), () => {}, new AbortController().signal),
      /cross-origin access \(CORS\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
