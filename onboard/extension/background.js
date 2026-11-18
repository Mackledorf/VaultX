import { fetchSharedVideo, parseSharedUrl, resolveSharedVideo, SITE_PERMISSIONS } from './resolver.js';
import { installNetworkScanner } from './network.js';
import { connectRangeSource } from './rangeSession.js';

installNetworkScanner();
const claimedTokens = new Set();

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

async function claimSelectedUrl(token) {
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error('[IMPORT_HANDOFF] Invalid import token.');
  if (claimedTokens.has(token)) throw new Error('[IMPORT_HANDOFF] This import has already started.');
  claimedTokens.add(token);
  try {
    const key = `import:${token}`;
    const stored = await chrome.storage.session.get(key);
    await chrome.storage.session.remove(key);
    if (typeof stored[key] !== 'string') throw new Error('[IMPORT_HANDOFF] This import has expired. Select the source again.');
    const url = new URL(stored[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('[IMPORT_URL] Only HTTP(S) URLs without credentials are supported.');
    }
    if (!await chrome.permissions.contains({ origins: ['<all_urls>'] })) {
      throw new Error('[IMPORT_PERMISSION] Allow site access in the extension and scan again.');
    }
    return url;
  } finally {
    claimedTokens.delete(token);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!['onboard-share-import', 'onboard-range-import'].includes(port.name)) return;
  if (!isEditor(port.sender)) {
    port.disconnect();
    return;
  }
  if (port.name === 'onboard-range-import') {
    connectRangeSource(port, claimSelectedUrl, encodeBytes);
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
    } else if (message?.type === 'start-direct' && !started && typeof message.token === 'string') {
      started = true;
      void importDirectVideo(message.token);
    }
  });

  async function importDirectVideo(token) {
    try {
      const url = await claimSelectedUrl(token);
      let response;
      try {
        response = await fetch(url.href, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error('[IMPORT_NETWORK] The extension could not reach the source. It may have expired or blocked the request.');
      }
      if (!response.ok) throw new Error(`[IMPORT_HTTP_${response.status}] The video host returned HTTP ${response.status}. It may require a session, a page referrer, or a fresh URL.`);
      if (response.status === 206) throw new Error('[IMPORT_PARTIAL] The host returned only part of the video. A complete MP4 is required.');
      const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
      if (type !== 'video/mp4' && !(url.pathname.toLowerCase().endsWith('.mp4') && ['', 'application/octet-stream', 'binary/octet-stream'].includes(type))) {
        throw new Error(`[IMPORT_FORMAT] The response is not a readable MP4 (content type: ${type || 'missing'}).`);
      }
      const pathName = url.pathname.split('/').filter(Boolean).at(-1) || '';
      let name;
      try {
        name = decodeURIComponent(pathName);
      } catch {
        name = pathName;
      }
      name = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+$/, '').trim();
      if (!name.toLowerCase().endsWith('.mp4')) name = 'onboard-video.mp4';
      await transferResponse(response, name);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Could not import this video.';
        port.postMessage({ type: 'error', message: message.startsWith('[IMPORT_') ? message : `[IMPORT_ERROR] ${message}` });
      }
    }
  }

  async function importVideo(value) {
    try {
      const post = parseSharedUrl(value);
      const allowed = await chrome.permissions.contains({ origins: SITE_PERMISSIONS[post.site] });
      if (!allowed) {
        throw new Error(`Enable ${post.site === 'x' ? 'X' : 'Redgifs'} imports in the Onboard extension, then try again.`);
      }
      const url = await resolveSharedVideo(post, controller.signal);
      const response = await fetchSharedVideo(url, controller.signal);
      await transferResponse(response, `${post.site}-${post.id}.mp4`);
    } catch (error) {
      if (!controller.signal.aborted) port.postMessage({ type: 'error', message: `[POST_IMPORT] ${error instanceof Error ? error.message : 'Could not import this post.'}` });
    }
  }

  async function transferResponse(response, name) {
    if (!response.body) throw new Error('[IMPORT_BODY] The video response did not contain a readable file.');
    const length = Number(response.headers.get('content-length'));
    port.postMessage({ type: 'start', total: Number.isFinite(length) && length > 0 ? length : null, name });
    const reader = response.body.getReader();
    let loaded = 0;
    while (!controller.signal.aborted) {
      let result;
      try {
        result = await reader.read();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error(`[IMPORT_READ] ${error instanceof Error ? error.message : String(error)}`);
      }
      if (result.done) break;
      const chunk = result.value;
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
    if (!loaded) throw new Error('[IMPORT_EMPTY] The video source returned an empty file.');
    port.postMessage({ type: 'done' });
  }
});
