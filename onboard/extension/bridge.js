(() => {
  const isProduction = location.origin === 'https://mackledorf.github.io' && location.pathname.startsWith('/VaultX/Onboard/');
  const isLocal = location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname)
    && ['4178', '5173'].includes(location.port) && location.pathname === '/';
  if (window !== window.top || (!isProduction && !isLocal)) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'onboard-share-import' || event.ports.length !== 1) return;
    const channel = event.ports[0];
    let port;
    try {
      port = chrome.runtime.connect({ name: 'onboard-share-import' });
    } catch {
      channel.postMessage({ type: 'error', message: 'The Onboard extension is unavailable. Reload the page and try again.' });
      channel.close();
      return;
    }
    port.onMessage.addListener((message) => channel.postMessage(message));
    port.onDisconnect.addListener(() => {
      channel.postMessage({ type: 'error', message: 'The Onboard extension disconnected during import.' });
      channel.close();
    });
    channel.onmessage = (message) => {
      if (message.data?.type === 'close') {
        port.disconnect();
        channel.close();
      } else {
        port.postMessage(message.data);
      }
    };
    channel.postMessage({ type: 'ready' });
  });
})();
