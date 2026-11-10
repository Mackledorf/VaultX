export function scanDirectMp4s() {
  const candidates = new Map();
  const pageTitle = document.title || 'Video';

  function add(rawUrl, mimeType = '', video = null, title = '') {
    if (!rawUrl) return;

    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    const mime = mimeType.split(';', 1)[0].trim().toLowerCase();
    if (!url.pathname.toLowerCase().endsWith('.mp4') && mime !== 'video/mp4') return;
    url.hash = '';

    let name = title.trim();
    if (!name) {
      const pathName = url.pathname.split('/').filter(Boolean).at(-1) || 'video.mp4';
      try {
        name = decodeURIComponent(pathName);
      } catch {
        name = pathName;
      }
    }

    const activeVideo = video && video.currentSrc === url.href;
    const candidate = {
      url: url.href,
      name,
      host: url.host,
      width: activeVideo && video.videoWidth > 0 ? video.videoWidth : 0,
      height: activeVideo && video.videoHeight > 0 ? video.videoHeight : 0,
      duration: activeVideo && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
    };

    const previous = candidates.get(candidate.url);
    if (!previous || candidate.height > previous.height) candidates.set(candidate.url, candidate);
    else if (previous.name === 'video.mp4' && candidate.name !== 'video.mp4') previous.name = candidate.name;
  }

  for (const video of document.querySelectorAll('video')) {
    const title = video.getAttribute('aria-label') || video.getAttribute('title') || pageTitle;
    const sources = Array.from(video.querySelectorAll('source'));
    for (const source of sources) {
      add(source.src || source.getAttribute('src'), source.type || source.getAttribute('type') || '', video, title);
    }
    add(video.currentSrc, video.getAttribute('type') || '', video, title);
    add(video.getAttribute('src') || video.src, video.getAttribute('type') || '', video, title);
  }

  for (const anchor of document.querySelectorAll('a[href]')) {
    add(anchor.href, anchor.getAttribute('type') || '', null, anchor.getAttribute('title') || anchor.textContent || '');
  }

  for (const entry of performance.getEntriesByType('resource')) {
    add(entry.name);
  }

  return Array.from(candidates.values()).sort((left, right) => (
    right.height - left.height || right.width - left.width || left.name.localeCompare(right.name)
  ));
}
