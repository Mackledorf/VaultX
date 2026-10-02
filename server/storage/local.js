import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const MANIFEST_FILE = 'vaultx-manifest.json';

export function createLocalStorageAdapter() {
  const root = process.env.LOCAL_STORAGE_DIR || path.resolve(process.cwd(), '.vaultx-data');
  const mediaDir = path.join(root, 'media');
  const manifestPath = path.join(root, MANIFEST_FILE);

  async function ensureReady() {
    await mkdir(mediaDir, { recursive: true });
  }

  return {
    provider: 'local',
    configured: true,
    async readManifest() {
      await ensureReady();

      if (!existsSync(manifestPath)) {
        return null;
      }

      return JSON.parse(await readFile(manifestPath, 'utf8'));
    },
    async writeManifest(manifest) {
      await ensureReady();
      const tempPath = `${manifestPath}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await rename(tempPath, manifestPath);
    },
    async uploadFile({ id, file }) {
      await ensureReady();
      const extension = file.originalname.split('.').pop()?.toLowerCase() || 'bin';
      const fileId = `${id}.${extension}`;
      const targetPath = path.join(mediaDir, fileId);
      await writeFile(targetPath, file.buffer);
      return { fileId };
    },
    async deleteFile(fileId) {
      await unlink(path.join(mediaDir, fileId)).catch(() => undefined);
    },
    async streamFile(fileId, range) {
      const targetPath = path.join(mediaDir, fileId);
      const fileStat = await stat(targetPath);
      const parsedRange = parseRange(range, fileStat.size);
      const stream = createReadStream(targetPath, parsedRange ? { start: parsedRange.start, end: parsedRange.end } : undefined);

      return {
        stream,
        size: fileStat.size,
        range: parsedRange,
      };
    },
  };
}

export function bufferToStream(buffer) {
  return Readable.from(buffer);
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

  if (!match) {
    return null;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}