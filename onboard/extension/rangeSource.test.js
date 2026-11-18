import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { fetchByteRange, MAX_RANGE_BYTES } from './rangeSource.js';

const signal = () => new AbortController().signal;
const url = new URL('https://cdn.example/video.mp4');

test('reads exact ranges from an HTTP server, including the final short range', async () => {
  const source = Buffer.from('0123456789');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.headers);
    const [, startText, endText] = request.headers.range.match(/^bytes=(\d+)-(\d+)$/);
    const start = Number(startText);
    const end = Math.min(Number(endText), source.length - 1);
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${source.length}`, ETag: '"v1"' });
    response.end(source.subarray(start, end + 1));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const localUrl = new URL(`http://127.0.0.1:${server.address().port}/video.mp4`);
    const first = await fetchByteRange(localUrl, 2, 4, null, signal());
    assert.equal(Buffer.from(first.bytes).toString(), '234');
    assert.equal(first.total, 10);
    const last = await fetchByteRange(localUrl, 8, 20, first.validator, signal());
    assert.equal(Buffer.from(last.bytes).toString(), '89');
    assert.equal(requests[1]['if-range'], '"v1"');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('rejects invalid requests, ignored ranges, HTTP errors, and malformed responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    await assert.rejects(fetchByteRange(url, 0, MAX_RANGE_BYTES, null, signal()), /\[RANGE_REQUEST\]/);
    for (const [response, expected] of [
      [new Response('whole file'), /\[RANGE_UNSUPPORTED\]/],
      [new Response('denied', { status: 403 }), /\[RANGE_HTTP_403\]/],
      [new Response(null, { status: 416 }), /\[RANGE_HTTP_416\]/],
      [new Response('a', { status: 206, headers: { 'Content-Range': 'bytes 1-1/5', ETag: '"v1"' } }), /\[RANGE_RESPONSE\]/],
      [new Response('a', { status: 206, headers: { 'Content-Range': 'bytes 0-0/5' } }), /\[RANGE_VERSION\]/],
      [new Response('ab', { status: 206, headers: { 'Content-Range': 'bytes 0-0/5', ETag: '"v1"' } }), /\[RANGE_BODY\]/],
      [new Response('', { status: 206, headers: { 'Content-Range': 'bytes 0-0/5', ETag: '"v1"' } }), /\[RANGE_BODY\]/],
      [new Response('a', { status: 206, headers: { 'Content-Range': 'bytes 0-0/5', ETag: '"v1"', 'Content-Encoding': 'gzip' } }), /\[RANGE_ENCODING\]/],
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(fetchByteRange(url, 0, 0, null, signal()), expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refuses to combine ranges from changed sources', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers['If-Range'], '"v1"');
      return new Response('a', { status: 206, headers: { 'Content-Range': 'bytes 0-0/5', ETag: '"v2"' } });
    };
    await assert.rejects(fetchByteRange(url, 0, 0, { type: 'etag', value: '"v1"' }, signal()), /\[RANGE_VERSION\]/);
    globalThis.fetch = async () => new Response('whole file');
    await assert.rejects(fetchByteRange(url, 0, 0, { type: 'etag', value: '"v1"' }, signal()), /\[RANGE_VERSION\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
