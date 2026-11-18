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
  return fetchFromExtension({ type: 'start', url: url.href }, onProgress, signal);
}

export function fetchExtensionMp4(
  token: string,
  onProgress: (progress: RemoteSourceProgress) => void,
  signal: AbortSignal,
): Promise<File> {
  return fetchFromExtension({ type: 'start-direct', token }, onProgress, signal);
}

function fetchFromExtension(
  request: { type: 'start'; url: string } | { type: 'start-direct'; token: string },
  onProgress: (progress: RemoteSourceProgress) => void,
  signal: AbortSignal,
): Promise<File> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Import cancelled.', 'AbortError'));
      return;
    }
    let channel: MessageChannel | null = null;
    const chunks: ArrayBuffer[] = [];
    let fileName = '';
    let loaded = 0;
    let total: number | null = null;
    let finished = false;
    let connected = false;
    const timeout = window.setTimeout(() => fail(new Error('[IMPORT_BRIDGE] Onboard could not connect to the extension. Check that it is enabled and allowed on this site, then reload Onboard.')), 5000);
    const retry = window.setInterval(connect, 200);

    function closeChannel() {
      if (!channel) return;
      channel.port1.postMessage({ type: 'close' });
      channel.port1.close();
      channel = null;
    }

    function cleanup() {
      window.clearTimeout(timeout);
      window.clearInterval(retry);
      signal.removeEventListener('abort', abort);
      closeChannel();
    }
    function fail(error: Error) {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    }
    function abort() {
      channel?.port1.postMessage({ type: 'cancel' });
      fail(new DOMException('Import cancelled.', 'AbortError'));
    }

    signal.addEventListener('abort', abort, { once: true });
    function connect() {
      closeChannel();
      const attempt = new MessageChannel();
      channel = attempt;
      attempt.port1.onmessage = (event: MessageEvent<unknown>) => {
        if (finished || channel !== attempt) return;
        const message = event.data;
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        try {
          if (message.type === 'ready') {
            if (connected) return;
            connected = true;
            window.clearTimeout(timeout);
            window.clearInterval(retry);
            attempt.port1.postMessage(request);
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
            attempt.port1.postMessage({ type: 'ack' });
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
      try {
        window.postMessage({ type: 'onboard-share-import' }, window.location.origin, [attempt.port2]);
      } catch (error) {
        attempt.port2.close();
        fail(error instanceof Error ? error : new Error('[IMPORT_BRIDGE] Could not contact the extension.'));
      }
    }
    connect();
  });
}
