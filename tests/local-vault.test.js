import assert from 'node:assert/strict';
import test from 'node:test';
import { createParent, createVault, importMedia, initializeVault, moveMedia, parseVaultMetadata, readVaultMetadata, scanVault, updateMediaKeywords } from '../src/lib/local-vault.ts';

function fakeFile(name, initial = '') {
  let contents = initial;
  let modified = 1;
  return {
    kind: 'file',
    name,
    async getFile() { return new File([contents], name, { lastModified: modified }); },
    async isSameEntry(other) { return this === other; },
    async createWritable() {
      return {
        async write(value) { contents = value; modified += 1; },
        async close() {},
      };
    },
    get contents() { return contents; },
    setContents(value) { contents = value; modified += 1; },
  };
}

function fakeDirectory(name, children = []) {
  const entries = new Map(children.map((child) => [child.name, child]));
  return {
    kind: 'directory',
    name,
    async *values() { yield* entries.values(); },
    async getFileHandle(child, options) {
      let entry = entries.get(child);
      if (!entry && options?.create) {
        entry = fakeFile(child);
        entries.set(child, entry);
      }
      if (!entry) throw new DOMException('Missing', 'NotFoundError');
      if (entry.kind !== 'file') throw new DOMException('Wrong kind', 'TypeMismatchError');
      return entry;
    },
    async getDirectoryHandle(child, options) {
      let entry = entries.get(child);
      if (!entry && options?.create) {
        entry = fakeDirectory(child);
        entries.set(child, entry);
      }
      if (!entry) throw new DOMException('Missing', 'NotFoundError');
      if (entry.kind !== 'directory') throw new DOMException('Wrong kind', 'TypeMismatchError');
      return entry;
    },
    async removeEntry(child) {
      if (!entries.delete(child)) throw new DOMException('Missing', 'NotFoundError');
    },
  };
}

test('initialization creates a marker without changing existing files', async () => {
  const original = fakeFile('photo.jpg', 'original');
  const root = fakeDirectory('vault', [fakeDirectory('Photos', [original])]);
  assert.equal(await readVaultMetadata(root), null);
  await initializeVault(root);
  const metadata = await readVaultMetadata(root);
  assert.equal(metadata.format, 'vaultx');
  assert.equal(metadata.version, 1);
  assert.ok(metadata.vaultId);
  assert.equal(original.contents, 'original');
  await assert.rejects(() => initializeVault(root), /already has a vault marker/);
});

test('invalid, unsupported and duplicate metadata is rejected without replacing the marker', async () => {
  for (const text of [
    '{',
    JSON.stringify({ format: 'vaultx', version: 2 }),
    JSON.stringify({ format: 'vaultx', version: 1, vaultId: 'id', keywords: [], items: [
      { parent: 'Photos', file: 'a.jpg', keywords: [] },
      { parent: 'Photos', file: 'a.jpg', keywords: [] },
    ] }),
    JSON.stringify({ format: 'vaultx', version: 1, vaultId: 'id', keywords: [], items: [
      { parent: '../outside', file: 'a.jpg', keywords: [] },
    ] }),
  ]) {
    const marker = fakeFile('vaultx.json', text);
    const root = fakeDirectory('vault', [marker]);
    await assert.rejects(() => initializeVault(root));
    assert.equal(marker.contents, text);
  }
});

test('scan reads parent folders, keywords and unindexed files without modifying metadata', async () => {
  const metadata = parseVaultMetadata(JSON.stringify({
    format: 'vaultx', version: 1, vaultId: 'id', keywords: ['coast'],
    items: [
      { parent: 'Photos', file: 'a.jpg', keywords: ['coast'] },
      { parent: 'Photos', file: 'missing.png', keywords: ['old'] },
    ],
  }));
  const root = fakeDirectory('vault', [
    fakeFile('root.gif'),
    fakeDirectory('Empty'),
    fakeDirectory('Photos', [fakeFile('a.jpg'), fakeFile('new.GIF'), fakeFile('note.txt'), fakeDirectory('Nested')]),
  ]);
  const result = await scanVault(root, metadata);
  assert.deepEqual(result.parents, ['Empty', 'Photos']);
  assert.deepEqual(result.media.map(({ name, type, keywords }) => ({ name, type, keywords })), [
    { name: 'a.jpg', type: 'image', keywords: ['coast'] },
    { name: 'new.GIF', type: 'gif', keywords: [] },
  ]);
  assert.equal(result.unindexed, 1);
  assert.equal(result.rootMedia, 1);
  assert.equal(result.nestedFolders, 1);
  assert.equal(result.missing[0].file, 'missing.png');
  assert.equal(metadata.items.length, 2);
});

test('filesystem access failures are not mistaken for a missing marker', async () => {
  const root = fakeDirectory('vault');
  root.getFileHandle = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(() => readVaultMetadata(root), { name: 'NotAllowedError' });
  await assert.rejects(() => initializeVault(root), { name: 'NotAllowedError' });
});

test('new vault and parents are created without altering existing folders', async () => {
  const existing = fakeDirectory('Existing');
  const location = fakeDirectory('location', [existing]);
  const vault = await createVault(location, 'My vault');
  assert.equal((await readVaultMetadata(vault)).format, 'vaultx');
  await createParent(vault, 'Photos');
  assert.deepEqual((await scanVault(vault, await readVaultMetadata(vault))).parents, ['Photos']);
  await assert.rejects(() => createVault(location, 'existing'), /already exists/);
  await assert.rejects(() => createParent(vault, 'CON.txt'), /valid folder name/);
  await assert.rejects(() => createParent(vault, '../other'), /valid folder name/);
  assert.equal(await location.getDirectoryHandle('Existing'), existing);
});

test('import copies media and writes optional keywords without modifying the source', async () => {
  const vault = fakeDirectory('vault');
  await initializeVault(vault);
  await createParent(vault, 'Photos');
  const source = new File(['image data'], 'original.JPG');
  const name = await importMedia(vault, 'Photos', source, [' Coast ', 'coast', 'Sunset']);
  const folder = await vault.getDirectoryHandle('Photos');
  assert.equal(await (await (await folder.getFileHandle(name)).getFile()).text(), 'image data');
  assert.equal(await source.text(), 'image data');
  const metadata = await readVaultMetadata(vault);
  assert.deepEqual(metadata.items, [{ parent: 'Photos', file: name, keywords: ['Coast', 'Sunset'] }]);
  assert.deepEqual(metadata.keywords, ['Coast', 'Sunset']);
  assert.deepEqual((await scanVault(vault, metadata)).media.map((item) => item.name), [name]);
  assert.deepEqual((await Array.fromAsync(vault.values())).map((entry) => entry.name).sort(), ['Photos', 'vaultx.json']);
  const secondName = await importMedia(vault, 'Photos', source, []);
  assert.notEqual(name, secondName);
  assert.deepEqual((await readVaultMetadata(vault)).items[1].keywords, []);
});

test('metadata conflicts retain the copied file and a recovery backup', async () => {
  const vault = fakeDirectory('vault');
  await initializeVault(vault);
  await createParent(vault, 'Photos');
  const marker = await vault.getFileHandle('vaultx.json');
  const originalGetFile = marker.getFile;
  const changed = JSON.stringify({ format: 'vaultx', version: 1, vaultId: 'external', keywords: [], items: [] });
  let reads = 0;
  marker.getFile = async () => {
    if (++reads === 2) marker.setContents(changed);
    return originalGetFile();
  };
  await assert.rejects(() => importMedia(vault, 'Photos', new File(['original'], 'x.png'), ['tag']), /changed elsewhere.*backup/s);
  assert.equal(marker.contents, changed);
  const folder = await vault.getDirectoryHandle('Photos');
  const copied = await Array.fromAsync(folder.values());
  assert.equal(copied.length, 1);
  assert.equal(await (await copied[0].getFile()).text(), 'original');
  const backups = (await Array.fromAsync(vault.values())).filter((entry) => entry.name.startsWith('.vaultx-backup-'));
  assert.equal(backups.length, 1);
  assert.deepEqual((await scanVault(vault, await readVaultMetadata(vault))).recoveryBackups, [backups[0].name]);
});

test('a failed metadata write keeps the original marker, backup, and copied media', async () => {
  const vault = fakeDirectory('vault');
  await initializeVault(vault);
  await createParent(vault, 'Photos');
  const marker = await vault.getFileHandle('vaultx.json');
  const before = marker.contents;
  marker.createWritable = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(() => importMedia(vault, 'Photos', new File(['image'], 'photo.jpg'), []), /metadata update needs attention/);
  assert.equal(marker.contents, before);
  const scan = await scanVault(vault, await readVaultMetadata(vault));
  assert.equal(scan.unindexed, 1);
  assert.equal(scan.recoveryBackups.length, 1);
  assert.equal((await (await vault.getFileHandle(scan.recoveryBackups[0])).getFile()).size, before.length);
});

test('moving an indexed file verifies the copy and transfers its keywords', async () => {
  const vault = fakeDirectory('vault');
  await initializeVault(vault);
  await createParent(vault, 'Photos');
  await createParent(vault, 'Archive');
  const name = await importMedia(vault, 'Photos', new File(['image'], 'photo.jpg'), ['coast']);
  const item = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  await moveMedia(vault, item, 'Archive');
  const scan = await scanVault(vault, await readVaultMetadata(vault));
  assert.equal(scan.media.length, 1);
  assert.equal(scan.media[0].parent, 'Archive');
  assert.deepEqual(scan.media[0].keywords, ['coast']);
  assert.equal(await (await scan.media[0].handle.getFile()).text(), 'image');
  await assert.rejects(() => (vault.getDirectoryHandle('Photos')).then((folder) => folder.getFileHandle(name)), { name: 'NotFoundError' });
  assert.deepEqual(scan.pendingOperations, []);
  assert.deepEqual(scan.missing, []);
});

test('editing keywords indexes existing files and rejects stale metadata', async () => {
  const vault = fakeDirectory('vault', [fakeDirectory('Photos', [fakeFile('existing.png', 'image')])]);
  await initializeVault(vault);
  const item = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  await updateMediaKeywords(vault, item, [' coast ', 'COAST', 'sunset']);
  assert.deepEqual((await readVaultMetadata(vault)).items[0].keywords, ['coast', 'sunset']);
  await assert.rejects(() => updateMediaKeywords(vault, item, ['stale']), /changed elsewhere/);
  const updated = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  await updateMediaKeywords(vault, updated, []);
  assert.deepEqual((await readVaultMetadata(vault)).items[0].keywords, []);
});

test('a failed move before metadata is saved keeps the original and recovery record', async () => {
  const vault = fakeDirectory('vault');
  await initializeVault(vault);
  await createParent(vault, 'Photos');
  await createParent(vault, 'Archive');
  await importMedia(vault, 'Photos', new File(['image'], 'photo.jpg'), ['coast']);
  const item = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  const marker = await vault.getFileHandle('vaultx.json');
  marker.createWritable = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await assert.rejects(() => moveMedia(vault, item, 'Archive'), /Move incomplete/);
  const scan = await scanVault(vault, await readVaultMetadata(vault));
  assert.equal(scan.media.length, 2);
  assert.equal(await (await item.handle.getFile()).text(), 'image');
  assert.equal(scan.pendingOperations.length, 1);
  assert.equal(scan.recoveryBackups.length, 1);
  const journal = JSON.parse(await (await (await vault.getFileHandle(scan.pendingOperations[0])).getFile()).text());
  assert.equal(journal.source.file, item.name);
  assert.equal(journal.destination.parent, 'Archive');
});

test('a changed source during a move is not removed', async () => {
  const source = fakeFile('photo.jpg', 'original');
  const vault = fakeDirectory('vault', [fakeDirectory('Photos', [source]), fakeDirectory('Archive')]);
  await initializeVault(vault);
  const item = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  const getFile = source.getFile;
  let reads = 0;
  source.getFile = async () => {
    if (++reads === 2) source.setContents('changed');
    return getFile();
  };
  await assert.rejects(() => moveMedia(vault, item, 'Archive'), /changed during the move/);
  assert.equal(await (await source.getFile()).text(), 'changed');
  const scan = await scanVault(vault, await readVaultMetadata(vault));
  assert.equal(scan.media.length, 2);
  assert.equal(scan.pendingOperations.length, 1);
});

test('a corrupted destination is not treated as a successful move', async () => {
  const source = fakeFile('photo.jpg', 'original');
  const archive = fakeDirectory('Archive');
  const vault = fakeDirectory('vault', [fakeDirectory('Photos', [source]), archive]);
  await initializeVault(vault);
  const item = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  const getFileHandle = archive.getFileHandle;
  archive.getFileHandle = async (name, options) => {
    const handle = await getFileHandle(name, options);
    if (!options?.create) handle.setContents('corrupted');
    return handle;
  };
  await assert.rejects(() => moveMedia(vault, item, 'Archive'), /could not be verified/);
  assert.equal(await (await source.getFile()).text(), 'original');
  assert.equal((await scanVault(vault, await readVaultMetadata(vault))).pendingOperations.length, 1);
});

test('a failure after removing the source retains the verified copy and recovery record', async () => {
  const vault = fakeDirectory('vault');
  await initializeVault(vault);
  await createParent(vault, 'Photos');
  await createParent(vault, 'Archive');
  await importMedia(vault, 'Photos', new File(['image'], 'photo.jpg'), ['coast']);
  const item = (await scanVault(vault, await readVaultMetadata(vault))).media[0];
  const marker = await vault.getFileHandle('vaultx.json');
  const createWritable = marker.createWritable;
  let writes = 0;
  marker.createWritable = async () => {
    if (++writes === 2) throw new DOMException('Denied', 'NotAllowedError');
    return createWritable();
  };
  await assert.rejects(() => moveMedia(vault, item, 'Archive'), /original was removed/);
  const scan = await scanVault(vault, await readVaultMetadata(vault));
  assert.equal(scan.media.length, 1);
  assert.equal(scan.media[0].parent, 'Archive');
  assert.equal(await (await scan.media[0].handle.getFile()).text(), 'image');
  assert.deepEqual(scan.media[0].keywords, ['coast']);
  assert.equal(scan.missing.length, 1);
  assert.equal(scan.pendingOperations.length, 1);
  assert.equal(scan.recoveryBackups.length, 1);
});
