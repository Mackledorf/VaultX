import { scanDirectMp4s } from './scanner.js';
import { SITE_PERMISSIONS } from './resolver.js';

const ONBOARD_URL = 'https://mackledorf.github.io/VaultX/Onboard/';
const scanButton = document.querySelector('#scan');
const stopButton = document.querySelector('#stop-scan');
const status = document.querySelector('#status');
const candidateList = document.querySelector('#candidates');
let currentDownloadId = null;
chrome.downloads.onChanged.addListener((change) => {
  if (change.id !== currentDownloadId) return;
  if (change.error?.current) setStatus(`[DOWNLOAD_${change.error.current}] Chrome could not complete the download.`, 'error');
  else if (change.state?.current === 'complete') setStatus('[DOWNLOAD_COMPLETE] Chrome finished the download.');
});
const permissionButtons = {
  x: document.querySelector('#enable-x'),
  redgifs: document.querySelector('#enable-redgifs'),
};

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatQuality(candidate) {
  if (!candidate.width || !candidate.height) return 'Quality unknown';
  const height = candidate.height >= 720
    ? `${Math.round(candidate.height / 10) * 10}p`
    : `${candidate.width}×${candidate.height}`;
  return `${height} · ${candidate.width}×${candidate.height}`;
}

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = type ? `status ${type}` : 'status';
}

function renderCandidates(candidates) {
  candidateList.replaceChildren();
  if (!candidates.length) {
    setStatus('[SCAN_EMPTY] No MP4s found yet. Play or reload the video, then scan again. This page may use a stream or protected media.');
    return;
  }

  const bestHeight = candidates[0].height;
  setStatus(`${candidates.length} direct MP4 ${candidates.length === 1 ? 'source' : 'sources'} found.`);

  for (const candidate of candidates) {
    const item = document.createElement('li');
    item.className = 'candidate';

    const heading = document.createElement('div');
    heading.className = 'candidate-heading';
    const name = document.createElement('strong');
    name.className = 'candidate-name';
    name.textContent = candidate.name;
    heading.append(name);

    if (bestHeight > 0 && candidate.height === bestHeight) {
      const badge = document.createElement('span');
      badge.className = 'best-badge';
      badge.textContent = 'Best observed';
      heading.append(badge);
    }

    const metadata = document.createElement('div');
    metadata.className = 'candidate-meta';
    const quality = document.createElement('span');
    quality.textContent = formatQuality(candidate);
    metadata.append(quality);
    if (candidate.duration > 0) {
      const duration = document.createElement('span');
      duration.textContent = formatDuration(candidate.duration);
      metadata.append(duration);
    }
    const host = document.createElement('span');
    host.className = 'candidate-host';
    host.textContent = candidate.host;
    metadata.append(host);

    const openButton = document.createElement('button');
    openButton.className = 'open-button';
    openButton.type = 'button';
    openButton.textContent = 'Open in Onboard';
    openButton.addEventListener('click', async () => {
      const token = crypto.randomUUID();
      const key = `import:${token}`;
      try {
        await chrome.storage.session.set({ [key]: candidate.url });
        const target = new URL(ONBOARD_URL);
        target.hash = new URLSearchParams({ import: token }).toString();
        await chrome.tabs.create({ url: target.href });
        setStatus('Opening the selected source in Onboard…');
      } catch (error) {
        await chrome.storage.session.remove(key).catch((cleanupError) => console.error('[IMPORT_CLEANUP]', cleanupError));
        setStatus(`[IMPORT_OPEN] Could not open Onboard: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    });

    const downloadButton = document.createElement('button');
    downloadButton.className = 'open-button';
    downloadButton.type = 'button';
    downloadButton.textContent = 'Download MP4';
    downloadButton.addEventListener('click', async () => {
      try {
        const id = await chrome.downloads.download({ url: candidate.url, saveAs: true });
        currentDownloadId = id;
        setStatus(`[DOWNLOAD_STARTED] Download ${id} started. Check Chrome downloads for its result.`);
      } catch (error) {
        setStatus(`[DOWNLOAD_START] ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    });

    const actions = document.createElement('div');
    actions.className = 'candidate-actions';
    actions.append(openButton, downloadButton);
    item.append(heading, metadata, actions);
    candidateList.append(item);
  }
}

async function scanActivePage() {
  scanButton.disabled = true;
  candidateList.replaceChildren();
  setStatus('Scanning active page…');

  try {
    const allowed = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!allowed) {
      setStatus('[SCAN_PERMISSION] Allow site access to scan embedded frames and observe MP4 requests.', 'error');
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('[SCAN_TAB] Could not access the active tab.', 'error');
      return;
    }

    const observed = await chrome.runtime.sendMessage({ type: 'scan-start', tabId: tab.id, pageUrl: tab.url });
    if (observed?.error) throw new Error(`[SCAN_OBSERVER] ${observed.error}`);
    const executions = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: scanDirectMp4s,
    });
    const candidates = new Map();
    for (const candidate of [...(observed?.candidates ?? []), ...executions.flatMap((execution) => execution.result ?? [])]) {
      const previous = candidates.get(candidate.url);
      if (!previous || candidate.height > previous.height) candidates.set(candidate.url, candidate);
    }
    renderCandidates([...candidates.values()].sort((a, b) => b.height - a.height || b.width - a.width || a.name.localeCompare(b.name)));
    if (observed?.warning) setStatus(`[SCAN_STORAGE] Some observed requests could not be saved: ${observed.warning}`, 'error');
  } catch (error) {
    setStatus(`[SCAN_ERROR] ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    scanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => void scanActivePage());
stopButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Could not access the active tab.');
    const result = await chrome.runtime.sendMessage({ type: 'scan-stop', tabId: tab.id });
    if (result?.error) throw new Error(result.error);
    candidateList.replaceChildren();
    setStatus('[SCAN_STOPPED] Observation stopped and collected URLs cleared.');
  } catch (error) {
    setStatus(`[SCAN_STOP] ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});
for (const [site, button] of Object.entries(permissionButtons)) {
  const siteName = site === 'x' ? 'X' : 'Redgifs';
  void chrome.permissions.contains({ origins: SITE_PERMISSIONS[site] }).then((allowed) => {
    if (allowed) {
      button.textContent = `${siteName} imports enabled`;
      button.disabled = true;
    }
  }).catch(() => setStatus('Could not check extension permissions.', 'error'));
  button.addEventListener('click', async () => {
    try {
      const allowed = await chrome.permissions.request({ origins: SITE_PERMISSIONS[site] });
      if (allowed) {
        button.textContent = `${siteName} imports enabled`;
        button.disabled = true;
        setStatus(`${siteName} imports are enabled.`);
      } else {
        setStatus(`${siteName} imports require permission to access its media hosts.`, 'error');
      }
    } catch {
      setStatus(`Could not enable ${siteName} imports.`, 'error');
    }
  });
}
