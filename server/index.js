import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearSessionCookie, isPasswordHashConfigured, sessionCookieName, setSessionCookie, verifyPassword, verifySessionToken } from './auth.js';
import { createMedia, getMedia, normalizeTags, removeMedia, searchMedia, updateMediaTags } from './database.js';
import { detectMediaType } from './media-type.js';
import { createStorageAdapter } from './storage/index.js';
import { isLocalAuthDisabled } from './auth-mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_BYTES || 150 * 1024 * 1024);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const AUTH_DISABLED = isLocalAuthDisabled({
  enabled: process.env.VAULT_AUTH_DISABLED,
  nodeEnv: process.env.NODE_ENV,
  host: HOST,
});
const app = express();
const storage = createStorageAdapter();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, storage.stagingDir),
    filename: (_request, _file, callback) => callback(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
});
const uploadBatches = new Map();
const loginFailures = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
app.use('/api', (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', requireSameOrigin);

app.get('/api/config', (_request, response) => {
  response.json({
    configured: isConfigured(),
    authConfigured: isPasswordHashConfigured(),
    authDisabled: AUTH_DISABLED,
    storageConfigured: storage.configured,
    storageProvider: storage.provider,
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  });
});

app.get('/api/session', (request, response) => {
  response.json({ authenticated: isAuthenticated(request), configured: isConfigured(), authDisabled: AUTH_DISABLED });
});

app.post('/api/login', async (request, response) => {
  if (!isConfigured()) {
    response.status(503).json({ error: 'VaultX is not configured.' });
    return;
  }

  if (AUTH_DISABLED) {
    response.json({ authenticated: true, authDisabled: true });
    return;
  }

  const clientId = request.ip || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const failures = loginFailures.get(clientId);
  if (failures?.expiresAt > now && failures.count >= MAX_LOGIN_ATTEMPTS) {
    response.setHeader('Retry-After', String(Math.ceil((failures.expiresAt - now) / 1000)));
    response.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }
  if (failures?.expiresAt <= now) {
    loginFailures.delete(clientId);
  }

  const password = typeof request.body?.password === 'string' ? request.body.password : '';

  if (!(await verifyPassword(password))) {
    const current = loginFailures.get(clientId);
    loginFailures.set(clientId, {
      count: current?.expiresAt > now ? current.count + 1 : 1,
      expiresAt: current?.expiresAt > now ? current.expiresAt : now + LOGIN_WINDOW_MS,
    });
    response.status(401).json({ error: 'Access denied.' });
    return;
  }

  loginFailures.delete(clientId);
  setSessionCookie(response);
  response.json({ authenticated: true });
});

app.post('/api/logout', (_request, response) => {
  clearSessionCookie(response);
  response.json({ authenticated: AUTH_DISABLED });
});

app.use('/api', requireAuth);

app.get('/api/entries', (request, response) => {
  const result = searchMedia({
    query: request.query.q,
    type: request.query.type,
    limit: request.query.limit,
    offset: request.query.offset,
  });
  response.json({
    items: result.items.map(addMediaUrl),
    total: result.total,
    limit: Number(request.query.limit) || 60,
    offset: Number(request.query.offset) || 0,
  });
});

app.patch('/api/entries/:id/tags', (request, response) => {
  if (!Array.isArray(request.body?.tags)) {
    response.status(400).json({ error: 'Tags must be an array.' });
    return;
  }

  const entry = updateMediaTags(request.params.id, request.body.tags);
  if (!entry) {
    response.status(404).json({ error: 'Media not found.' });
    return;
  }
  response.json(addMediaUrl(entry));
});

app.delete('/api/entries/:id', async (request, response, next) => {
  try {
    const entry = getMedia(request.params.id);
    if (!entry) {
      response.status(404).json({ error: 'Media not found.' });
      return;
    }
    await storage.deleteFile(entry.fileId);
    removeMedia(entry.id);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload-batches', async (request, response, next) => {
  try {
    const files = Array.isArray(request.body?.files) ? request.body.files : [];
    if (!files.length || files.length > 100 || files.some((file) => !normalizeTags(file?.tags).length)) {
      response.status(400).json({ error: 'Add between 1 and 100 files and at least one tag per file.' });
      return;
    }

    const acceptedFiles = files.map((file, index) => {
      const size = Number.isFinite(Number(file?.size)) ? Math.max(0, Number(file.size)) : 0;
      return {
        index,
        size,
        tags: normalizeTags(file.tags).map((tag) => tag.display),
        status: size <= MAX_FILE_SIZE_BYTES ? 'pending' : 'skipped',
        error: size <= MAX_FILE_SIZE_BYTES ? '' : 'File exceeds the upload size limit.',
      };
    });
    const batch = summarizeBatch({
      id: crypto.randomUUID(),
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

  if (!file || !batchFile || batchFile.status !== 'pending') {
    if (file?.path) {
      await unlink(file.path).catch(() => undefined);
    }
    response.status(400).json({ error: 'File is required.' });
    return;
  }

  batchFile.status = 'uploading';
  batchFile.error = '';
  batch.updatedAt = new Date().toISOString();

  let uploadedFileId;
  try {
    const detectedType = await detectMediaType(file.path);
    if (!detectedType || file.size > MAX_FILE_SIZE_BYTES) {
      batchFile.status = 'skipped';
      batchFile.error = 'Unsupported media type or size.';
      batch.updatedAt = new Date().toISOString();
      await unlink(file.path).catch(() => undefined);
      response.status(400).json(summarizeBatch(batch));
      return;
    }

    const id = crypto.randomUUID();
    const uploaded = await storage.uploadFile({ id, file });
    uploadedFileId = uploaded.fileId;
    const hasPreview = detectedType.mediaType !== 'video' && await storage.createPreview(uploaded.fileId);
    const now = new Date().toISOString();
    const entry = {
      id,
      fileId: uploaded.fileId,
      contentType: detectedType.contentType,
      mediaType: detectedType.mediaType,
      sizeBytes: file.size,
      createdAt: now,
      hasPreview,
    };
    const savedEntry = createMedia(entry, batchFile.tags);

    batchFile.status = 'saved';
    batchFile.entryId = entry.id;
    batchFile.progress = 100;
    batch.updatedAt = now;
    response.status(201).json({ batch: summarizeBatch(batch), entry: addMediaUrl(savedEntry) });
  } catch (error) {
    if (uploadedFileId) {
      await storage.deleteFile(uploadedFileId);
    } else {
      await unlink(file.path).catch(() => undefined);
    }
    batchFile.status = 'failed';
    batchFile.error = 'Upload failed.';
    batch.updatedAt = new Date().toISOString();
    next(error);
  }
});

app.get('/api/media/:id', async (request, response, next) => {
  try {
    const entry = getMedia(request.params.id);

    if (!entry) {
      response.status(404).end();
      return;
    }

    const media = await storage.streamFile(entry.fileId, request.headers.range);
    response.setHeader('Content-Type', entry.contentType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Accept-Ranges', 'bytes');

    if (media.range === false) {
      response.setHeader('Content-Range', `bytes */${media.size}`);
      response.status(416).end();
      return;
    }

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

app.get('/api/media/:id/preview', async (request, response, next) => {
  try {
    const entry = getMedia(request.params.id);
    if (!entry?.hasPreview) {
      response.status(404).end();
      return;
    }
    const preview = await storage.streamPreview(entry.fileId);
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Length', String(preview.size));
    preview.stream.pipe(response);
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
  if (error instanceof multer.MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Upload rejected.' });
    return;
  }
  response.status(500).json({ error: 'Unexpected server error.' });
});

await storage.cleanupStaging();

app.listen(PORT, HOST, () => {
  console.log(`VaultX API listening on http://${HOST}:${PORT}`);
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
  return AUTH_DISABLED || verifySessionToken(request.cookies?.[sessionCookieName()]);
}

function isConfigured() {
  return Boolean(process.env.SESSION_SECRET?.length >= 32 && (AUTH_DISABLED || isPasswordHashConfigured()) && storage.configured);
}

function addMediaUrl(entry) {
  return {
    ...entry,
    mediaUrl: `/api/media/${entry.id}`,
    previewUrl: entry.hasPreview ? `/api/media/${entry.id}/preview` : null,
  };
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

function requireSameOrigin(request, response, next) {
  const origin = request.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== request.get('host')) {
        response.status(403).json({ error: 'Cross-origin requests are not allowed.' });
        return;
      }
    } catch {
      response.status(403).json({ error: 'Invalid request origin.' });
      return;
    }
  }
  next();
}