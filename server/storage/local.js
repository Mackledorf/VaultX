import { chmodSync, createReadStream, mkdirSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { dataDirectory } from '../database.js';

export function createLocalStorageAdapter() {
  const mediaDir = path.join(dataDirectory, 'media');
  const previewDir = path.join(dataDirectory, 'previews');
  const stagingDir = path.join(dataDirectory, '.staging');
  for (const directory of [mediaDir, previewDir, stagingDir]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }

  async function ensureReady() {
    await Promise.all([mediaDir, previewDir, stagingDir].map(async (directory) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }));
  }

  return {
    provider: 'local',
    configured: true,
    stagingDir,
    async uploadFile({ id, file }) {
      await ensureReady();
      const fileId = id;
      const targetPath = path.join(mediaDir, fileId);
      await rename(file.path, targetPath);
      await chmod(targetPath, 0o600);
      return { fileId };
    },
    async cleanupStaging() {
      await ensureReady();
      const entries = await readdir(stagingDir);
      await Promise.all(entries.map((entry) => rm(path.join(stagingDir, entry), { recursive: true, force: true })));
    },
    async deleteFile(fileId) {
      await Promise.all([
        unlinkIfPresent(path.join(mediaDir, fileId)),
        unlinkIfPresent(path.join(previewDir, `${fileId}.webp`)),
      ]);
    },
    async createPreview(fileId) {
      const sourcePath = path.join(mediaDir, fileId);
      const previewPath = path.join(previewDir, `${fileId}.webp`);
      try {
        await sharp(sourcePath, { animated: false })
          .rotate()
          .resize({ width: 640, height: 480, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 76, effort: 4 })
          .toFile(previewPath);
        await chmod(previewPath, 0o600);
        return true;
      } catch {
        await unlink(previewPath).catch(() => undefined);
        return false;
      }
    },
    async streamPreview(fileId) {
      const previewPath = path.join(previewDir, `${fileId}.webp`);
      const fileStat = await stat(previewPath);
      return { stream: createReadStream(previewPath), size: fileStat.size };
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

function parseRange(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

  if (!match) {
    return false;
  }

  const isSuffixRange = !match[1];
  const start = isSuffixRange ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = isSuffixRange || !match[2] ? size - 1 : Number(match[2]);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size || end < 0 || (!match[1] && Number(match[2]) <= 0)) {
    return false;
  }

  return { start, end: Math.min(end, size - 1) };
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}