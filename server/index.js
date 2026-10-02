import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearSessionCookie, isPasswordHashConfigured, sessionCookieName, setSessionCookie, verifyPassword, verifySessionToken } from './auth.js';
import { createSlug, readManifest, updateManifest } from './manifest.js';
import { createStorageAdapter } from './storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const PORT = Number(process.env.PORT || 8787);
const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_BYTES || 150 * 1024 * 1024);
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
});
const storage = createStorageAdapter();
const uploadBatches = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/config', (_request, response) => {
  response.json({
    configured: isConfigured(),
    authConfigured: isPasswordHashConfigured(),
    storageConfigured: storage.configured,
    storageProvider: storage.provider,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  });
});

app.get('/api/session', (request, response) => {
  response.json({ authenticated: isAuthenticated(request), configured: isConfigured() });
});

app.post('/api/login', async (request, response) => {
  if (!isConfigured()) {
    response.status(503).json({ error: 'VaultX is not configured.' });
    return;
  }

  const password = typeof request.body?.password === 'string' ? request.body.password : '';

  if (!(await verifyPassword(password))) {
    response.status(401).json({ error: 'Access denied.' });
    return;
  }

  setSessionCookie(response);
  response.json({ authenticated: true });
});

app.post('/api/logout', (_request, response) => {
  clearSessionCookie(response);
  response.json({ authenticated: false });
});

app.use('/api', requireAuth);

app.get('/api/collections', async (_request, response, next) => {
  try {
    const manifest = await readManifest(storage);
    response.json(manifest.collections.sort(sortNewest));
  } catch (error) {
    next(error);
  }
});

app.post('/api/collections', async (request, response, next) => {
  try {
    const name = String(request.body?.name || '').trim();

    if (!name) {
      response.status(400).json({ error: 'Collection name is required.' });
      return;
    }

    let createdCollection;
    await updateManifest(storage, (manifest) => {
      const now = new Date().toISOString();
      createdCollection = {
        id: crypto.randomUUID(),
        name,
        slug: createUniqueSlug(manifest.collections, name),
        createdAt: now,
        updatedAt: now,
        coverEntryId: null,
      };

      return {
        ...manifest,
        collections: [createdCollection, ...manifest.collections],
      };
    });

    response.status(201).json(createdCollection);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/collections/:id', async (request, response, next) => {
  try {
    const name = String(request.body?.name || '').trim();

    if (!name) {
      response.status(400).json({ error: 'Collection name is required.' });
      return;
    }

    let updatedCollection;
    await updateManifest(storage, (manifest) => {
      const collections = manifest.collections.map((collection) => {
        if (collection.id !== request.params.id) {
          return collection;
        }

        updatedCollection = {
          ...collection,
          name,
          slug: createUniqueSlug(manifest.collections.filter((item) => item.id !== collection.id), name),
          updatedAt: new Date().toISOString(),
        };

        return updatedCollection;
      });

      return { ...manifest, collections };
    });

    if (!updatedCollection) {
      response.status(404).json({ error: 'Collection not found.' });
      return;
    }

    response.json(updatedCollection);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/collections/:id', async (request, response, next) => {
  try {
    let removed = false;
    let hasEntries = false;

    await updateManifest(storage, (manifest) => {
      hasEntries = manifest.entries.some((entry) => entry.collectionId === request.params.id);

      if (hasEntries) {
        return manifest;
      }

      const collections = manifest.collections.filter((collection) => collection.id !== request.params.id);
      removed = collections.length !== manifest.collections.length;
      return { ...manifest, collections };
    });

    if (hasEntries) {
      response.status(409).json({ error: 'Collection is not empty.' });
      return;
    }

    if (!removed) {
      response.status(404).json({ error: 'Collection not found.' });
      return;
    }

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/entries', async (_request, response, next) => {
  try {
    const manifest = await readManifest(storage);
    response.json(manifest.entries.sort(sortNewest).map(addMediaUrl));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/entries/:id', async (request, response, next) => {
  try {
    let entryToDelete;

    await updateManifest(storage, (manifest) => {
      entryToDelete = manifest.entries.find((entry) => entry.id === request.params.id);

      return {
        ...manifest,
        entries: manifest.entries.filter((entry) => entry.id !== request.params.id),
        collections: manifest.collections.map((collection) => (
          collection.coverEntryId === request.params.id ? { ...collection, coverEntryId: null } : collection
        )),
      };
    });

    if (!entryToDelete) {
      response.status(404).json({ error: 'Entry not found.' });
      return;
    }

    await storage.deleteFile(entryToDelete.fileId);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload-batches', async (request, response, next) => {
  try {
    const collectionId = String(request.body?.collectionId || '');
    const files = Array.isArray(request.body?.files) ? request.body.files : [];
    const manifest = await readManifest(storage);

    if (!manifest.collections.some((collection) => collection.id === collectionId)) {
      response.status(400).json({ error: 'Collection is required.' });
      return;
    }

    const acceptedFiles = files.map((file, index) => ({
      index,
      name: String(file.name || ''),
      size: Number(file.size || 0),
      type: String(file.type || ''),
      status: isSupportedFile(file) ? 'pending' : 'skipped',
      error: isSupportedFile(file) ? '' : 'Unsupported file type or size.',
    }));
    const batch = summarizeBatch({
      id: crypto.randomUUID(),
      collectionId,
      expectedCount: acceptedFiles.filter((file) => file.status !== 'skipped').length,
      totalBytes: acceptedFiles.reduce((total, file) => total + file.size, 0),
      files: acceptedFiles,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    uploadBatches.set(batch.id, batch);
    response.status(201).json(batch);
  } catch (error) {
    next(error);
  }
});

app.get('/api/upload-batches/:id', (request, response) => {
  const batch = uploadBatches.get(request.params.id);

  if (!batch) {
    response.status(404).json({ error: 'Batch not found.' });
    return;
  }

  response.json(summarizeBatch(batch));
});

app.post('/api/upload-batches/:id/files', upload.single('file'), async (request, response, next) => {
  const batch = uploadBatches.get(request.params.id);

  if (!batch) {
    response.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const file = request.file;
  const fileIndex = Number(request.body?.index);
  const batchFile = batch.files.find((item) => item.index === fileIndex);

  if (!file || !batchFile) {
    response.status(400).json({ error: 'File is required.' });
    return;
  }

  if (!SUPPORTED_MIME_TYPES.has(file.mimetype) || file.size > MAX_FILE_SIZE_BYTES) {
    batchFile.status = 'skipped';
    batchFile.error = 'Unsupported file type or size.';
    batch.updatedAt = new Date().toISOString();
    response.status(400).json(summarizeBatch(batch));
    return;
  }

  batchFile.status = 'uploading';
  batchFile.error = '';
  batch.updatedAt = new Date().toISOString();

  try {
    const id = crypto.randomUUID();
    const objectKind = file.mimetype.startsWith('video/') ? 'video' : 'image';
    const uploaded = await storage.uploadFile({ id, file, collectionId: batch.collectionId });
    const now = new Date().toISOString();
    const entry = {
      id,
      collectionId: batch.collectionId,
      fileId: uploaded.fileId,
      displayName: file.originalname,
      contentType: file.mimetype,
      objectKind,
      sizeBytes: file.size,
      createdAt: now,
      updatedAt: now,
    };

    await updateManifest(storage, (manifest) => {
      const collections = manifest.collections.map((collection) => (
        collection.id === batch.collectionId && !collection.coverEntryId
          ? { ...collection, coverEntryId: entry.id, updatedAt: now }
          : collection
      ));

      return {
        ...manifest,
        entries: [entry, ...manifest.entries],
        collections,
      };
    });

    batchFile.status = 'saved';
    batchFile.entryId = entry.id;
    batchFile.progress = 100;
    batch.updatedAt = now;
    response.status(201).json({ batch: summarizeBatch(batch), entry: addMediaUrl(entry) });
  } catch (error) {
    batchFile.status = 'failed';
    batchFile.error = 'Upload failed.';
    batch.updatedAt = new Date().toISOString();
    next(error);
  }
});

app.get('/api/media/:id', async (request, response, next) => {
  try {
    const manifest = await readManifest(storage);
    const entry = manifest.entries.find((item) => item.id === request.params.id);

    if (!entry) {
      response.status(404).end();
      return;
    }

    const media = await storage.streamFile(entry.fileId, request.headers.range);
    response.setHeader('Content-Type', entry.contentType);
    response.setHeader('Accept-Ranges', 'bytes');

    if (media.range) {
      const chunkLength = media.range.end - media.range.start + 1;
      response.status(206);
      response.setHeader('Content-Range', `bytes ${media.range.start}-${media.range.end}/${media.size}`);
      response.setHeader('Content-Length', String(chunkLength));
    } else if (media.size) {
      response.setHeader('Content-Length', String(media.size));
    }

    media.stream.pipe(response);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(distDir));
app.get('*', (_request, response) => {
  response.sendFile(path.join(distDir, 'index.html'));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`VaultX API listening on http://localhost:${PORT}`);
});

function requireAuth(request, response, next) {
  if (!isConfigured()) {
    response.status(503).json({ error: 'VaultX is not configured.' });
    return;
  }

  if (!isAuthenticated(request)) {
    response.status(401).json({ error: 'Access denied.' });
    return;
  }

  next();
}

function isAuthenticated(request) {
  return verifySessionToken(request.cookies?.[sessionCookieName()]);
}

function isConfigured() {
  return Boolean(process.env.SESSION_SECRET && isPasswordHashConfigured() && storage.configured);
}

function isSupportedFile(file) {
  return SUPPORTED_MIME_TYPES.has(String(file.type || '')) && Number(file.size || 0) <= MAX_FILE_SIZE_BYTES;
}

function addMediaUrl(entry) {
  return {
    ...entry,
    mediaUrl: `/api/media/${entry.id}`,
  };
}

function sortNewest(left, right) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function createUniqueSlug(collections, name) {
  const baseSlug = createSlug(name);
  let slug = baseSlug;
  let index = 2;

  while (collections.some((collection) => collection.slug === slug)) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }

  return slug;
}

function summarizeBatch(batch) {
  const completedCount = batch.files.filter((file) => file.status === 'saved').length;
  const failedCount = batch.files.filter((file) => file.status === 'failed').length;
  const skippedCount = batch.files.filter((file) => file.status === 'skipped').length;

  return {
    ...batch,
    completedCount,
    failedCount,
    skippedCount,
  };
}