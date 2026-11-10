export type RemoteSourceProgress = {
  loaded: number;
  total: number | null;
};

export function parseRemoteMp4Url(value: string | null): URL {
  if (!value) throw new Error('The extension handoff did not include a video URL.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The video source URL is invalid.');
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Only HTTP(S) video URLs without embedded credentials can be opened in Onboard.');
  }
  url.hash = '';
  return url;
}

export async function fetchRemoteMp4(
  url: URL,
  onProgress: (progress: RemoteSourceProgress) => void,
  signal: AbortSignal,
): Promise<File> {
  let response: Response;
  try {
    response = await fetch(url.href, {
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Onboard could not read this source. The site may block cross-origin access (CORS).');
  }

  if (!response.ok) throw new Error(`The video source returned HTTP ${response.status}.`);

  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  const hasMp4Path = url.pathname.toLowerCase().endsWith('.mp4');
  const acceptedType = contentType === 'video/mp4'
    || (hasMp4Path && (contentType === '' || contentType === 'application/octet-stream' || contentType === 'binary/octet-stream'));
  if (!acceptedType) throw new Error('The selected source did not return a directly readable MP4.');

  const reader = response.body?.getReader();
  if (!reader) throw new Error('The video response did not contain a readable file.');

  const contentLength = Number(response.headers.get('content-length'));
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;
  onProgress({ loaded, total });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = new ArrayBuffer(value.byteLength);
    new Uint8Array(chunk).set(value);
    chunks.push(chunk);
    loaded += value.byteLength;
    onProgress({ loaded, total });
  }

  const blob = new Blob(chunks, { type: 'video/mp4' });
  if (blob.size === 0) throw new Error('The video source returned an empty file.');

  const pathName = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  let decodedName = pathName;
  try {
    decodedName = decodeURIComponent(pathName);
  } catch {
    decodedName = pathName;
  }
  const safeName = decodedName
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^\.+$/, '')
    .trim();
  const fileName = safeName.toLowerCase().endsWith('.mp4') ? safeName : 'onboard-video.mp4';

  return new File([blob], fileName, { type: 'video/mp4' });
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1024 * 1024) return `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
