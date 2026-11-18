import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanVideoSources } from './scanner.js';

function installGlobals(values) {
  const previous = new Map();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test('finds and deduplicates direct MP4 candidates while excluding streams', () => {
  const sourceUrl = 'https://cdn.example/clip.mp4?token=abc';
  const source = {
    src: sourceUrl,
    type: 'video/mp4',
    getAttribute(name) {
      return name === 'src' ? sourceUrl : name === 'type' ? 'video/mp4' : null;
    },
  };
  const video = {
    currentSrc: sourceUrl,
    src: sourceUrl,
    videoWidth: 1920,
    videoHeight: 1080,
    duration: 12.5,
    getAttribute(name) {
      return name === 'title' ? 'Trailer' : name === 'src' ? sourceUrl : null;
    },
    querySelectorAll: (selector) => selector === 'source' ? [source] : [],
  };
  const anchor = {
    href: `${sourceUrl}#t=2`,
    textContent: 'Download the trailer',
    getAttribute(name) {
      return name === 'href' ? `${sourceUrl}#t=2` : name === 'title' ? null : null;
    },
  };
  const restore = installGlobals({
    document: {
      title: 'Example page',
      querySelectorAll(selector) {
        if (selector === 'video') return [video];
        if (selector === 'a[href]') return [anchor, { href: 'https://cdn.example/stream.m3u8', getAttribute: () => null, textContent: '' }];
        return [];
      },
    },
    location: { href: 'https://page.example/watch' },
    performance: {
      getEntriesByType: () => [{ name: `${sourceUrl}#network-copy` }],
    },
  });

  try {
    const candidates = scanVideoSources();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].url, sourceUrl);
    assert.equal(candidates[0].height, 1080);
    assert.equal(candidates[0].width, 1920);
    assert.equal(candidates[0].duration, 12.5);
  } finally {
    restore();
  }
});

test('includes MP4 sources identified by MIME type without an mp4 path suffix', () => {
  const sourceUrl = 'https://cdn.example/media?id=42';
  const source = {
    src: sourceUrl,
    type: 'video/mp4',
    getAttribute(name) {
      return name === 'src' ? sourceUrl : name === 'type' ? 'video/mp4' : null;
    },
  };
  const video = {
    currentSrc: sourceUrl,
    src: sourceUrl,
    videoWidth: 0,
    videoHeight: 0,
    duration: Number.NaN,
    getAttribute: () => null,
    querySelectorAll: () => [source],
  };
  const restore = installGlobals({
    document: {
      title: 'Example page',
      querySelectorAll: (selector) => selector === 'video' ? [video] : [],
    },
    location: { href: 'https://page.example/watch' },
    performance: { getEntriesByType: () => [] },
  });

  try {
    assert.equal(scanVideoSources()[0].url, sourceUrl);
  } finally {
    restore();
  }
});

test('finds extensionless video sources in open shadow roots but excludes manifests and blob URLs', () => {
  const video = {
    currentSrc: 'https://cdn.example/play?id=42',
    src: 'blob:https://page.example/123',
    videoWidth: 0, videoHeight: 0, duration: 0,
    getAttribute: () => null,
    querySelectorAll: () => [],
  };
  const root = {
    querySelectorAll(selector) {
      if (selector === 'video') return [video];
      if (selector === 'a[href]') return [{ href: 'https://cdn.example/playlist.m3u8', getAttribute: () => null, textContent: '' }];
      return [];
    },
  };
  const restore = installGlobals({
    document: {
      title: 'Video',
      querySelectorAll: (selector) => selector === '*' ? [{ shadowRoot: root }] : [],
    },
    location: { href: 'https://page.example/' },
    performance: { getEntriesByType: () => [] },
  });
  try {
    assert.deepEqual(scanVideoSources().map((candidate) => candidate.url), ['https://cdn.example/play?id=42']);
  } finally {
    restore();
  }
});

test('discovers and deduplicates supported post links, embeds, frame pages and resources', () => {
  const anchor = (href) => ({ href, textContent: '', getAttribute: () => null });
  const shadowRoot = {
    querySelectorAll(selector) {
      if (selector === 'iframe[src]') return [{ src: 'https://redgifs.com/ifr/Second?embed=1' }];
      return [];
    },
  };
  const restore = installGlobals({
    document: {
      title: 'Post',
      querySelectorAll(selector) {
        if (selector === 'a[href]') return [
          anchor('https://www.redgifs.com/watch/Example?ref=share'),
          anchor('https://redgifs.com/ifr/example#embed'),
          anchor('https://redgifs.com.evil.example/watch/unsafe'),
          anchor('https://user@redgifs.com/watch/unsafe'),
          anchor('https://redgifs.com/users/example'),
        ];
        if (selector === 'iframe[src]') return [{ src: 'https://www.redgifs.com/ifr/Example' }];
        if (selector === '*') return [{ shadowRoot }];
        return [];
      },
    },
    location: { href: 'https://redgifs.com/ifr/Third' },
    performance: { getEntriesByType: () => [{ name: 'https://redgifs.com/watch/Fourth' }] },
  });
  try {
    const candidates = scanVideoSources();
    assert.deepEqual(candidates.map((candidate) => candidate.url).sort(), [
      'https://www.redgifs.com/watch/example',
      'https://www.redgifs.com/watch/fourth',
      'https://www.redgifs.com/watch/second',
      'https://www.redgifs.com/watch/third',
    ]);
    assert.ok(candidates.every((candidate) => candidate.kind === 'shared-post'));
  } finally {
    restore();
  }
});
