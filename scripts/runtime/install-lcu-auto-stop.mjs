import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,renameSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';

const digest=text=>createHash('sha256').update(text).digest('hex');
function atomicWrite(path,text){const temporary=`${path}.${randomUUID()}.tmp`;writeFileSync(temporary,text,{mode:0o600,flag:'wx'});renameSync(temporary,path);}

/** Generate a scoped overlay; keep upstream files and other harnesses unchanged. */
export function installLcuAutoStop({extensionDir,releaseRoot,appRoot}) {
  const release=realpathSync(releaseRoot), app=realpathSync(appRoot);
  const adapter=join(release,'adapters','pi','index.ts'), originalClient=join(release,'adapters','client.mjs');
  const helper=join(app,'scripts','runtime','lcu-auto-stop.mjs');
  if(!existsSync(helper))throw new Error('Molibot LCU cleanup helper is missing.');
  const source=readFileSync(adapter,'utf8'), client=readFileSync(originalClient,'utf8'), helperSource=readFileSync(helper,'utf8');
  const generation=digest(source+client+helperSource).slice(0,16);
  if(!source.includes("from '../client.mjs'")||!source.includes('async function finish(')||!client.includes('async controlStatus(')||!client.includes('async controlStop('))throw new Error('Unsupported LCU adapter shape; no installed files were changed.');
  const entry=join(extensionDir,'index.ts'), overlay=join(extensionDir,'.molibot-lcu-auto-stop'), manifestPath=join(overlay,'manifest.json');
  const prior=existsSync(entry)?readFileSync(entry,'utf8'):undefined;
  const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):undefined;
  let originalImport;
  try {const path=/^\s*import lcu from ["']([^"']+)["'];/.exec(prior??'')?.[1];if(path)originalImport=realpathSync(path);}catch{}
  if(prior && !(manifest ? digest(prior)===manifest.entryHash : originalImport===adapter&&/^\s*import lcu from [^;]+;\s*export default pi => lcu\(pi, \{command: \[[^\]]+\]\}\);\s*$/.test(prior)))throw new Error('The managed LCU entry has custom edits. Preserve and review them before applying the overlay.');
  if(manifest)for(const [file,hash] of Object.entries(manifest.files??{}))if(!/^[a-f0-9]{16}\/(?:pi\.ts|client\.mjs|lcu-auto-stop\.mjs)$/.test(file)||digest(readFileSync(join(overlay,file),'utf8'))!==hash)throw new Error('Generated LCU overlay was edited; refusing to overwrite it.');
  const generationDir=join(overlay,generation);
  const fromAdapter=createRequire(adapter), fromApp=createRequire(join(app,'package.json'));
  const generatedAdapter=source.replace(/(^import\s+(?!type\b)[^\n]*?\bfrom\s+)(['"])([^'"]+)\2/gm,(_match,prefix,_quote,specifier)=>{
    let target=specifier;
    if(specifier==='../client.mjs')target=join(generationDir,'client.mjs');
    else if(specifier.startsWith('.'))target=resolve(dirname(adapter),specifier);
    else if(!specifier.startsWith('node:')){try{target=fromAdapter.resolve(specifier);}catch{target=fromApp.resolve(specifier);}}
    return prefix+JSON.stringify(target);
  }).replaceAll('import.meta.url',JSON.stringify(pathToFileURL(adapter).href));
  const generatedClient=`export * from ${JSON.stringify(originalClient)};\nimport {createCuaClient as createOriginal} from ${JSON.stringify(originalClient)};\nimport {withLcuAutoStop} from "./lcu-auto-stop.mjs";\nexport function createCuaClient(options){return withLcuAutoStop(createOriginal(options));}\n`;
  const generatedEntry=`import lcu from "./.molibot-lcu-auto-stop/${generation}/pi.ts";\nexport default pi => lcu(pi, {command: [${JSON.stringify(join(release,'bin','lcu'))}]});\n`;
  mkdirSync(generationDir,{recursive:true,mode:0o700});
  if(prior!==undefined && prior!==generatedEntry)writeFileSync(join(extensionDir,`index.backup-${Date.now()}-${randomUUID()}.ts`),prior,{mode:0o600,flag:'wx'});
  const generatedFiles={'pi.ts':generatedAdapter,'client.mjs':generatedClient,'lcu-auto-stop.mjs':helperSource};
  for(const [file,text] of Object.entries(generatedFiles)){const path=join(generationDir,file);if(existsSync(path)&&readFileSync(path,'utf8')!==text)throw new Error('Generated LCU overlay was edited; refusing to overwrite it.');atomicWrite(path,text);}
  atomicWrite(manifestPath,JSON.stringify({version:1,adapterHash:digest(source),clientHash:digest(client),entryHash:digest(generatedEntry),files:Object.fromEntries(Object.entries(generatedFiles).map(([file,text])=>[`${generation}/${file}`,digest(text)]))}));
  atomicWrite(entry,generatedEntry);
  return {adapterHash:digest(source),clientHash:digest(client)};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [extensionDir,releaseRoot,appRoot]=process.argv.slice(2);
  if(!extensionDir||!releaseRoot||!appRoot)throw new Error('Usage: node scripts/runtime/install-lcu-auto-stop.mjs <managed-extension-dir> <LCU-release-root> <Molibot-root>');
  console.log(JSON.stringify({ok:true,...installLcuAutoStop({extensionDir:resolve(extensionDir),releaseRoot:resolve(releaseRoot),appRoot:resolve(appRoot)})}));
}
