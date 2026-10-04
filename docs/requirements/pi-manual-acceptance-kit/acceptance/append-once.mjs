import { appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const [id] = process.argv.slice(2);
if (!/^[A-E][0-9]{2}(?:-[a-z0-9]+)?$/.test(id ?? '')) throw new Error('Invalid case ID');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
await mkdir(dir, { recursive: true });
await appendFile(path.join(dir, `${id}.txt`), `${id}-DONE\n`);
console.log(`${id}: appended one marker`);
