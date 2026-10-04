import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const [id, expected] = process.argv.slice(2);
if (!/^[A-E][0-9]{2}(?:-[a-z0-9]+)?$/.test(id ?? '') || !/^[0-9]+$/.test(expected ?? '')) throw new Error('Usage: node acceptance/verify.mjs B01 1');
let lines = [];
try { lines = (await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'results', `${id}.txt`), 'utf8')).split(/\r?\n/).filter(Boolean); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const ok = lines.length === Number(expected) && lines.every(line => line === `${id}-DONE`);
console.log(JSON.stringify({id, expected: Number(expected), actual: lines.length, lines, result: ok ? 'PASS' : 'FAIL'}, null, 2));
if (!ok) process.exitCode = 1;
