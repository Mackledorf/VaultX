import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fetchExtensionMp4, fetchSharedPost, isSharedPostUrl } from './sharedSource';

function installWindow(onConnect: (port: MessagePort) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://editor.example' },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
        onConnect(ports[0]);
      },
    },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}

test('routes only supported social hosts to the extension', () => {
  assert.equal(isSharedPostUrl(new URL('https://x.com/user/status/123')), true);
  assert.equal(isSharedPostUrl(new URL('https://www.redgifs.com/watch/example')), true);
  assert.equal(isSharedPostUrl(new URL('https://x.com/video.MP4?download=1')), false);
  assert.equal(isSharedPostUrl(new URL('https://x.com.evil.example/video.mp4')), false);
});

test('imports chunks with progress and acknowledges each before finishing', async () => {
  const progress: Array<{ loaded: number; total: number | null }> = [];
  let connection: MessagePort | undefined;
  const restore = installWindow((port) => {
    connection = port;
    port.onmessage = (event: MessageEvent<{ type: string; url?: string }>) => {
      if (event.data.type === 'start') {
        assert.equal(event.data.url, 'https://x.com/user/status/123');
        port.postMessage({ type: 'start', name: 'x-123.mp4', total: 4 });
        port.postMessage({ type: 'chunk', data: btoa('test') });
      } else if (event.data.type === 'ack') {
        port.postMessage({ type: 'done' });
      } else if (event.data.type === 'close') {
        port.close();
      }
    };
    port.postMessage({ type: 'ready' });
  });

  try {
    const file = await fetchSharedPost(new URL('https://x.com/user/status/123'), (value) => progress.push(value), new AbortController().signal);
    assert.equal(file.name, 'x-123.mp4');
    assert.equal(await file.text(), 'test');
    assert.deepEqual(progress, [{ loaded: 0, total: 4 }, { loaded: 4, total: 4 }]);
  } finally {
    connection?.close();
    restore();
  }
});

test('imports a selected MP4 through a one-time extension token', async () => {
  let connection: MessagePort | undefined;
  const restore = installWindow((port) => {
    connection = port;
    port.onmessage = (event: MessageEvent<{ type: string; token?: string }>) => {
      if (event.data.type === 'start-direct') {
        assert.equal(event.data.token, 'selected-token');
        port.postMessage({ type: 'start', name: 'clip.mp4', total: 4 });
        port.postMessage({ type: 'chunk', data: btoa('test') });
      } else if (event.data.type === 'ack') port.postMessage({ type: 'done' });
      else if (event.data.type === 'close') port.close();
    };
    port.postMessage({ type: 'ready' });
  });
  try {
    const file = await fetchExtensionMp4('selected-token', () => {}, new AbortController().signal);
    assert.equal(file.name, 'clip.mp4');
    assert.equal(await file.text(), 'test');
  } finally {
    connection?.close();
    restore();
  }
});

test('aborts an in-flight import and reports unavailable extensions', async () => {
  let connection: MessagePort | undefined;
  const restore = installWindow((port) => {
    connection = port;
    port.postMessage({ type: 'ready' });
  });
  try {
    const controller = new AbortController();
    const pending = fetchSharedPost(new URL('https://x.com/user/status/123'), () => {}, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally {
    connection?.close();
    restore();
  }
  const restoreMissing = installWindow((port) => port.close());
  try {
    await assert.rejects(
      fetchSharedPost(new URL('https://x.com/user/status/123'), () => {}, new AbortController().signal),
      /could not connect to the extension/,
    );
  } finally {
    restoreMissing();
  }
});

test('cancelling while waiting for the bridge stops further attempts', async () => {
  let attempts = 0;
  const restore = installWindow((port) => {
    attempts += 1;
    port.close();
  });
  try {
    const controller = new AbortController();
    const pending = fetchExtensionMp4('selected-token', () => {}, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(attempts, 1);
  } finally {
    restore();
  }
});

test('connects when the real bridge starts after the first handoff message', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners: Array<(event: { source: object; origin: string; data: unknown; ports: MessagePort[] }) => void> = [];
  const location = { origin: 'https://mackledorf.github.io', pathname: '/VaultX/Onboard/', protocol: 'https:', hostname: 'mackledorf.github.io', port: '' };
  const browser = {
    location,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    top: null as object | null,
    addEventListener(_type: string, listener: typeof listeners[number]) { listeners.push(listener); },
    postMessage(data: unknown, origin: string, ports: MessagePort[]) {
      queueMicrotask(() => listeners.forEach((listener) => listener({ source: browser, origin, data, ports })));
    },
  };
  browser.top = browser;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  let starts = 0;
  let bridgePort: MessagePort | undefined;
  const chrome = {
    runtime: {
      connect() {
        let onMessage: (message: object) => void = () => {};
        return {
          onMessage: { addListener(listener: (message: object) => void) { onMessage = listener; } },
          onDisconnect: { addListener() {} },
          postMessage(message: { type: string; token?: string }) {
            if (message.type === 'start-direct') {
              starts += 1;
              assert.equal(message.token, 'selected-token');
              onMessage({ type: 'start', name: 'clip.mp4', total: 4 });
              onMessage({ type: 'chunk', data: btoa('test') });
            } else if (message.type === 'ack') onMessage({ type: 'done' });
          },
          disconnect() {},
        };
      },
    },
  };
  const originalPostMessage = browser.postMessage;
  browser.postMessage = (data, origin, ports) => {
    bridgePort = ports[0];
    originalPostMessage(data, origin, ports);
  };
  const timer = setTimeout(() => {
    const script = readFileSync(new URL('../../extension/bridge.js', import.meta.url), 'utf8');
    runInNewContext(script, { window: browser, location, chrome });
  }, 450);
  try {
    const file = await fetchExtensionMp4('selected-token', () => {}, new AbortController().signal);
    assert.equal(file.name, 'clip.mp4');
    assert.equal(await file.text(), 'test');
    assert.equal(starts, 1);
  } finally {
    clearTimeout(timer);
    bridgePort?.close();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
