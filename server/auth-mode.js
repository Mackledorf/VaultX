const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLocalAuthDisabled({ enabled, nodeEnv, host }) {
  return enabled === 'true' && nodeEnv !== 'production' && LOOPBACK_HOSTS.has(host);
}
