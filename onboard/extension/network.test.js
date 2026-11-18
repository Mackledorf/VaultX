import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateFromResponse, installNetworkScanner } from './network.js';

test('recognizes successful MP4 responses, including extensionless URLs', () => {
  const response = {
    tabId: 7, method: 'GET', statusCode: 206, url: 'https://cdn.example/media?id=1',
    responseHeaders: [{ name: 'Content-Type', value: 'video/mp4; charset=binary' }],
  };
  assert.equal(candidateFromResponse(response)?.url, response.url);
  assert.equal(candidateFromResponse({ ...response, url: 'https://cdn.example/movie.mp4', responseHeaders: [] })?.name, 'movie.mp4');
  for (const change of [
    { statusCode: 403 }, { tabId: -1 }, { method: 'POST' },
    { url: 'https://cdn.example/segment.m4s' }, { url: 'https://cdn.example/list.m3u8' },
    { url: 'https://cdn.example/list.mpd' }, { responseHeaders: [] },
    { url: 'https://user:pass@cdn.example/video.mp4' },
  ]) {
    assert.equal(candidateFromResponse({ ...response, ...change }), null);
  }
});

test('observes only the requested tab and clears results on navigation or stop', async () => {
  const previous = globalThis.chrome;
  const storage = {};
  const listeners = {};
  const event = (name) => ({ addListener(listener) { listeners[name] = listener; } });
  globalThis.chrome = {
    runtime: { id: 'extension', getURL: (path) => `chrome-extension://extension/${path}`, onMessage: event('message') },
    webRequest: { onHeadersReceived: event('headers') },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated') },
    storage: { session: {
      async get(key) { return { [key]: storage[key] }; },
      async set(value) { Object.assign(storage, structuredClone(value)); },
      async remove(key) { delete storage[key]; },
    } },
  };
  const send = (message) => new Promise((resolve) => {
    const result = listeners.message(message, { id: 'extension', url: 'chrome-extension://extension/popup.html' }, resolve);
    assert.equal(result, true);
  });
  try {
    installNetworkScanner();
    await send({ type: 'scan-start', tabId: 7, pageUrl: 'https://page.example/' });
    const response = {
      tabId: 7, method: 'GET', statusCode: 200, url: 'https://cdn.example/video',
      responseHeaders: [{ name: 'content-type', value: 'video/mp4' }],
    };
    listeners.headers({ ...response, tabId: 8 });
    listeners.headers(response);
    listeners.headers(response);
    let result = await send({ type: 'scan-start', tabId: 7, pageUrl: 'https://page.example/' });
    assert.equal(result.candidates.length, 1);
    listeners.updated(7, { url: 'https://page.example/next' });
    result = await send({ type: 'scan-start', tabId: 7, pageUrl: 'https://page.example/next' });
    assert.equal(result.candidates.length, 0);
    listeners.headers(response);
    await send({ type: 'scan-stop', tabId: 7 });
    assert.equal(storage.networkScan, undefined);
    assert.equal(listeners.message({ type: 'scan-start', tabId: 8 }, { id: 'extension', url: 'https://other.example/' }, () => {}), undefined);
  } finally {
    globalThis.chrome = previous;
  }
});
