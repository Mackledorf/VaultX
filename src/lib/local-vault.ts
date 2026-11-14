import type { MediaType } from '../types';

export type LocalDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

type VaultItem = { parent: string; file: string; keywords: string[] };
type VaultMetadata = { format: 'vaultx'; version: 1; vaultId: string; keywords: string[]; items: VaultItem[] };
export type LocalMedia = { parent: string; name: string; type: MediaType; handle: FileSystemFileHandle; keywords: string[] };
export type VaultContents = {
  parents: string[];
  media: LocalMedia[];
  missing: VaultItem[];
  unindexed: number;
  rootMedia: number;
  nestedFolders: number;
  recoveryBackups: string[];
  pendingOperations: string[];
};

const MARKER = 'vaultx.json';
const mediaExtensions: Record<string, MediaType> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image',
  gif: 'gif', mp4: 'video', webm: 'video', mov: 'video',
};

export function mediaType(name: string): MediaType | undefined {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension && name.includes('.') && Object.prototype.hasOwnProperty.call(mediaExtensions, extension) ? mediaExtensions[extension] : undefined;
}

export function validateFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed !== name || trimmed.length > 200 || /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) ||
      trimmed.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(trimmed)) {
    throw new Error('Choose a valid folder name without reserved characters, trailing spaces or dots, or Windows reserved names.');
  }
  return trimmed;
}

async function createFolder(parent: LocalDirectoryHandle, name: string): Promise<LocalDirectoryHandle> {
  validateFolderName(name);
  for await (const entry of parent.values()) {
    if (entry.name.normalize('NFKC').toLocaleLowerCase('en-US') === name.normalize('NFKC').toLocaleLowerCase('en-US')) {
      throw new Error(`An item named "${entry.name}" already exists. Choose another name.`);
    }
  }
  const folder = await parent.getDirectoryHandle(name, { create: true }) as LocalDirectoryHandle;
  for await (const _entry of folder.values()) {
    throw new Error(`The folder "${name}" is not empty. It was not changed.`);
  }
  return folder;
}

export async function createVault(parent: LocalDirectoryHandle, name: string): Promise<LocalDirectoryHandle> {
  const folder = await createFolder(parent, name);
  try {
    await initializeVault(folder);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error.';
    throw new Error(`Could not finish creating "${name}". Inspect that folder before retrying. ${detail}`);
  }
  return folder;
}

export async function createParent(directory: LocalDirectoryHandle, name: string): Promise<void> {
  await createFolder(directory, name);
}

export function cleanKeywords(values: string[], maxItems?: number): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const keyword = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!keyword) continue;
    if (keyword.length > 64) throw new Error('Keywords must be 64 characters or fewer.');
    const key = keyword.toLocaleLowerCase('en-US');
    if (!unique.has(key)) unique.set(key, keyword);
  }
  if (maxItems !== undefined && unique.size > maxItems) throw new Error(`Use at most ${maxItems} keywords per item.`);
  return [...unique.values()];
}

async function writeNewFile(directory: LocalDirectoryHandle, name: string, contents: Blob | string): Promise<void> {
  try {
    await directory.getFileHandle(name);
    throw new Error(`The file "${name}" already exists; it was not overwritten.`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const handle = await directory.getFileHandle(name, { create: true });
  if ((await handle.getFile()).size !== 0) throw new Error(`The file "${name}" appeared while saving; it was not overwritten.`);
  const writer = await handle.createWritable();
  await writer.write(contents);
  await writer.close();
}

async function updateMetadata(directory: LocalDirectoryHandle, update: (metadata: VaultMetadata) => void): Promise<void> {
  const marker = await directory.getFileHandle(MARKER);
  const previous = await (await marker.getFile()).text();
  const metadata = parseVaultMetadata(previous);
  update(metadata);
  const backupName = `.vaultx-backup-${crypto.randomUUID()}.json`;
  await writeNewFile(directory, backupName, previous);
  try {
    if (await (await marker.getFile()).text() !== previous) {
      throw new Error('The vault metadata changed elsewhere. Refresh and try again.');
    }
    const writer = await marker.createWritable();
    await writer.write(`${JSON.stringify(metadata, null, 2)}\n`);
    await writer.close();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error.';
    throw new Error(`${detail} The previous metadata was saved as ${backupName}.`);
  }
  try {
    await directory.removeEntry(backupName);
  } catch {
    throw new Error(`Metadata was saved, but the backup ${backupName} could not be removed.`);
  }
}

async function addItemMetadata(directory: LocalDirectoryHandle, item: VaultItem): Promise<void> {
  await updateMetadata(directory, (metadata) => {
    if (metadata.items.some((existing) => existing.parent === item.parent && existing.file === item.file)) {
      throw new Error('The destination already has metadata. No metadata was changed.');
    }
    metadata.items.push(item);
    metadata.keywords = cleanKeywords([...metadata.keywords, ...item.keywords]);
  });
}

export async function createKeyword(directory: LocalDirectoryHandle, value: string): Promise<string> {
  const [keyword] = cleanKeywords([value]);
  if (!keyword) throw new Error('Enter a keyword.');
  await updateMetadata(directory, (metadata) => {
    metadata.keywords = cleanKeywords([...metadata.keywords, keyword]);
  });
  return keyword;
}

export async function checkRecoveryState(directory: LocalDirectoryHandle): Promise<void> {
  const metadata = await readVaultMetadata(directory);
  if (!metadata) throw new Error('The vault marker is missing. No files were changed.');
  for await (const entry of directory.values()) {
    if (entry.kind === 'file' && (entry.name.startsWith('.vaultx-backup-') || entry.name.startsWith('.vaultx-operation-')) && entry.name.endsWith('.json')) {
      throw new Error('Resolve the incomplete operation or metadata backup in the vault folder before making changes. See LOCAL-VAULT.md.');
    }
  }
}

export class ImportError extends Error {
  readonly phase: 'copy' | 'metadata';
  readonly destination: string;
  readonly permissionDenied: boolean;

  constructor(message: string, phase: 'copy' | 'metadata', destination: string, permissionDenied = false) {
    super(message);
    this.name = 'ImportError';
    this.phase = phase;
    this.destination = destination;
    this.permissionDenied = permissionDenied;
  }
}

async function currentMediaHandle(directory: LocalDirectoryHandle, item: LocalMedia): Promise<FileSystemFileHandle> {
  if (!isComponent(item.parent) || !isComponent(item.name)) throw new Error('The media path is invalid.');
  const folder = await directory.getDirectoryHandle(item.parent);
  const handle = await folder.getFileHandle(item.name);
  if (!await handle.isSameEntry(item.handle)) throw new Error('The source file changed. Refresh the vault and try again.');
  return handle;
}

export async function updateMediaKeywords(directory: LocalDirectoryHandle, item: LocalMedia, values: string[]): Promise<void> {
  const keywords = cleanKeywords(values, 30);
  await currentMediaHandle(directory, item);
  await updateMetadata(directory, (metadata) => {
    const existing = metadata.items.find((entry) => entry.parent === item.parent && entry.file === item.name);
    if (JSON.stringify(existing?.keywords ?? []) !== JSON.stringify(item.keywords)) {
      throw new Error('The keywords changed elsewhere. Refresh the vault and try again.');
    }
    if (existing) existing.keywords = keywords;
    else metadata.items.push({ parent: item.parent, file: item.name, keywords });
    metadata.keywords = cleanKeywords([...metadata.keywords, ...keywords]);
  });
}

async function filesMatch(first: File, second: File): Promise<boolean> {
  if (first.size !== second.size) return false;
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < first.size; offset += chunkSize) {
    const [left, right] = await Promise.all([
      first.slice(offset, offset + chunkSize).arrayBuffer(),
      second.slice(offset, offset + chunkSize).arrayBuffer(),
    ]);
    const a = new Uint8Array(left);
    const b = new Uint8Array(right);
    if (a.length !== b.length || a.some((value, index) => value !== b[index])) return false;
  }
  return true;
}

export async function moveMedia(directory: LocalDirectoryHandle, item: LocalMedia, destination: string): Promise<void> {
  if (!isComponent(destination) || destination === item.parent) throw new Error('Choose a different parent.');
  if (!mediaType(item.name)) throw new Error('This media type cannot be moved.');
  const source = await currentMediaHandle(directory, item);
  const sourceFile = await source.getFile();
  const sourceFolder = await directory.getDirectoryHandle(item.parent);
  const targetFolder = await directory.getDirectoryHandle(destination) as LocalDirectoryHandle;
  const metadata = await readVaultMetadata(directory);
  if (!metadata) throw new Error('The vault marker is missing. No media was moved.');
  const oldItem = metadata.items.find((entry) => entry.parent === item.parent && entry.file === item.name);
  if (JSON.stringify(oldItem?.keywords ?? []) !== JSON.stringify(item.keywords)) {
    throw new Error('The keywords changed elsewhere. Refresh the vault and try again.');
  }
  const newName = `${crypto.randomUUID()}.${item.name.split('.').pop()!.toLowerCase()}`;
  const journal = `.vaultx-operation-${crypto.randomUUID()}.json`;
  const record = { operation: 'move', source: { parent: item.parent, file: item.name }, destination: { parent: destination, file: newName }, keywords: item.keywords };
  try {
    await writeNewFile(directory, journal, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error.';
    throw new Error(`Could not create move record ${journal}. The source was not removed; inspect the vault before retrying. ${detail}`);
  }
  let sourceRemoved = false;
  try {
    await writeNewFile(targetFolder, newName, sourceFile);
    const target = await targetFolder.getFileHandle(newName);
    const copied = await target.getFile();
    if (!await filesMatch(sourceFile, copied)) throw new Error('The destination copy could not be verified.');
    await addItemMetadata(directory, { parent: destination, file: newName, keywords: item.keywords });
    const currentHandle = await currentMediaHandle(directory, item);
    const currentFile = await currentHandle.getFile();
    const currentTarget = await (await targetFolder.getFileHandle(newName)).getFile();
    const currentMetadata = await readVaultMetadata(directory);
    const currentSourceItem = currentMetadata?.items.find((entry) => entry.parent === item.parent && entry.file === item.name);
    const currentTargetItem = currentMetadata?.items.find((entry) => entry.parent === destination && entry.file === newName);
    if (!currentMetadata || JSON.stringify(currentSourceItem?.keywords ?? []) !== JSON.stringify(item.keywords) ||
        JSON.stringify(currentTargetItem?.keywords) !== JSON.stringify(item.keywords)) {
      throw new Error('The metadata changed during the move.');
    }
    if (currentFile.size !== sourceFile.size || currentFile.lastModified !== sourceFile.lastModified || !await filesMatch(currentFile, currentTarget)) {
      throw new Error('The source or destination changed during the move.');
    }
    await sourceFolder.removeEntry(item.name);
    sourceRemoved = true;
    await updateMetadata(directory, (current) => {
      const sourceItem = current.items.find((entry) => entry.parent === item.parent && entry.file === item.name);
      if (sourceItem && JSON.stringify(sourceItem.keywords) !== JSON.stringify(item.keywords)) {
        throw new Error('The source metadata changed during the move.');
      }
      current.items = current.items.filter((entry) => entry.parent !== item.parent || entry.file !== item.name);
    });
    await directory.removeEntry(journal);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error.';
    throw new Error(`Move incomplete. ${sourceRemoved ? 'The original was removed; a verified copy was saved' : 'Check the original and the possible copy'} at ${destination}/${newName}. Inspect ${journal} and refresh before retrying. ${detail}`);
  }
}

export async function importMedia(directory: LocalDirectoryHandle, parent: string, file: File, keywordValues: string[]): Promise<string> {
  if (!mediaType(file.name)) throw new Error('Choose a supported image, GIF, or video file.');
  const keywords = cleanKeywords(keywordValues, 30);
  const folder = await directory.getDirectoryHandle(parent) as LocalDirectoryHandle;
  const extension = file.name.split('.').pop()!.toLowerCase();
  const name = `${crypto.randomUUID()}.${extension}`;
  try {
    await writeNewFile(folder, name, file);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error.';
    throw new ImportError(`Could not finish copying to ${parent}/${name}. Inspect that location before retrying. ${detail}`, 'copy', `${parent}/${name}`, error instanceof DOMException && error.name === 'NotAllowedError');
  }
  try {
    await addItemMetadata(directory, { parent, file: name, keywords });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error.';
    throw new ImportError(`The file was copied to ${parent}/${name}, but its metadata update needs attention. ${detail}`, 'metadata', `${parent}/${name}`);
  }
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponent(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..' && !/[\\/\0]/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

export function parseVaultMetadata(text: string): VaultMetadata {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The vault marker is not valid JSON. Restore it from a backup; it was not changed.');
  }
  if (!isRecord(value) || value.format !== 'vaultx') {
    throw new Error('This folder has an invalid vault marker. It was not changed.');
  }
  if (value.version !== 1) {
    throw new Error('This vault version is not supported. Its files were not changed.');
  }
  if (typeof value.vaultId !== 'string' || !value.vaultId.trim() || !isStringArray(value.keywords) || !Array.isArray(value.items)) {
    throw new Error('The vault metadata is invalid. Restore it from a backup; it was not changed.');
  }
  const keys = new Set<string>();
  const items: VaultItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item) || !isComponent(item.parent) || !isComponent(item.file) || !isStringArray(item.keywords)) {
      throw new Error('The vault metadata contains an invalid item. It was not changed.');
    }
    const key = JSON.stringify([item.parent, item.file]);
    if (keys.has(key)) throw new Error('The vault metadata contains duplicate items. It was not changed.');
    keys.add(key);
    items.push({ parent: item.parent, file: item.file, keywords: item.keywords });
  }
  return { format: 'vaultx', version: 1, vaultId: value.vaultId, keywords: value.keywords, items };
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

export async function readVaultMetadata(directory: LocalDirectoryHandle): Promise<VaultMetadata | null> {
  let marker: FileSystemFileHandle;
  try {
    marker = await directory.getFileHandle(MARKER);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  return parseVaultMetadata(await (await marker.getFile()).text());
}

export async function initializeVault(directory: LocalDirectoryHandle): Promise<void> {
  if (await readVaultMetadata(directory)) throw new Error('This folder already has a vault marker. It was not changed.');
  const marker = await directory.getFileHandle(MARKER, { create: true });
  if ((await marker.getFile()).size !== 0) throw new Error('A vault marker appeared while initializing. It was not changed.');
  const metadata: VaultMetadata = { format: 'vaultx', version: 1, vaultId: crypto.randomUUID(), keywords: [], items: [] };
  try {
    const writer = await marker.createWritable();
    await writer.write(`${JSON.stringify(metadata, null, 2)}\n`);
    await writer.close();
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`Could not finish creating the vault marker.${detail} Check vaultx.json in the selected folder before trying again; it may be incomplete.`);
  }
}

export async function scanVault(directory: LocalDirectoryHandle, metadata: VaultMetadata): Promise<VaultContents> {
  const parents: string[] = [];
  const media: LocalMedia[] = [];
  let rootMedia = 0;
  let nestedFolders = 0;
  let unindexed = 0;
  const recoveryBackups: string[] = [];
  const pendingOperations: string[] = [];
  const indexed = new Map(metadata.items.map((item) => [JSON.stringify([item.parent, item.file]), item]));
  const found = new Set<string>();

  for await (const entry of directory.values()) {
    if (entry.kind === 'file') {
      if (entry.name.startsWith('.vaultx-backup-') && entry.name.endsWith('.json')) recoveryBackups.push(entry.name);
      if (entry.name.startsWith('.vaultx-operation-') && entry.name.endsWith('.json')) pendingOperations.push(entry.name);
      if (mediaType(entry.name)) rootMedia += 1;
      continue;
    }
    if (entry.kind !== 'directory') continue;
    const parent = entry.name;
    parents.push(parent);
    const folder = await directory.getDirectoryHandle(parent) as LocalDirectoryHandle;
    for await (const child of folder.values()) {
      if (child.kind === 'directory') {
        nestedFolders += 1;
        continue;
      }
      const type = mediaType(child.name);
      if (!type) continue;
      const key = JSON.stringify([parent, child.name]);
      const item = indexed.get(key);
      if (item) found.add(key);
      else unindexed += 1;
      media.push({ parent, name: child.name, type, handle: await folder.getFileHandle(child.name), keywords: item?.keywords ?? [] });
    }
  }
  parents.sort((a, b) => a.localeCompare(b));
  media.sort((a, b) => a.parent.localeCompare(b.parent) || a.name.localeCompare(b.name));
  return { parents, media, missing: metadata.items.filter((item) => !found.has(JSON.stringify([item.parent, item.file]))), unindexed, rootMedia, nestedFolders, recoveryBackups, pendingOperations };
}
