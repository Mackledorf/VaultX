import assert from 'node:assert/strict';
import { test } from 'node:test';

let connect;
let allowed = false;
const session = {};
globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    onConnect: { addListener(listener) { connect = listener; } },
    onMessage: { addListener() {} },
    getURL: (path) => `chrome-extension://test-extension/${path}`,
  },
  permissions: { async contains() { return allowed; } },
  webRequest: { onHeadersReceived: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
  storage: {
    session: {
      async get(key) { return { [key]: session[key] }; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; },
    },
  },
};
await import('./background.js');

function createPort(url = 'https://mackledorf.github.io/VaultX/Onboard/') {
  let onMessage;
  let onDisconnect;
  const messages = [];
  let resolveMessage;
  const port = {
    name: 'onboard-share-import',
    sender: { id: 'test-extension', frameId: 0, url },
    onMessage: { addListener(listener) { onMessage = listener; } },
    onDisconnect: { addListener(listener) { onDisconnect = listener; } },
    postMessage(message) {
      messages.push(message);
      resolveMessage?.();
      resolveMessage = null;
    },
    disconnect() { port.disconnected = true; onDisconnect?.(); },
    send(message) { onMessage(message); },
    async next(type) {
      while (!messages.some((message) => message.type === type)) {
        await new Promise((resolve) => { resolveMessage = resolve; });
      }
      return messages.find((message) => message.type === type);
    },
    messages,
    disconnected: false,
  };
  return port;
}

test('rejects messages from unrelated pages and reports missing site permissions', async () => {
  const untrusted = createPort('https://mackledorf.github.io/other/');
  connect(untrusted);
  assert.equal(untrusted.disconnected, true);

  allowed = false;
  const port = createPort();
  connect(port);
  port.send({ type: 'start', url: 'https://x.com/user/status/123' });
  assert.match((await port.next('error')).message, /Enable X imports/);
});

test('imports only a selected, one-time direct MP4 and reports HTTP failures', async () => {
  const originalFetch = globalThis.fetch;
  const token = '11111111-1111-4111-8111-111111111111';
  allowed = true;
  session[`import:${token}`] = 'https://cdn.example/clip.mp4';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://cdn.example/clip.mp4');
    assert.equal(options.credentials, 'omit');
    return new Response('denied', { status: 403 });
  };
  try {
    const port = createPort();
    connect(port);
    port.send({ type: 'start-direct', token });
    assert.match((await port.next('error')).message, /\[IMPORT_HTTP_403\]/);
    assert.equal(session[`import:${token}`], undefined);
    const replay = createPort();
    connect(replay);
    replay.send({ type: 'start-direct', token });
    assert.match((await replay.next('error')).message, /\[IMPORT_HANDOFF\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transfers the selected extensionless MP4 to the editor', async () => {
  const originalFetch = globalThis.fetch;
  const token = '22222222-2222-4222-8222-222222222222';
  allowed = true;
  session[`import:${token}`] = 'https://cdn.example/video?id=1';
  globalThis.fetch = async () => new Response('test', { headers: { 'content-type': 'video/mp4', 'content-length': '4' } });
  try {
    const port = createPort();
    connect(port);
    port.send({ type: 'start-direct', token });
    assert.equal((await port.next('start')).name, 'onboard-video.mp4');
    assert.equal(Buffer.from((await port.next('chunk')).data, 'base64').toString(), 'test');
    port.send({ type: 'ack' });
    await port.next('done');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streams bounded chunks only after acknowledgements', async () => {
  const originalFetch = globalThis.fetch;
  const source = new Uint8Array(140000).map((_, index) => index % 251);
  allowed = true;
  globalThis.fetch = async (url) => {
    if (new URL(url).hostname === 'cdn.syndication.twimg.com') {
      return Response.json({ mediaDetails: [{ type: 'video', video_info: { variants: [
        { content_type: 'video/mp4', url: 'https://video.twimg.com/test.mp4', bitrate: 1 },
      ] } }] });
    }
    return new Response(source, { headers: { 'content-type': 'video/mp4', 'content-length': String(source.length) } });
  };
  try {
    const port = createPort();
    connect(port);
    port.send({ type: 'start', url: 'https://x.com/user/status/123' });
    assert.equal((await port.next('start')).total, source.length);
    await port.next('chunk');
    assert.equal(port.messages.filter((message) => message.type === 'chunk').length, 1);
    for (let count = 1; count <= 3; count += 1) {
      port.send({ type: 'ack' });
      if (count < 3) {
        while (port.messages.filter((message) => message.type === 'chunk').length <= count) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    await port.next('done');
    const received = Buffer.concat(port.messages.filter((message) => message.type === 'chunk')
      .map((message) => Buffer.from(message.data, 'base64')));
    assert.deepEqual(received, Buffer.from(source));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cancellation aborts an in-flight transfer without reporting success', async () => {
  const originalFetch = globalThis.fetch;
  let downloadSignal;
  allowed = true;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === 'cdn.syndication.twimg.com') {
      return Response.json({ mediaDetails: [{ type: 'video', video_info: { variants: [
        { content_type: 'video/mp4', url: 'https://video.twimg.com/test.mp4' },
      ] } }] });
    }
    downloadSignal = options.signal;
    return new Response(new Uint8Array(100000), { headers: { 'content-type': 'video/mp4' } });
  };
  try {
    const port = createPort();
    connect(port);
    port.send({ type: 'start', url: 'https://x.com/user/status/123' });
    await port.next('chunk');
    port.send({ type: 'cancel' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(downloadSignal.aborted, true);
    assert.equal(port.messages.some((message) => message.type === 'done'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
