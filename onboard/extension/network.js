export function candidateFromResponse(details) {
  if (details.tabId < 0 || details.method !== 'GET' || ![200, 206].includes(details.statusCode)) return null;
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const path = url.pathname.toLowerCase();
  const contentType = details.responseHeaders?.find((header) => header.name.toLowerCase() === 'content-type')?.value
    ?.split(';', 1)[0].trim().toLowerCase();
  if (url.protocol === 'https:' && url.hostname === 'video.twimg.com' && !url.port && details.statusCode === 200
      && (path.endsWith('.m3u8') || /^(application|audio)\/(?:x-mpegurl|vnd\.apple\.mpegurl)$/.test(contentType || ''))) {
    url.hash = '';
    const name = url.pathname.split('/').filter(Boolean).slice(-3).join('/') || 'Observed stream';
    return { kind: 'hls', url: url.href, name, host: url.host, width: 0, height: 0, duration: 0 };
  }
  if (url.hostname === 'video.twimg.com' && /\/(?:vid|aud)\/[^/]+\/\d+\/\d+\//.test(path)) return null;
  if (/\.(m3u8|mpd|m4s|ts|webm|mov)$/.test(path)) return null;
  if (!path.endsWith('.mp4') && contentType !== 'video/mp4') return null;
  url.hash = '';
  let name = url.pathname.split('/').filter(Boolean).at(-1) || 'video.mp4';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the original path if it is not valid percent-encoded text.
  }
  return { url: url.href, name, host: url.host, width: 0, height: 0, duration: 0 };
}

export function installNetworkScanner() {
  let queue = Promise.resolve();
  let observerError = null;
  function update(operation) {
    const result = queue.then(operation);
    queue = result.catch((error) => {
      observerError = error instanceof Error ? error.message : String(error);
      console.error('[SCAN_STORAGE]', error);
    });
    return result;
  }

  chrome.webRequest.onHeadersReceived.addListener((details) => {
    const candidate = candidateFromResponse(details);
    if (!candidate) return;
    void update(async () => {
      const { networkScan } = await chrome.storage.session.get('networkScan');
      if (!networkScan || networkScan.tabId !== details.tabId) return;
      if (networkScan.candidates.some((item) => item.url === candidate.url)) return;
      networkScan.candidates.push(candidate);
      await chrome.storage.session.set({ networkScan });
    }).catch(() => {});
  }, { urls: ['<all_urls>'] }, ['responseHeaders']);

  chrome.tabs.onRemoved.addListener((tabId) => {
    void update(async () => {
      const { networkScan } = await chrome.storage.session.get('networkScan');
      if (networkScan?.tabId === tabId) await chrome.storage.session.remove('networkScan');
    }).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url) return;
    void update(async () => {
      const { networkScan } = await chrome.storage.session.get('networkScan');
      if (networkScan?.tabId !== tabId || networkScan.pageUrl === change.url) return;
      await chrome.storage.session.set({ networkScan: { tabId, pageUrl: change.url, candidates: [] } });
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
    if (!['scan-start', 'scan-stop'].includes(message?.type) || !Number.isInteger(message.tabId)) return;
    void update(async () => {
      const { networkScan } = await chrome.storage.session.get('networkScan');
      if (message.type === 'scan-stop') {
        if (networkScan?.tabId === message.tabId) await chrome.storage.session.remove('networkScan');
        return { candidates: [] };
      }
      const scan = networkScan?.tabId === message.tabId && networkScan.pageUrl === message.pageUrl
        ? networkScan : { tabId: message.tabId, pageUrl: message.pageUrl, candidates: [] };
      await chrome.storage.session.set({ networkScan: scan });
      const warning = observerError;
      observerError = null;
      return { candidates: scan.candidates, warning };
    }).then(sendResponse, (error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}
