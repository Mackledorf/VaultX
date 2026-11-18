import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithSeekFallback } from './exportExecution';

test('retries without seeking only when FFmpeg reports a seek failure', async () => {
  const calls: boolean[] = [];
  const warnings: string[] = [];
  const result = await runWithSeekFallback(
    async (seek) => { calls.push(seek); return seek ? 1 : 0; },
    () => 'could not seek to position',
    (reason) => warnings.push(reason),
  );
  assert.equal(result, 0);
  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(warnings, ['could not seek to position']);
});

test('does not retry unrelated encoding failures', async () => {
  const calls: boolean[] = [];
  const result = await runWithSeekFallback(
    async (seek) => { calls.push(seek); return 1; },
    () => '',
    () => assert.fail('Unexpected fallback'),
  );
  assert.equal(result, 1);
  assert.deepEqual(calls, [true]);
});

test('propagates execution errors without retrying', async () => {
  const failure = new Error('Encoder unavailable');
  await assert.rejects(runWithSeekFallback(
    async () => { throw failure; },
    () => assert.fail('Unexpected seek check'),
    () => assert.fail('Unexpected fallback'),
  ), failure);
});
