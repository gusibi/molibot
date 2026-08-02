import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Node loader that mirrors Vite's raw-import behaviour under `node --test`.
 *
 * Two cases:
 * - `*.md` (with or without `?raw`) — prompt/profile templates.
 * - any `*?raw` specifier — Mini App built-in templates and similar assets that
 *   are embedded into the bundle at build time rather than read from disk.
 *
 * Without this, a module that Vite compiles fine fails only in tests, which is
 * exactly the drift the shared loader exists to prevent.
 */

function isRawSpecifier(value) {
  return value.includes('?raw');
}

function isMarkdown(value) {
  return value.includes('.md');
}

export async function resolve(specifier, context, nextResolve) {
  if (isMarkdown(specifier) || isRawSpecifier(specifier)) {
    const resolved = await nextResolve(stripRawQuery(specifier), context);
    return {
      format: 'module',
      shortCircuit: true,
      // Keep the query so `load` can tell a raw import from a normal one.
      url: isRawSpecifier(specifier) ? `${resolved.url}?raw` : resolved.url
    };
  }
  return nextResolve(specifier, context);
}

function stripRawQuery(specifier) {
  return specifier.replace(/\?raw$/, '');
}

export async function load(url, context, nextLoad) {
  if (isMarkdown(url) || isRawSpecifier(url)) {
    const cleanUrl = url.split('?')[0];
    const filePath = fileURLToPath(cleanUrl);
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(content)};`
    };
  }
  return nextLoad(url, context);
}
