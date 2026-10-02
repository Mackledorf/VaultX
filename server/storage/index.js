import { createGoogleDriveStorageAdapter } from './google-drive.js';
import { createLocalStorageAdapter } from './local.js';

export function createStorageAdapter() {
  const provider = process.env.VAULT_STORAGE_PROVIDER || 'google-drive';

  if (provider === 'local') {
    return createLocalStorageAdapter();
  }

  return createGoogleDriveStorageAdapter();
}