const EMPTY_MANIFEST = {
  version: 1,
  collections: [],
  entries: [],
};

let writeQueue = Promise.resolve();

export async function readManifest(storage) {
  const manifest = await storage.readManifest();
  return normalizeManifest(manifest);
}

export async function updateManifest(storage, updater) {
  const nextWrite = writeQueue.then(async () => {
    const current = await readManifest(storage);
    const next = normalizeManifest(await updater(current));
    await storage.writeManifest(next);
    return next;
  });

  writeQueue = nextWrite.catch(() => undefined);
  return nextWrite;
}

export function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { ...EMPTY_MANIFEST };
  }

  return {
    version: 1,
    collections: Array.isArray(manifest.collections) ? manifest.collections : [],
    entries: Array.isArray(manifest.entries) ? manifest.entries : [],
  };
}

export function createSlug(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || `collection-${Date.now()}`;
}