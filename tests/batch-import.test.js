import assert from 'node:assert/strict';
import test from 'node:test';
import { executeBatch } from '../src/lib/batch-import.ts';
import { captureDrop, collectDrop } from '../src/lib/import-sources.ts';

test('batch continues after safe failures and never retries saved or uncertain items', async () => {
  const items = ['saved', 'attention', 'pending', 'failed', 'pending'].map((status, id) => ({ id, status }));
  const seen = [];
  const interrupted = await executeBatch(items, async (item) => {
    seen.push(item.id);
    return { status: item.id === 2 ? 'failed' : 'saved' };
  }, (item, result) => { item.status = result.status; });
  assert.equal(interrupted, false);
  assert.deepEqual(seen, [2, 3, 4]);
  assert.deepEqual(items.map((item) => item.status), ['saved', 'attention', 'failed', 'saved', 'saved']);
});

test('batch pauses on uncertain metadata and resumes only pending items', async () => {
  const items = Array.from({ length: 3 }, (_, id) => ({ id, status: 'pending' }));
  const seen = [];
  const report = (item, result) => { item.status = result.status; };
  const paused = await executeBatch(items, async (item) => {
    seen.push(item.id);
    return item.id === 1 ? { status: 'attention', pause: true } : { status: 'saved' };
  }, report);
  assert.equal(paused, true);
  assert.deepEqual(items.map((item) => item.status), ['saved', 'attention', 'pending']);
  await executeBatch(items, async (item) => { seen.push(item.id); return { status: 'saved' }; }, report);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('drop enumeration traverses nested folders and reports unreadable entries', async () => {
  const file = (name) => ({ kind: 'file', name, async getFile() { return new File(['data'], name); } });
  const folder = (name, children) => ({ kind: 'directory', name, async *values() { yield* children; } });
  const broken = { kind: 'file', name: 'broken.png', async getFile() { throw new Error('Access denied'); } };
  const tree = folder('Source', [file('one.jpg'), folder('Nested', [file('two.png'), broken])]);
  const result = await collectDrop([{ handle: Promise.resolve({ value: tree }), entry: null, file: null }]);
  assert.deepEqual(result.files.map((item) => item.path), ['Source/one.jpg', 'Source/Nested/two.png']);
  assert.deepEqual(result.errors, ['Source/Nested/broken.png: Access denied']);
});

test('drop falls back to directory entries and reads all entry batches', async () => {
  const makeFile = (name) => ({ name, isFile: true, isDirectory: false, file(resolve) { resolve(new File(['x'], name)); } });
  const entry = { name: 'Folder', isFile: false, isDirectory: true, createReader() {
    const batches = [[makeFile('a.jpg')], [makeFile('b.png')], []];
    return { readEntries(resolve) { resolve(batches.shift()); } };
  } };
  const result = await collectDrop([{ handle: Promise.resolve({ value: null, error: new Error('Unavailable') }), entry, file: null }]);
  assert.deepEqual(result.files.map((item) => item.path), ['Folder/a.jpg', 'Folder/b.png']);
  assert.deepEqual(result.errors, []);
});

test('drop captures every handle immediately and reports unsupported items', async () => {
  const calls = [];
  let resolveFirst;
  const items = [
    { kind: 'file', getAsFileSystemHandle() { calls.push('first'); return new Promise((resolve) => { resolveFirst = resolve; }); }, getAsFile() { return null; } },
    { kind: 'file', getAsFileSystemHandle() { calls.push('second'); return Promise.reject(new Error('Cannot read folder')); }, getAsFile() { return null; } },
  ];
  const captured = captureDrop({ items });
  assert.deepEqual(calls, ['first', 'second']);
  const resultPromise = collectDrop(captured);
  resolveFirst({ kind: 'file', name: 'one.png', async getFile() { return new File(['x'], 'one.png'); } });
  const result = await resultPromise;
  assert.deepEqual(result.files.map((item) => item.path), ['one.png']);
  assert.deepEqual(result.errors, ['Cannot read folder']);
});
