import { fetchByteRange } from './rangeSource.js';

export function connectRangeSource(port, claimSelectedUrl, encodeBytes) {
  let url = null;
  let starting = false;
  let closed = false;
  let current = null;
  let validator = null;
  let total = null;

  function cancelCurrent() {
    current?.controller.abort();
    current?.acknowledge?.();
  }

  port.onDisconnect.addListener(() => {
    closed = true;
    url = null;
    cancelCurrent();
  });
  port.onMessage.addListener((message) => {
    if (message?.type === 'cancel') {
      closed = true;
      url = null;
      cancelCurrent();
    } else if (message?.type === 'range-start' && !starting && !url && typeof message.token === 'string') {
      starting = true;
      void start(message.token);
    } else if (message?.type === 'range-read' && Number.isSafeInteger(message.id)) {
      if (!url || current || closed) {
        if (!closed) port.postMessage({ type: 'range-error', id: message.id, message: '[RANGE_SESSION] The source is not ready for a range request.' });
      } else {
        void read(message);
      }
    } else if (message?.type === 'range-ack' && current?.id === message.id && current.acknowledge) {
      const acknowledge = current.acknowledge;
      current.acknowledge = null;
      acknowledge();
    } else if (message?.type === 'range-cancel' && current?.id === message.id) {
      cancelCurrent();
    }
  });

  async function start(token) {
    try {
      const selected = await claimSelectedUrl(token);
      if (closed) return;
      url = selected;
      port.postMessage({ type: 'range-ready' });
    } catch (error) {
      if (!closed) {
        const detail = error instanceof Error ? error.message : 'Could not open the selected source.';
        port.postMessage({ type: 'range-error', message: detail.startsWith('[') ? detail : `[RANGE_SESSION] ${detail}` });
      }
    }
  }

  async function read(message) {
    const request = { id: message.id, controller: new AbortController(), acknowledge: null };
    current = request;
    try {
      const result = await fetchByteRange(url, message.start, message.end, validator, request.controller.signal);
      if (total !== null && total !== result.total) throw new Error('[RANGE_VERSION] The source size changed while loading.');
      validator = result.validator;
      total = result.total;
      if (closed || request.controller.signal.aborted) return;
      port.postMessage({ type: 'range-response', id: request.id, start: result.start, end: result.end, total });
      for (let offset = 0; offset < result.bytes.length; offset += 65536) {
        if (closed || request.controller.signal.aborted) return;
        const bytes = result.bytes.subarray(offset, offset + 65536);
        await new Promise((resolve) => {
          request.acknowledge = resolve;
          port.postMessage({ type: 'range-chunk', id: request.id, data: encodeBytes(bytes) });
        });
      }
      if (!closed && !request.controller.signal.aborted) port.postMessage({ type: 'range-done', id: request.id });
    } catch (error) {
      if (!closed && !request.controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : 'Could not load the requested bytes.';
        port.postMessage({ type: 'range-error', id: request.id, message: detail.startsWith('[') ? detail : `[RANGE_READ] ${detail}` });
      }
    } finally {
      if (current === request) current = null;
      if (!closed && request.controller.signal.aborted) port.postMessage({ type: 'range-cancelled', id: request.id });
    }
  }
}
