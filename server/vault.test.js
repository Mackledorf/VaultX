import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { hashPassword } from './auth.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dataDirectory;
let serverProcess;
let baseUrl;
let sessionCookie;
let serverErrorOutput = '';

before(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'vaultx-test-'));
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const passwordHash = await hashPassword('temporary-vault-test-password');
  serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDirectory,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: 'temporary-test-session-secret-long-enough',
      VAULT_PASSWORD_HASH: passwordHash,
      VAULT_AUTH_DISABLED: 'false',
      VAULT_STORAGE_PROVIDER: 'local',
      LOCAL_STORAGE_DIR: dataDirectory,
      MAX_FILE_SIZE_BYTES: '1048576',
    },
  });
  serverProcess.stderr.setEncoding('utf8');
  serverProcess.stderr.on('data', (output) => { serverErrorOutput += output; });
  await waitForServer();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await once(serverProcess, 'exit');
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('private search and media routes deny anonymous requests', async () => {
  const response = await fetch(`${baseUrl}/api/entries?q=private`);
  assert.equal(response.status, 401);
});

test('authenticated upload, tag search, media, edits, and deletion work', async () => {
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'temporary-vault-test-password' }),
  });
  assert.equal(loginResponse.status, 200);
  sessionCookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(sessionCookie?.startsWith('vaultx_session='));

  const pngBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#789' } }).png().toBuffer();
  const invalidBatchResponse = await fetch(`${baseUrl}/api/upload-batches`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ size: pngBytes.length, tags: [] }] }),
  });
  assert.equal(invalidBatchResponse.status, 400);

  const batchResponse = await fetch(`${baseUrl}/api/upload-batches`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [
        { size: pngBytes.length, tags: [' Beach day ', 'BEACH DAY', 'family'] },
        { size: pngBytes.length, tags: ['Portrait', 'friend'] },
      ],
    }),
  });
  assert.equal(batchResponse.status, 201);
  const batch = await batchResponse.json();
  assert.equal(Object.hasOwn(batch.files[0], 'name'), false);
  assert.equal(Object.hasOwn(batch, 'tags'), false);

  const form = new FormData();
  form.append('index', '0');
  form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'upload');
  const uploadResponse = await fetch(`${baseUrl}/api/upload-batches/${batch.id}/files`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: form,
  });
  assert.equal(uploadResponse.status, 201, serverErrorOutput);
  const uploaded = await uploadResponse.json();
  const entry = uploaded.entry;
  assert.equal(entry.mediaType, 'image');
  assert.equal(entry.hasPreview, true);
  assert.deepEqual(entry.tags, ['Beach day', 'family']);
  assert.equal(Object.hasOwn(entry, 'displayName'), false);

  const secondForm = new FormData();
  secondForm.append('index', '1');
  secondForm.append('file', new Blob([pngBytes], { type: 'image/png' }), 'upload');
  const secondUploadResponse = await fetch(`${baseUrl}/api/upload-batches/${batch.id}/files`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: secondForm,
  });
  assert.equal(secondUploadResponse.status, 201, serverErrorOutput);
  const secondEntry = (await secondUploadResponse.json()).entry;
  assert.deepEqual([...secondEntry.tags].sort(), ['Portrait', 'friend'].sort());

  const anonymousMedia = await fetch(`${baseUrl}${entry.mediaUrl}`);
  assert.equal(anonymousMedia.status, 401);
  const anonymousPreview = await fetch(`${baseUrl}/api/media/${entry.id}/preview`);
  assert.equal(anonymousPreview.status, 401);

  const searchResponse = await fetch(`${baseUrl}/api/entries?q=beach%20fam&type=image`, { headers: { Cookie: sessionCookie } });
  const results = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(results.total, 1);
  assert.equal(results.items[0].id, entry.id);
  assert.equal(results.items[0].mediaType, 'image');

  const mediaResponse = await fetch(`${baseUrl}${entry.mediaUrl}`, { headers: { Cookie: sessionCookie } });
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await mediaResponse.arrayBuffer()), new Uint8Array(pngBytes));
  const rangeResponse = await fetch(`${baseUrl}${entry.mediaUrl}`, { headers: { Cookie: sessionCookie, Range: 'bytes=-4' } });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get('content-range'), `bytes ${pngBytes.length - 4}-${pngBytes.length - 1}/${pngBytes.length}`);
  assert.deepEqual(new Uint8Array(await rangeResponse.arrayBuffer()), new Uint8Array(pngBytes.slice(-4)));
  const invalidRangeResponse = await fetch(`${baseUrl}${entry.mediaUrl}`, { headers: { Cookie: sessionCookie, Range: `bytes=${pngBytes.length + 5}-` } });
  assert.equal(invalidRangeResponse.status, 416);
  assert.equal(invalidRangeResponse.headers.get('content-range'), `bytes */${pngBytes.length}`);
  const previewResponse = await fetch(`${baseUrl}/api/media/${entry.id}/preview`, { headers: { Cookie: sessionCookie } });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.headers.get('content-type'), 'image/webp');
  assert.ok(Number(previewResponse.headers.get('content-length')) < pngBytes.length + 1000);

  const updateResponse = await fetch(`${baseUrl}/api/entries/${entry.id}/tags`, {
    method: 'PATCH',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: ['private archive'] }),
  });
  assert.equal(updateResponse.status, 200);
  const oldTagResults = await fetch(`${baseUrl}/api/entries?q=beach`, { headers: { Cookie: sessionCookie } });
  assert.equal((await oldTagResults.json()).total, 0);
  const newTagResults = await fetch(`${baseUrl}/api/entries?q=private`, { headers: { Cookie: sessionCookie } });
  assert.equal((await newTagResults.json()).total, 1);

  const mediaFiles = await readdir(path.join(dataDirectory, 'media'));
  assert.deepEqual(mediaFiles.sort(), [entry.id, secondEntry.id].sort());
  const deleteResponse = await fetch(`${baseUrl}/api/entries/${entry.id}`, { method: 'DELETE', headers: { Cookie: sessionCookie } });
  assert.equal(deleteResponse.status, 204);
  const deleteSecondResponse = await fetch(`${baseUrl}/api/entries/${secondEntry.id}`, { method: 'DELETE', headers: { Cookie: sessionCookie } });
  assert.equal(deleteSecondResponse.status, 204);
  assert.deepEqual(await readdir(path.join(dataDirectory, 'media')), []);
});

test('unsupported file signatures are rejected without leaving staged data', async () => {
  const batchResponse = await fetch(`${baseUrl}/api/upload-batches`, {
    method: 'POST',
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ size: 5, tags: ['test'] }] }),
  });
  const batch = await batchResponse.json();
  const form = new FormData();
  form.append('index', '0');
  form.append('file', new Blob(['plain']), 'upload');
  const uploadResponse = await fetch(`${baseUrl}/api/upload-batches/${batch.id}/files`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: form,
  });
  assert.equal(uploadResponse.status, 400);
  assert.deepEqual(await readdir(path.join(dataDirectory, '.staging')), []);
});

test('cross-origin requests are rejected and repeated login failures are throttled', async () => {
  const crossOriginResponse = await fetch(`${baseUrl}/api/entries`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(crossOriginResponse.status, 403);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    assert.equal(response.status, 401);
  }
  const throttled = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get('retry-after')) > 0);
});

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`VaultX server exited with code ${serverProcess.exitCode}: ${serverErrorOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('VaultX server did not become ready');
}
