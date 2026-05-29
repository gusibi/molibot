import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes('.md')) {
    const resolved = await nextResolve(specifier, context);
    return {
      format: 'module',
      shortCircuit: true,
      url: resolved.url
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes('.md')) {
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
