import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installLcuAutoStop} from './install-lcu-auto-stop.mjs';
test('LCU overlay is versioned, preserves upstream imports and backs up the managed entry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lcu-overlay-'));
 try {
  const release=join(dir,'release'),extensionDir=join(dir,'extension');mkdirSync(join(release,'adapters','pi'),{recursive:true});mkdirSync(extensionDir);
  const source="import {createCuaClient} from '../client.mjs';\nasync function finish() {}\nexport default function(pi) { return import.meta.url; }\n";
  const client='export function createCuaClient(){return {async controlStatus(){},async controlStop(){}};}';
  const adapter=join(release,'adapters','pi','index.ts');writeFileSync(adapter,source);writeFileSync(join(release,'adapters','client.mjs'),client);
  const original=`import lcu from ${JSON.stringify(adapter)};\nexport default pi => lcu(pi, {command: ["fixture"]});\n`;writeFileSync(join(extensionDir,'index.ts'),original);
  const input={extensionDir,releaseRoot:release,appRoot:process.cwd()};installLcuAutoStop(input);
  const entry=readFileSync(join(extensionDir,'index.ts'),'utf8');assert.match(entry,/\.molibot-lcu-auto-stop\/[a-f0-9]{16}\/pi\.ts/);
  const manifest=JSON.parse(readFileSync(join(extensionDir,'.molibot-lcu-auto-stop','manifest.json'),'utf8'));
  const generated=readFileSync(join(extensionDir,'.molibot-lcu-auto-stop',Object.keys(manifest.files).find(file=>file.endsWith('/pi.ts'))),'utf8');
  assert.ok(generated.includes(`file://${realpathSync(adapter)}`));assert.ok(!generated.includes('import.meta.url'));
  assert.equal(readFileSync(adapter,'utf8'),source);assert.equal(readFileSync(join(release,'adapters','client.mjs'),'utf8'),client);
  const backups=readdirSync(extensionDir).filter(file=>file.startsWith('index.backup-'));assert.equal(backups.length,1);assert.equal(readFileSync(join(extensionDir,backups[0]),'utf8'),original);
  installLcuAutoStop(input);assert.equal(readdirSync(extensionDir).filter(file=>file.startsWith('index.backup-')).length,1);
  writeFileSync(join(extensionDir,'index.ts'),entry+'// owner edit\n');assert.throws(()=>installLcuAutoStop(input),/custom edits/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
