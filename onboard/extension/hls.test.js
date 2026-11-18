import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveXPlaylist, fetchHlsResource } from './hls.js';

const base = 'https://video.twimg.com/';

test('selects the highest-bandwidth rendition and its separate audio, resolving relative URLs', async () => {
  const originalFetch = globalThis.fetch;
  const playlists = {
    'master.m3u8': '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",DEFAULT=YES,URI="audio/list.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=10\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=20,AUDIO="sound"\nvideo/list.m3u8',
    'video/list.m3u8': '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\n1.m4s\n#EXTINF:1,\n2.m4s\n#EXT-X-ENDLIST',
    'audio/list.m3u8': '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\n1.m4s\n#EXT-X-ENDLIST',
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.ok(url.startsWith(base));
    return new Response(playlists[url.slice(base.length)] ?? '', { status: playlists[url.slice(base.length)] ? 200 : 404 });
  };
  try {
    assert.deepEqual(await resolveXPlaylist(`${base}master.m3u8`, new AbortController().signal), [
      { name: 'video', resources: [`${base}video/init.mp4`, `${base}video/1.m4s`, `${base}video/2.m4s`] },
      { name: 'audio', resources: [`${base}audio/init.mp4`, `${base}audio/1.m4s`] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects encrypted, live, unsupported and unsafe playlists without fetching resources', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST', /HLS_ENCRYPTED/],
    ['#EXTM3U\n#EXTINF:1,\na.ts', /HLS_LIVE/],
    ['#EXTM3U\n#EXT-X-BYTERANGE:4@0\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST', /HLS_UNSUPPORTED/],
    ['#EXTM3U\n#EXT-X-MAP:URI="init",BYTERANGE="4@0"\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST', /HLS_UNSUPPORTED/],
    ['#EXTM3U\n#EXTINF:1,\nhttps://evil.example/segment\n#EXT-X-ENDLIST', /HLS_URL/],
    ['#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST', /HLS_UNSUPPORTED/],
  ];
  try {
    for (const [body, expected] of cases) {
      let requests = 0;
      globalThis.fetch = async () => { requests += 1; return new Response(body); };
      await assert.rejects(resolveXPlaylist(`${base}master.m3u8`, new AbortController().signal), expected);
      assert.equal(requests, 1);
    }
    globalThis.fetch = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(fetchHlsResource(`${base}segment`, new AbortController().signal), /HLS_FORMAT/);
    await assert.rejects(resolveXPlaylist('https://video.twimg.com.evil.example/a', new AbortController().signal), /HLS_URL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
