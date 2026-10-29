import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compile } from 'svelte/compiler';

test('embedding editor compiles without accessibility warnings', () => {
  const filename = new URL('./+page.svelte', import.meta.url);
  const source = readFileSync(filename, 'utf8');
  const { warnings } = compile(source, { filename: filename.pathname, generate: false });
  assert.deepEqual(warnings.filter(({ code }) => code.startsWith('a11y_')), []);
});
