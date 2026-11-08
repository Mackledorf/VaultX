import { createLocalStorageAdapter } from './local.js';

export function createStorageAdapter() {
  const provider = process.env.VAULT_STORAGE_PROVIDER || 'local';

  if (provider !== 'local') {
    throw new Error('VaultX supports private local storage only. Set VAULT_STORAGE_PROVIDER=local.');
  }

  return createLocalStorageAdapter();
}