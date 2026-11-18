function resourceUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error('[HLS_URL] The playlist contains an invalid resource URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com' || url.port || url.username || url.password) {
    throw new Error('[HLS_URL] Playlist resources must be hosted on the permitted media host.');
  }
  url.hash = '';
  return url.href;
}

function attributes(line) {
  const result = {};
  const input = line.slice(line.indexOf(':') + 1);
  const pattern = /(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of input.matchAll(pattern)) result[match[1]] = match[2].replace(/^"|"$/g, '');
  return result;
}

async function fetchResource(url, signal) {
  let response;
  try {
    response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('[HLS_NETWORK] Could not fetch a stream resource. It may have expired or require access.');
  }
  if (response.status !== 200 || !response.body) {
    throw new Error(`[HLS_HTTP] Stream resource returned HTTP ${response.status} or no readable body.`);
  }
  return response;
}

async function playlist(url, signal) {
  const response = await fetchResource(url, signal);
  const text = await response.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('[HLS_FORMAT] The stream is not a valid HLS playlist.');
  if (lines.some((line) => /^#EXT-X-(?:SESSION-KEY|DEFINE|BYTERANGE|DISCONTINUITY(?:-SEQUENCE)?|GAP|SKIP|PART(?:-INF)?|PRELOAD-HINT|I-FRAMES-ONLY)(?::|$)/.test(line))) {
    throw new Error('[HLS_UNSUPPORTED] This stream uses an unsupported playlist feature.');
  }
  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:') && attributes(line).METHOD !== 'NONE') {
      throw new Error('[HLS_ENCRYPTED] Encrypted or protected streams cannot be imported.');
    }
  }
  return lines;
}

function mediaResources(lines, url) {
  if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('[HLS_LIVE] Live or incomplete streams cannot be imported.');
  const resources = [];
  let init = false;
  let awaitingSegment = false;
  let segments = 0;
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const map = attributes(line);
      if (init || segments || !map.URI || map.BYTERANGE) throw new Error('[HLS_UNSUPPORTED] This stream uses an unsupported initialization map.');
      init = true;
      resources.push(resourceUrl(map.URI, url));
    } else if (line.startsWith('#EXTINF:')) {
      if (awaitingSegment) throw new Error('[HLS_FORMAT] The playlist has a missing segment.');
      awaitingSegment = true;
    } else if (!line.startsWith('#')) {
      if (!awaitingSegment) throw new Error('[HLS_FORMAT] The playlist has an unexpected resource.');
      resources.push(resourceUrl(line, url));
      awaitingSegment = false;
      segments += 1;
    }
  }
  if (!segments || awaitingSegment) throw new Error('[HLS_FORMAT] The playlist has no complete segments.');
  return resources;
}

export async function resolveXPlaylist(value, signal) {
  const url = resourceUrl(value);
  const lines = await playlist(url, signal);
  const streams = [];
  const audio = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('#EXT-X-MEDIA:')) audio.push(attributes(line));
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = attributes(line);
      const next = lines[index + 1];
      if (!next || next.startsWith('#')) throw new Error('[HLS_FORMAT] The master playlist has a missing variant.');
      const bandwidth = Number(attrs.BANDWIDTH);
      if (!Number.isFinite(bandwidth) || bandwidth <= 0) throw new Error('[HLS_FORMAT] The stream variant has no valid bandwidth.');
      streams.push({ ...attrs, bandwidth, url: resourceUrl(next, url) });
      index += 1;
    }
  }
  if (!streams.length) return [{ name: 'video', resources: mediaResources(lines, url) }];
  streams.sort((a, b) => b.bandwidth - a.bandwidth);
  const selected = streams[0];
  const videoLines = await playlist(selected.url, signal);
  const tracks = [{ name: 'video', resources: mediaResources(videoLines, selected.url) }];
  if (selected.AUDIO) {
    const choices = audio.filter((item) => item.TYPE === 'AUDIO' && item['GROUP-ID'] === selected.AUDIO);
    if (!choices.length) throw new Error('[HLS_FORMAT] The selected stream is missing its audio group.');
    const chosen = choices.find((item) => item.DEFAULT === 'YES') || choices.find((item) => item.AUTOSELECT === 'YES') || choices[0];
    if (chosen.URI) {
      const audioUrl = resourceUrl(chosen.URI, url);
      tracks.push({ name: 'audio', resources: mediaResources(await playlist(audioUrl, signal), audioUrl) });
    }
  }
  return tracks;
}

export async function fetchHlsResource(url, signal) {
  const response = await fetchResource(resourceUrl(url), signal);
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type === 'text/html' || type === 'application/json') {
    throw new Error('[HLS_FORMAT] A stream segment did not contain media.');
  }
  return response;
}
