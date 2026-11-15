export const SITE_PERMISSIONS = {
  x: ['https://cdn.syndication.twimg.com/*', 'https://video.twimg.com/*'],
  redgifs: ['https://api.redgifs.com/*', 'https://media.redgifs.com/*'],
};

export function parseSharedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The shared post URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Shared post URLs must use HTTPS without embedded credentials.');
  }
  const host = url.hostname.toLowerCase();
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(host)) {
    const match = url.pathname.match(/^\/(?:i\/web|[A-Za-z0-9_]+)\/status\/(\d+)(?:\/(?:video|photo)\/\d+)?\/?$/);
    if (match) return { site: 'x', id: match[1] };
  }
  if (['redgifs.com', 'www.redgifs.com'].includes(host)) {
    const match = url.pathname.match(/^\/(?:watch|ifr)\/([A-Za-z0-9]+)\/?$/);
    if (match) return { site: 'redgifs', id: match[1].toLowerCase() };
  }
  throw new Error('This shared URL is not a supported X or Redgifs post.');
}

function mediaUrl(value, host) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function jsonResponse(url, signal, headers) {
  let response;
  try {
    response = await fetch(url, { signal, headers, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not reach the source site. It may be unavailable or block this request.');
  }
  if (!response.ok) throw new Error(`The source site returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error('The source site returned unreadable metadata.');
  }
}

export async function resolveSharedVideo(post, signal) {
  if (post.site === 'x') {
    const endpoint = new URL('https://cdn.syndication.twimg.com/tweet-result');
    endpoint.searchParams.set('id', post.id);
    endpoint.searchParams.set('token', '0');
    const data = await jsonResponse(endpoint.href, signal);
    for (const media of Array.isArray(data?.mediaDetails) ? data.mediaDetails : []) {
      if (media?.type !== 'video' && media?.type !== 'animated_gif') continue;
      const variants = Array.isArray(media.video_info?.variants) ? media.video_info.variants : [];
      const supported = variants
        .filter((variant) => variant?.content_type === 'video/mp4' && mediaUrl(variant.url, 'video.twimg.com'))
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
      if (supported.length) return mediaUrl(supported[0].url, 'video.twimg.com');
    }
  } else if (post.site === 'redgifs') {
    const auth = await jsonResponse('https://api.redgifs.com/v2/auth/temporary', signal);
    if (typeof auth?.token !== 'string' || !auth.token) throw new Error('The source site did not provide a temporary access token.');
    const data = await jsonResponse(
      `https://api.redgifs.com/v2/gifs/${post.id}`,
      signal,
      { authorization: `Bearer ${auth.token}` },
    );
    for (const value of [data?.gif?.urls?.hd, data?.gif?.urls?.sd]) {
      const url = mediaUrl(value, 'media.redgifs.com');
      if (url) return url;
    }
  } else {
    throw new Error('This shared URL is not supported.');
  }
  throw new Error('No supported MP4 was found in this public post.');
}

export async function fetchSharedVideo(url, signal) {
  let response;
  try {
    response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not download the video. The source may have expired or blocked the request.');
  }
  if (!response.ok) throw new Error(`The video source returned HTTP ${response.status}.`);
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'video/mp4') throw new Error('The selected source did not return a directly readable MP4.');
  if (!response.body) throw new Error('The video response did not contain a readable file.');
  return response;
}
