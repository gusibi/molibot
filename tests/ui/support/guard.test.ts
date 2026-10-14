import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertIsolatedDataDir, assertLoopbackUrl, assertOutsideDir, UI_DATA_PREFIX } from './guard.js';
import { buildIsolatedEnv } from './instance.js';

test('rejects a data directory outside the system temp root', () => {
  assert.throws(() => assertIsolatedDataDir('/Users/someone/.molibot', 'test'), /temp directory/);
});

test('rejects a temp directory without the fixed prefix', () => {
  assert.throws(() => assertIsolatedDataDir(join(tmpdir(), 'not-a-molibot-dir'), 'test'), /prefix/);
});

test('accepts a prefixed temp data directory', () => {
  assert.doesNotThrow(() => assertIsolatedDataDir(join(tmpdir(), `${UI_DATA_PREFIX}abc`), 'test'));
});

test('rejects a non-loopback model address', () => {
  assert.throws(() => assertLoopbackUrl('http://example.com/v1', 'model'), /loopback/);
});

test('accepts a loopback model address', () => {
  assert.doesNotThrow(() => assertLoopbackUrl('http://127.0.0.1:1234/v1', 'model'));
  assert.doesNotThrow(() => assertLoopbackUrl('http://localhost:9/v1', 'model'));
});

test('rejects storage paths that land in the real data directory', () => {
  assert.throws(
    () => assertOutsideDir({ dbDir: '/home/u/.molibot/db' }, '/home/u/.molibot', 'seed'),
    /real data directory/
  );
});

test('accepts storage paths inside the throwaway directory', () => {
  assert.doesNotThrow(() => assertOutsideDir({ dbDir: '/tmp/molibot-ui-x/db' }, '/home/u/.molibot', 'seed'));
});

test('the child environment carries only whitelisted values', () => {
  const env = buildIsolatedEnv({
    home: '/tmp/home',
    dataDir: '/tmp/data',
    port: 4123,
    modelUrl: 'http://127.0.0.1:5555/v1',
    forbiddenDir: '/home/u/.molibot',
    base: { PATH: '/usr/bin', TMPDIR: '/tmp', SECRET_KEY: 'leak-me', HTTP_PROXY: 'http://proxy', HOME: '/home/u' }
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.TMPDIR, '/tmp');
  assert.equal(env.HOME, '/tmp/home');
  assert.equal(env.DATA_DIR, '/tmp/data');
  assert.equal(env.PORT, '4123');
  assert.equal(env.MOLIBOT_DISABLE_EXTERNAL_CHANNELS, '1');
  assert.equal(env.SECRET_KEY, undefined);
  assert.equal(env.HTTP_PROXY, undefined);
});
