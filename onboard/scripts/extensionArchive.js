import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const extensionDirectory = fileURLToPath(new URL('../extension/', import.meta.url));

export function createExtensionArchive() {
  const files = {};
  function collect(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const archivePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) collect(path, `${archivePath}/`);
      else if (entry.isFile()) files[archivePath] = readFileSync(path);
      else throw new Error(`Unsupported extension archive entry: ${archivePath}`);
    }
  }
  collect(extensionDirectory);
  return zipSync(files, { mtime: new Date('2020-01-01T00:00:00Z') });
}
