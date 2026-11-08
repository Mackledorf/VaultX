import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalAuthDisabled } from './auth-mode.js';

test('password bypass is limited to explicit non-production loopback configuration', () => {
  assert.equal(isLocalAuthDisabled({ enabled: 'true', nodeEnv: 'development', host: '127.0.0.1' }), true);
  assert.equal(isLocalAuthDisabled({ enabled: 'true', nodeEnv: undefined, host: 'localhost' }), true);
  assert.equal(isLocalAuthDisabled({ enabled: 'true', nodeEnv: 'production', host: '127.0.0.1' }), false);
  assert.equal(isLocalAuthDisabled({ enabled: 'true', nodeEnv: 'development', host: '0.0.0.0' }), false);
  assert.equal(isLocalAuthDisabled({ enabled: 'false', nodeEnv: 'development', host: '127.0.0.1' }), false);
});
