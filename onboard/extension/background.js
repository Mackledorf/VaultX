import { fetchSharedVideo, parseSharedUrl, resolveSharedVideo, SITE_PERMISSIONS } from './resolver.js';

function isEditor(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    if (url.origin === 'https://mackledorf.github.io') return url.pathname.startsWith('/VaultX/Onboard/');
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && ['4178', '5173'].includes(url.port) && url.pathname === '/';
  } catch {
    return false;
  }
}

function encodeBytes(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(result);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'onboard-share-import' || !isEditor(port.sender)) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let started = false;
  let acknowledge = null;
  port.onDisconnect.addListener(() => {
    controller.abort();
    acknowledge?.();
  });
  port.onMessage.addListener((message) => {
    if (message?.type === 'cancel') {
      controller.abort();
      acknowledge?.();
    } else if (message?.type === 'ack' && acknowledge) {
      const resolve = acknowledge;
      acknowledge = null;
      resolve();
    } else if (message?.type === 'start' && !started && typeof message.url === 'string') {
      started = true;
      void importVideo(message.url);
    }
  });

  async function importVideo(value) {
    try {
      const post = parseSharedUrl(value);
      const allowed = await chrome.permissions.contains({ origins: SITE_PERMISSIONS[post.site] });
      if (!allowed) {
        throw new Error(`Enable ${post.site === 'x' ? 'X' : 'Redgifs'} imports in the Onboard extension, then try again.`);
      }
      const url = await resolveSharedVideo(post, controller.signal);
      const response = await fetchSharedVideo(url, controller.signal);
      const length = Number(response.headers.get('content-length'));
      port.postMessage({ type: 'start', total: Number.isFinite(length) && length > 0 ? length : null, name: `${post.site}-${post.id}.mp4` });
      const reader = response.body.getReader();
      let loaded = 0;
      while (!controller.signal.aborted) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < chunk.length; offset += 65536) {
          if (controller.signal.aborted) return;
          const bytes = chunk.subarray(offset, offset + 65536);
          loaded += bytes.length;
          await new Promise((resolve) => {
            acknowledge = resolve;
            port.postMessage({ type: 'chunk', data: encodeBytes(bytes), loaded });
          });
        }
      }
      if (controller.signal.aborted) return;
      if (!loaded) throw new Error('The video source returned an empty file.');
      port.postMessage({ type: 'done' });
    } catch (error) {
      if (!controller.signal.aborted) port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not import this post.' });
    }
  }
});
