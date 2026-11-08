import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dataDirectory = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(homedir(), '.vaultx-data'));
const staticDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (dataDirectory === staticDirectory || dataDirectory.startsWith(`${staticDirectory}${path.sep}`)) {
  throw new Error('LOCAL_STORAGE_DIR must not be inside the static build directory.');
}
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
chmodSync(dataDirectory, 0o700);
process.umask(0o077);

const databasePath = path.join(dataDirectory, 'vaultx.sqlite');
const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
chmodSync(databasePath, 0o600);
database.exec(`
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'gif', 'video')),
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    has_preview INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tags (
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    normalized_tag TEXT NOT NULL,
    display_tag TEXT NOT NULL,
    PRIMARY KEY (media_id, normalized_tag)
  );
  CREATE INDEX IF NOT EXISTS tags_search_idx ON tags(normalized_tag, media_id);
  CREATE INDEX IF NOT EXISTS media_type_created_idx ON media(media_type, created_at DESC);
`);

const insertMedia = database.prepare(`
  INSERT INTO media (id, file_id, content_type, media_type, size_bytes, created_at, has_preview)
  VALUES (@id, @fileId, @contentType, @mediaType, @sizeBytes, @createdAt, @hasPreview)
`);
const insertTag = database.prepare(`
  INSERT OR IGNORE INTO tags (media_id, normalized_tag, display_tag)
  VALUES (?, ?, ?)
`);
const insertMediaWithTags = database.transaction((entry, tags) => {
  insertMedia.run(entry);
  for (const tag of tags) {
    insertTag.run(entry.id, tag.normalized, tag.display);
  }
});

export function normalizeTags(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const tags = new Map();
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const display = value.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 64);
    const normalized = display.toLocaleLowerCase('en-US');
    if (normalized && !tags.has(normalized)) {
      tags.set(normalized, { normalized, display });
    }
    if (tags.size >= 30) {
      break;
    }
  }
  return [...tags.values()];
}

export function createMedia(entry, tagValues) {
  insertMediaWithTags({ ...entry, hasPreview: Number(entry.hasPreview) }, normalizeTags(tagValues));
  return getMedia(entry.id);
}

export function getMedia(id) {
  const entry = database.prepare(`
    SELECT id, file_id AS fileId, content_type AS contentType,
      media_type AS mediaType, size_bytes AS sizeBytes, created_at AS createdAt, has_preview AS hasPreview
    FROM media WHERE id = ?
  `).get(id);

  return entry ? { ...entry, hasPreview: Boolean(entry.hasPreview), tags: getTags([id]).get(id) || [] } : null;
}

export function searchMedia({ query = '', type = 'all', limit = 60, offset = 0 } = {}) {
  const clauses = [];
  const parameters = [];
  if (['image', 'gif', 'video'].includes(type)) {
    clauses.push('media_type = ?');
    parameters.push(type);
  }

  const terms = String(query).normalize('NFKC').trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean).slice(0, 12);
  for (const term of terms) {
    clauses.push(`EXISTS (
      SELECT 1 FROM tags WHERE tags.media_id = media.id
      AND tags.normalized_tag LIKE ? ESCAPE '\\'
    )`);
    parameters.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = database.prepare(`SELECT COUNT(*) AS total FROM media ${where}`).get(...parameters).total;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 60));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const items = database.prepare(`
    SELECT id, file_id AS fileId, content_type AS contentType,
      media_type AS mediaType, size_bytes AS sizeBytes, created_at AS createdAt, has_preview AS hasPreview
    FROM media ${where}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(...parameters, safeLimit, safeOffset);

  const tagsByMedia = getTags(items.map((item) => item.id));
  return { items: items.map((item) => ({ ...item, hasPreview: Boolean(item.hasPreview), tags: tagsByMedia.get(item.id) || [] })), total };
}

export function updateMediaTags(id, tagValues) {
  const entry = database.prepare('SELECT id FROM media WHERE id = ?').get(id);
  if (!entry) {
    return null;
  }

  const tags = normalizeTags(tagValues);
  database.transaction(() => {
    database.prepare('DELETE FROM tags WHERE media_id = ?').run(id);
    for (const tag of tags) {
      insertTag.run(id, tag.normalized, tag.display);
    }
  })();
  return getMedia(id);
}

export function removeMedia(id) {
  const entry = database.prepare('SELECT file_id AS fileId FROM media WHERE id = ?').get(id);
  if (!entry) {
    return null;
  }
  database.prepare('DELETE FROM media WHERE id = ?').run(id);
  return entry;
}

function getTags(mediaIds) {
  const tagsByMedia = new Map();
  if (!mediaIds.length) {
    return tagsByMedia;
  }
  const placeholders = mediaIds.map(() => '?').join(',');
  const rows = database.prepare(`
    SELECT media_id AS mediaId, display_tag AS displayTag
    FROM tags WHERE media_id IN (${placeholders}) ORDER BY normalized_tag
  `).all(...mediaIds);
  for (const row of rows) {
    const tags = tagsByMedia.get(row.mediaId) || [];
    tags.push(row.displayTag);
    tagsByMedia.set(row.mediaId, tags);
  }
  return tagsByMedia;
}
