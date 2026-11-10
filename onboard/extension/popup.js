import { scanDirectMp4s } from './scanner.js';

const ONBOARD_URL = 'https://mackledorf.github.io/VaultX/';
const scanButton = document.querySelector('#scan');
const status = document.querySelector('#status');
const candidateList = document.querySelector('#candidates');

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
    setStatus('No direct MP4s found. This page may use another video format.');
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
      const target = new URL(ONBOARD_URL);
      target.hash = new URLSearchParams({ source: candidate.url }).toString();
      try {
        await chrome.tabs.create({ url: target.href });
        setStatus('Opening the selected source in Onboard…');
      } catch {
        setStatus('Could not open Onboard in a new tab.', 'error');
      }
    });

    item.append(heading, metadata, openButton);
    candidateList.append(item);
  }
}

async function scanActivePage() {
  scanButton.disabled = true;
  candidateList.replaceChildren();
  setStatus('Scanning active page…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('Could not access the active tab.', 'error');
      return;
    }

    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanDirectMp4s,
    });
    renderCandidates(execution?.result ?? []);
  } catch {
    setStatus('This browser page cannot be scanned. Try a regular website tab.', 'error');
  } finally {
    scanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => void scanActivePage());
void scanActivePage();
