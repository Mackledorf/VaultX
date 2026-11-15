import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createExtensionArchive } from '../scripts/extensionArchive.js';

test('download archive contains the current extension and its referenced files, without tests', () => {
  const archive = unzipSync(createExtensionArchive());
  const manifest = JSON.parse(strFromU8(archive['manifest.json']));
  const required = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ];
  for (const name of required) assert.ok(archive[name], `Missing extension file: ${name}`);
  const popup = strFromU8(archive[manifest.action.default_popup]);
  for (const [, name] of popup.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    assert.ok(archive[name], `Missing popup asset: ${name}`);
  }
  for (const [name, content] of Object.entries(archive)) {
    assert.doesNotMatch(name, /\.test\./);
    assert.deepEqual(content, new Uint8Array(readFileSync(new URL(name, import.meta.url))));
  }
  for (const [name, content] of Object.entries(archive)) {
    if (!name.endsWith('.js')) continue;
    for (const [, imported] of strFromU8(content).matchAll(/from ['"]\.\/([^'"]+)['"]/g)) {
      assert.ok(archive[imported], `Missing import from ${name}: ${imported}`);
    }
  }
});
