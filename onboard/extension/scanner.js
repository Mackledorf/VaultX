export function scanVideoSources() {
  const candidates = new Map();
  const pageTitle = document.title || 'Video';

  function addSharedPost(rawUrl) {
    if (!rawUrl) return;
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !['redgifs.com', 'www.redgifs.com'].includes(url.hostname.toLowerCase())) return;
    const match = url.pathname.match(/^\/(?:watch|ifr)\/([A-Za-z0-9]+)\/?$/);
    if (!match) return;
    const id = match[1].toLowerCase();
    const canonicalUrl = `https://www.redgifs.com/watch/${id}`;
    candidates.set(canonicalUrl, {
      kind: 'shared-post',
      url: canonicalUrl,
      name: id,
      host: 'redgifs.com',
      width: 0,
      height: 0,
      duration: 0,
    });
  }

  function add(rawUrl, mimeType = '', video = null, title = '', isVideoSource = false) {
    if (!rawUrl) return;

    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return;
    }

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return;
    const mime = mimeType.split(';', 1)[0].trim().toLowerCase();
    const path = url.pathname.toLowerCase();
    if (/\.(m3u8|mpd|m4s|ts|webm|mov)$/.test(path)) return;
    if (!path.endsWith('.mp4') && mime !== 'video/mp4' && !(isVideoSource && !mime)) return;
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

  function scanRoot(root) {
    for (const video of root.querySelectorAll('video')) {
      const title = video.getAttribute('aria-label') || video.getAttribute('title') || pageTitle;
      const sources = Array.from(video.querySelectorAll('source'));
      for (const source of sources) {
        add(source.src || source.getAttribute('src'), source.type || source.getAttribute('type') || '', video, title, true);
      }
      add(video.currentSrc, video.getAttribute('type') || '', video, title, true);
      add(video.getAttribute('src') || video.src, video.getAttribute('type') || '', video, title, true);
    }

    for (const anchor of root.querySelectorAll('a[href]')) {
      addSharedPost(anchor.href);
      add(anchor.href, anchor.getAttribute('type') || '', null, anchor.getAttribute('title') || anchor.textContent || '');
    }
    for (const frame of root.querySelectorAll('iframe[src]')) {
      addSharedPost(frame.src || frame.getAttribute('src'));
    }
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) scanRoot(element.shadowRoot);
    }
  }

  addSharedPost(location.href);
  scanRoot(document);
  for (const entry of performance.getEntriesByType('resource')) {
    addSharedPost(entry.name);
    add(entry.name);
  }

  return Array.from(candidates.values()).sort((left, right) => (
    right.height - left.height || right.width - left.width || left.name.localeCompare(right.name)
  ));
}
