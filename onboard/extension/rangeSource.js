// This limits an individual request, not the size or duration of a source.
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

export async function fetchByteRange(url, start, end, validator, signal) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0
      || end < start || end - start >= MAX_RANGE_BYTES) {
    throw new Error('[RANGE_REQUEST] The requested byte range is invalid.');
  }
  const headers = { Range: `bytes=${start}-${end}` };
  if (validator) headers['If-Range'] = validator.value;

  let response;
  try {
    response = await fetch(url.href, { headers, signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('[RANGE_NETWORK] Could not reach the video source.');
  }
  if (response.status === 200) {
    await response.body?.cancel();
    if (validator) throw new Error('[RANGE_VERSION] The source changed or the host stopped honoring range requests.');
    throw new Error('[RANGE_UNSUPPORTED] The video host did not honor the range request.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`[RANGE_HTTP_${response.status}] The video host returned HTTP ${response.status}.`);
  }
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error(`[RANGE_RESPONSE] The video host returned unexpected HTTP ${response.status}.`);
  }

  const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  const actualStart = Number(match?.[1]);
  const actualEnd = Number(match?.[2]);
  const total = Number(match?.[3]);
  if (!match || ![actualStart, actualEnd, total].every(Number.isSafeInteger)
      || total <= 0 || actualStart !== start || actualStart >= total
      || actualEnd < actualStart || actualEnd !== Math.min(end, total - 1)) {
    await response.body?.cancel();
    throw new Error('[RANGE_RESPONSE] The video host returned an invalid Content-Range.');
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') {
    await response.body?.cancel();
    throw new Error('[RANGE_ENCODING] The video host returned encoded bytes that cannot be indexed safely.');
  }

  const etag = response.headers.get('etag');
  const modified = response.headers.get('last-modified');
  const currentValidator = etag && !etag.startsWith('W/')
    ? { type: 'etag', value: etag }
    : modified && Number.isFinite(Date.parse(modified)) ? { type: 'last-modified', value: modified } : null;
  if (!currentValidator || (validator && (validator.type !== currentValidator.type || validator.value !== currentValidator.value))) {
    await response.body?.cancel();
    throw new Error('[RANGE_VERSION] The source has no stable validator or changed while loading.');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('[RANGE_BODY] The range response did not contain readable bytes.');
  const expectedLength = actualEnd - actualStart + 1;
  const bytes = new Uint8Array(expectedLength);
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > expectedLength) {
        await reader.cancel();
        throw new Error('[RANGE_BODY] The video host returned more bytes than requested.');
      }
      bytes.set(value, loaded);
      loaded += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (loaded !== expectedLength) throw new Error('[RANGE_BODY] The video host returned an incomplete byte range.');
  return { bytes, start: actualStart, end: actualEnd, total, validator: currentValidator };
}
