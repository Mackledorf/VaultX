import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSharedUrl } from './resolver.js';

test('opens a discovered embedded post through the existing share-link handoff', async () => {
  const previous = new Map();
  function install(name, value) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  function element() {
    return {
      children: [],
      listeners: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
    };
  }
  const elements = Object.fromEntries(
    ['scan', 'stop-scan', 'status', 'candidates', 'enable-x', 'enable-redgifs']
      .map((id) => [id, element()]),
  );
  const popupDocument = {
    querySelector: (selector) => elements[selector.slice(1)],
    createElement: element,
  };
  const pageDocument = {
    title: 'Reddit post',
    querySelectorAll(selector) {
      if (selector === 'iframe[src]') return [{ src: 'https://redgifs.com/ifr/Example?embed=1' }];
      return [];
    },
  };
  const opened = [];
  const stored = {};
  install('document', popupDocument);
  install('location', { href: 'https://www.reddit.com/comments/example' });
  install('performance', { getEntriesByType: () => [] });
  install('chrome', {
    downloads: { onChanged: { addListener() {} } },
    permissions: { async contains() { return true; }, async request() { return true; } },
    runtime: { async sendMessage() { return { candidates: [
      { kind: 'hls', url: 'https://video.twimg.com/master.m3u8', name: 'Stream', host: 'video.twimg.com', width: 0, height: 0, duration: 0 },
    ] }; } },
    storage: { session: {
      async set(value) { Object.assign(stored, value); },
      async remove(key) { delete stored[key]; },
    } },
    scripting: {
      async executeScript({ func }) {
        globalThis.document = pageDocument;
        try {
          return [{ result: func() }];
        } finally {
          globalThis.document = popupDocument;
        }
      },
    },
    tabs: {
      async query() { return [{ id: 1, url: 'https://www.reddit.com/comments/example' }]; },
      async create(details) { opened.push(details.url); },
    },
  });
  try {
    await import('./popup.js');
    elements.scan.listeners.click();
    while (elements.scan.disabled) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements.candidates.children.length, 2);
    const candidate = elements.candidates.children[0];
    const actions = candidate.children[2];
    assert.equal(actions.children.length, 1);
    assert.equal(actions.children[0].textContent, 'Open in Onboard');
    await actions.children[0].listeners.click();
    const target = new URL(opened[0]);
    assert.equal(target.origin, 'https://mackledorf.github.io');
    const source = new URLSearchParams(target.hash.slice(1)).get('source');
    assert.deepEqual(parseSharedUrl(source), { site: 'redgifs', id: 'example' });
    const streamActions = elements.candidates.children[1].children[2];
    assert.equal(streamActions.children.length, 1);
    await streamActions.children[0].listeners.click();
    const token = new URLSearchParams(new URL(opened[1]).hash.slice(1)).get('import');
    assert.deepEqual(stored[`import:${token}`], { kind: 'hls', url: 'https://video.twimg.com/master.m3u8' });
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
