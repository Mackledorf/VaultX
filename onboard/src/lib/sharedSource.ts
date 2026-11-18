import type { RemoteSourceProgress } from './remoteSource';

const SHARED_HOSTS = new Set([
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'redgifs.com', 'www.redgifs.com',
]);

export function isSharedPostUrl(url: URL): boolean {
  return SHARED_HOSTS.has(url.hostname.toLowerCase()) && !url.pathname.toLowerCase().endsWith('.mp4');
}

export function fetchSharedPost(
  url: URL,
  onProgress: (progress: RemoteSourceProgress) => void,
  signal: AbortSignal,
): Promise<File> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Import cancelled.', 'AbortError'));
      return;
    }
    const channel = new MessageChannel();
    const chunks: ArrayBuffer[] = [];
    let fileName = '';
    let loaded = 0;
    let total: number | null = null;
    let finished = false;
    const timeout = window.setTimeout(() => fail(new Error('Install or reload the Onboard browser extension to import shared post URLs.')), 2000);

    function cleanup() {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      channel.port1.postMessage({ type: 'close' });
      channel.port1.close();
    }
    function fail(error: Error) {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    }
    function abort() {
      channel.port1.postMessage({ type: 'cancel' });
      fail(new DOMException('Import cancelled.', 'AbortError'));
    }

    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      try {
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          channel.port1.postMessage({ type: 'start', url: url.href });
        } else if (message.type === 'start' && 'name' in message && typeof message.name === 'string') {
          fileName = message.name;
          total = 'total' in message && typeof message.total === 'number' && message.total > 0 ? message.total : null;
          onProgress({ loaded, total });
        } else if (message.type === 'chunk' && 'data' in message && typeof message.data === 'string' && fileName) {
          const binary = atob(message.data);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          chunks.push(bytes.buffer);
          loaded += bytes.length;
          onProgress({ loaded, total });
          channel.port1.postMessage({ type: 'ack' });
        } else if (message.type === 'done' && fileName && loaded > 0) {
          finished = true;
          cleanup();
          resolve(new File(chunks, fileName, { type: 'video/mp4' }));
        } else if (message.type === 'error') {
          fail(new Error('message' in message && typeof message.message === 'string' ? message.message : 'Could not import this post.'));
        } else if (message.type !== 'ready') {
          fail(new Error('The Onboard extension returned an invalid response.'));
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Could not read the imported video.'));
      }
    };
    window.postMessage({ type: 'onboard-share-import' }, window.location.origin, [channel.port2]);
  });
}
