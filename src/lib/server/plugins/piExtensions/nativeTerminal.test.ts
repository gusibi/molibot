import assert from "node:assert/strict";
import { mkdtempSync as fsMkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { PhotonImage } from "@silvia-odwyer/photon-node";

const temporaryDirectories: string[] = [];
function mkdtempSync(prefix: string): string { const directory = fsMkdtempSync(prefix); temporaryDirectories.push(directory); return directory; }
after(() => { for (const directory of temporaryDirectories.reverse()) rmSync(directory, { recursive: true, force: true }); });

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "molibot-pi-native-"));
process.env.HOME = process.env.DATA_DIR;
const { PiExtensionTerminalHost } = await import("./nativeTerminal.js");
const model = { id: "fixture", name: "Fixture", provider: "fixture", api: "openai-completions", reasoning: false,
  input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 };

test("official Pi renders an unmodified custom extension UI and delegates model work to the host", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-native-extension-"));
  const entryPath = join(dir, "index.ts");
  const receipt = join(dir, "choice.txt");
  writeFileSync(entryPath, `import {writeFileSync} from 'node:fs';
export default function(pi) {
  pi.on('before_provider_request', (event) => ({...event.payload, nativeFixture:true}));
  pi.on('session_start', async (_, ctx) => {
    const value = await ctx.ui.custom((tui, theme, keys, done) => ({
      render() { return ['Native custom choice: press Enter']; },
      handleInput(data) { if (data === '\\r') done('accepted'); }
    }));
    writeFileSync(${JSON.stringify(receipt)}, value);
  });
}`);
  const host = new PiExtensionTerminalHost();
  host.heartbeat();
  let modelCalls = 0;
  let terminalId = "";
  let answered = false;
  const unsubscribe = host.subscribe((id) => {
    if (!answered && host.output(id).output.includes("Native custom choice")) {
      answered = true;
      void host.input(id, "\r");
    }
  });
  try {
    const result = await host.run({ sessionId: "native-fixture", runId: "native-run", callId: "native-call", prompt: "Say hello",
      extensions: [{ id: "custom", name: "Custom", version: "1", entryPath, toolNames: [], eventNames: ["session_start"], commandNames: [], flagNames: [], unsupported: [] }],
      onStarted: (terminal) => { terminalId = terminal.id; },
      options: { cwd: dir, reservedToolNames: new Set(),
        runtime: () => ({ cwd: dir, systemPrompt: "Fixture agent", model, scopedModels: [], isIdle: false, hasPendingMessages: false, models: {chat:[],classifier:[],image:[],providerAuth:{}}, session: {cwd:dir,entries:[]} }),
        toolCatalog: () => [],
        executeTool: async () => { throw new Error("No host tool was expected"); },
        streamModel: async (input, emit) => {
          modelCalls++;
          assert.equal(input.model.id, "fixture");
          assert.deepEqual(await input.onPayload?.({fixture:true}, model), {fixture:true, nativeFixture:true});
          const message = { role: "assistant", content: [{ type: "text", text: "native hello" }], api: model.api, provider: model.provider, model: model.id,
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
          emit({ type: "start", partial: { ...message, content: [] } });
          emit({ type: "done", reason: "stop", message });
          return { message };
        }
      }
    });
    assert.equal(result.text, "native hello");
    assert.equal(readFileSync(receipt, "utf8"), "accepted");
    assert.equal(modelCalls, 1);
    assert.equal(host.output(terminalId).terminal.status, "completed");
    assert.equal(host.output(terminalId).terminal.cleanupStatus,"hooks_completed");
    assert.equal(host.output(terminalId).terminal.sharingStatus,"unverified");
    await assert.rejects(host.input(terminalId, "again"), /has ended/);
  } finally { unsubscribe(); }
});

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function options(cwd: string): any {
  return { cwd, reservedToolNames: new Set(), toolCatalog: () => [], executeTool: async () => { throw new Error("Unexpected host tool"); },
    runtime: () => ({ cwd, systemPrompt: "Fixture", model, scopedModels: [], models: {chat:[],classifier:[],image:[],providerAuth:{}}, session: {cwd,entries:[]} }),
    streamModel: async (_input: any, emit: (event: unknown) => void) => {
      const message = { role: "assistant", content: [{ type: "text", text: "done" }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() };
      emit({ type: "done", reason: "stop", message }); return { message };
    } };
}
function extension(entryPath: string): any { return { id: "fixture", name: "Fixture", version: "1", entryPath, toolNames: [], eventNames: [], commandNames: [], flagNames: [], unsupported: [] }; }
function writeNoiseImage(path: string, size: number): void {
  const pixels = new Uint8Array(size * size * 4);
  let seed = 1;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = seed & 255;
  }
  const image = new PhotonImage(pixels, size, size);
  try { writeFileSync(path, JSON.stringify(Buffer.from(image.get_bytes()).toString("base64"))); }
  finally { image.free(); }
}
function writeCaptureExtension(entryPath: string, imagePath: string): void {
  writeFileSync(entryPath, `import { readFileSync } from 'node:fs';
export default function(pi) {
  pi.registerTool({ name: 'native_capture', label: 'Capture', description: 'Large fixture capture', parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: JSON.parse(readFileSync(${JSON.stringify(imagePath)}, 'utf8')) }], details: {} }) });
}`);
}

test("native slash commands receive configured flags and execute without a model request", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-command-"));
  const receipt = join(dir, "receipt.json");
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `import {writeFileSync} from 'node:fs'; export default function(pi) {
    pi.registerFlag('fixture-mode', {type:'string',default:'default'});
    pi.registerCommand('fixture', {handler: async(args,ctx) => { writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({args, flag:pi.getFlag('fixture-mode'),hasUI:ctx.hasUI,mode:ctx.mode})); }});
  }`);
  const host = new PiExtensionTerminalHost();
  const opts = options(dir);
  opts.streamModel = async () => { throw new Error("Command must not invoke a model"); };
  await host.run({ sessionId: "command", runId: "command", callId: "command", prompt: "/fixture hello world", extensions: [extension(entryPath)], flags: {"fixture-mode":"configured"}, options: opts });
  assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), {args:"hello world",flag:"configured",hasUI:true,mode:"tui"});
});

test("Stop cancels native input waits, concurrent ownership is rejected, and recovery requires review", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-stop-"));
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `export default function(pi) { pi.on('session_start', async(_,ctx) => { await ctx.ui.custom(() => ({render:()=>['Waiting for owner input'],handleInput(){}})); }); }`);
  const host = new PiExtensionTerminalHost();
  host.heartbeat();
  let ready!: () => void;
  const shown = new Promise<void>(resolve => { ready = resolve; });
  let id = "";
  const unsubscribe = host.subscribe(terminalId => { if (host.output(terminalId).output.includes("Waiting for owner input")) ready(); });
  const input = { sessionId: "stop", runId: "stop", callId: "stop", prompt: "wait", extensions: [extension(entryPath)], options: options(dir) };
  const pending = host.run({...input, onStarted: terminal => { id = terminal.id; }});
  const rejected = assert.rejects(pending, /Stopped from the native Pi terminal/);
  await shown;
  await assert.rejects(host.run(input), /already owns an active/);
  assert.throws(() => host.purgeSession("stop"), /Stop the active native/);
  host.stop(id);
  await rejected;
  unsubscribe();
  assert.equal(host.output(id).terminal.status, "stopped");
  const recovered = new PiExtensionTerminalHost();
  const interrupted = recovered.list().find(terminal => terminal.id === id)!;
  assert.equal(interrupted.status, "failed");
  await assert.rejects(recovered.run(input), /did not complete/);
  recovered.review(id);
  assert.equal(recovered.output(id).terminal.contextReviewed, true);
  writeFileSync(entryPath, `export default function(pi) { pi.registerCommand('ok',{handler:async()=>{}}); }`);
  await recovered.run({...input,prompt:"/ok"});
  assert.equal(recovered.list().at(-1)?.status, "completed");
});

test("dynamic native tools are visible to the next model request and execute through the official registry", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-dynamic-"));
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `export default function(pi) { pi.on('session_start', () => { pi.registerTool({name:'dynamic_fixture',label:'Dynamic',description:'Registered during session start',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'dynamic receipt'}],details:{}})}); }); }`);
  const opts = options(dir);
  let calls = 0;
  opts.streamModel = async (input: any, emit: (event: unknown) => void) => {
    assert.ok(JSON.stringify(input.context).includes('"name":"dynamic_fixture"'));
    const first = calls++ === 0;
    if (!first) assert.ok(JSON.stringify(input.context.messages).includes("dynamic receipt"));
    const message = { role: "assistant", api:model.api,provider:model.provider,model:model.id,usage,timestamp:Date.now(),
      content: first ? [{type:"toolCall",id:"dynamic",name:"dynamic_fixture",arguments:{}}] : [{type:"text",text:"verified"}], stopReason:first?"toolUse":"stop" };
    emit({type:"done",reason:message.stopReason,message}); return {message};
  };
  const host = new PiExtensionTerminalHost();
  const result = await host.run({sessionId:"dynamic",runId:"dynamic",callId:"dynamic",prompt:"Use dynamic tool",extensions:[extension(entryPath)],options:opts});
  assert.equal(calls,2);
  assert.equal(result.text,"verified");
});

test("oversized tool-result images are re-encoded as JPEG without shrinking their dimensions", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-image-limit-"));
  const imagePath = join(dir, "image.json");
  writeNoiseImage(imagePath, 500);
  const entryPath = join(dir, "index.ts");
  writeCaptureExtension(entryPath, imagePath);
  const opts = options(dir);
  const visionModel = { ...model, input: ["text", "image"] };
  opts.runtime = () => ({ cwd: dir, systemPrompt: "Fixture", model: visionModel, scopedModels: [], models: { chat: [], classifier: [], image: [], providerAuth: {} }, session: { cwd: dir, entries: [] } });
  let calls = 0;
  let observedId = "";
  opts.streamModel = async (input: any, emit: (event: unknown) => void) => {
    calls++;
    const parts = input.context.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []);
    const text = parts.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    if (calls === 1) {
      const message = { role: "assistant", content: [{ type: "toolCall", id: "capture", name: "native_capture", arguments: {} }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: Date.now() };
      emit({ type: "done", reason: "toolUse", message }); return { message };
    }
    if (calls === 2) {
      const images = parts.filter((part: any) => part.type === "image");
      assert.equal(images.length, 1);
      assert.equal(images[0].mimeType, "image/jpeg");
      assert.ok(images[0].data.length <= 700 * 1024, `base64 ${images[0].data.length}`);
      observedId = text.match(/pi-image-[a-f0-9]{64}/)?.[0] ?? "";
      assert.ok(observedId, "the model must receive an observation id that selects the image");
      const message = { role: "assistant", content: [{ type: "toolCall", id: "deliver", name: "molibot_deliver_images", arguments: { ids: [observedId], purpose: "screenshot" } }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: Date.now() };
      emit({ type: "done", reason: "toolUse", message }); return { message };
    }
    assert.match(text, /Selected 1 final image/);
    const message = { role: "assistant", content: [{ type: "text", text: "verified" }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() };
    emit({ type: "done", reason: "stop", message }); return { message };
  };
  const host = new PiExtensionTerminalHost();
  const result = await host.run({ sessionId: "image-limit", runId: "image-limit", callId: "image-limit", prompt: "capture", extensions: [extension(entryPath)], options: opts });
  assert.equal(calls, 3);
  assert.match(result.text ?? "", /^verified/);
  assert.equal(result.images?.length, 1);
  assert.equal(result.images?.[0]?.mimeType, "image/jpeg");
});

test("older observations are dropped when the native request image budget would be exceeded", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-image-budget-"));
  const imagePath = join(dir, "image.json");
  writeNoiseImage(imagePath, 800);
  const entryPath = join(dir, "index.ts");
  writeCaptureExtension(entryPath, imagePath);
  const opts = options(dir);
  const visionModel = { ...model, input: ["text", "image"] };
  opts.runtime = () => ({ cwd: dir, systemPrompt: "Fixture", model: visionModel, scopedModels: [], models: { chat: [], classifier: [], image: [], providerAuth: {} }, session: { cwd: dir, entries: [] } });
  let calls = 0;
  opts.streamModel = async (input: any, emit: (event: unknown) => void) => {
    calls++;
    const parts = input.context.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []);
    const images = parts.filter((part: any) => part.type === "image");
    const text = parts.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    if (calls === 1) {
      const message = { role: "assistant", content: [{ type: "toolCall", id: "capture-1", name: "native_capture", arguments: {} }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: Date.now() };
      emit({ type: "done", reason: "toolUse", message }); return { message };
    }
    assert.equal(images.length, 1);
    assert.equal(images[0].mimeType, "image/jpeg");
    assert.ok(images[0].data.length <= 700 * 1024, `base64 ${images[0].data.length}`);
    if (calls === 2) {
      const message = { role: "assistant", content: [{ type: "toolCall", id: "capture-2", name: "native_capture", arguments: {} }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: Date.now() };
      emit({ type: "done", reason: "toolUse", message }); return { message };
    }
    assert.match(text, /Earlier image omitted/);
    const message = { role: "assistant", content: [{ type: "text", text: "verified" }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() };
    emit({ type: "done", reason: "stop", message }); return { message };
  };
  const host = new PiExtensionTerminalHost();
  const result = await host.run({ sessionId: "image-budget", runId: "image-budget", callId: "image-budget", prompt: "capture twice", extensions: [extension(entryPath)], options: opts });
  assert.equal(calls, 3);
  assert.match(result.text ?? "", /^verified/);
});

test("official package discovery preserves glob exclusions, skills and prompt templates", { timeout: 20_000 }, async () => {
  const dir = join(process.env.DATA_DIR!, "extensions", "native-package");
  mkdirSync(join(dir,"skills","fixture"),{recursive:true});
  mkdirSync(join(dir,"prompts"),{recursive:true});
  writeFileSync(join(dir,"skills","fixture","SKILL.md"),"---\nname: fixture\ndescription: Native package skill\n---\nFixture skill text\n");
  writeFileSync(join(dir,"prompts","greeting.md"),"---\ndescription: Fixture greeting\n---\nPackage greeting $1\n");
  writeFileSync(join(dir,"package.json"),JSON.stringify({name:"native-package",pi:{extensions:["*.ts","!excluded.ts"],skills:["skills"],prompts:["prompts"]}}));
  writeFileSync(join(dir,"index.ts"),"export default function(pi) { pi.on('session_start',()=>{}); }");
  writeFileSync(join(dir,"excluded.ts"),"throw new Error('Excluded factory must not load');");
  const { validatePiExtensionDir } = await import("./install.js");
  assert.deepEqual(await validatePiExtensionDir(dir),{ok:true});
  const host = new PiExtensionTerminalHost();
  const opts = options(dir);
  opts.toolCatalog = () => [{name:"read",label:"Read",description:"Controlled file reader",parameters:{type:"object",properties:{path:{type:"string"}}}}];
  const base = opts.streamModel;
  opts.streamModel = async (input: any, emit: any, signal: any) => {
    const context = JSON.stringify(input.context);
    assert.ok(context.includes("Package greeting world"),context);
    assert.ok(context.includes("Native package skill"),context);
    return base(input,emit,signal);
  };
  await host.run({sessionId:"package",runId:"package",callId:"package",prompt:"/greeting world",extensions:[{...extension(join(dir,"index.ts")),id:"native-package"}],options:opts});
});

test("a suspended host tool parks native execution without a second model round", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(),"pi-native-approval-"));
  const entryPath = join(dir,"index.ts");
  writeFileSync(entryPath,"export default function(pi) { pi.on('session_start',()=>{}); }");
  const opts = options(dir);
  let calls = 0;
  let toolCalls = 0;
  opts.toolCatalog = () => [{name:"bash",label:"Bash",description:"Controlled shell",parameters:{type:"object",properties:{command:{type:"string"}}}}];
  opts.executeTool = async (name: string, args: any) => {
    toolCalls++; assert.equal(name,"bash"); assert.equal(args.command,"fixture command");
    return {isError:false,result:{content:[{type:"text",text:"Approval required"}],details:{approvalId:"fixture"},terminate:true}};
  };
  opts.streamModel = async (_input: any, emit: any) => {
    calls++;
    const message = {role:"assistant",provider:model.provider,model:model.id,api:model.api,usage,timestamp:Date.now(),stopReason:"toolUse",content:[{type:"toolCall",id:"shell",name:"bash",arguments:{command:"fixture command"}}]};
    emit({type:"done",reason:"toolUse",message});return {message};
  };
  const host = new PiExtensionTerminalHost();
  const result = await host.run({sessionId:"approval",runId:"approval",callId:"approval",prompt:"Run command",extensions:[extension(entryPath)],options:opts});
  assert.equal(calls,1);
  assert.equal(toolCalls,1);
  assert.equal((result.suspension as any).terminate,true);
  assert.equal(host.output(result.terminalId).terminal.status,"waiting_approval");
  assert.equal(host.output(result.terminalId).terminal.requiresReview,true);
});

test("an extension-defined provider runs locally after host admission and records its usage", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(),"pi-native-provider-"));
  const entryPath = join(dir,"index.ts");
  const nativeModel = {...model,provider:"native-fixture"};
  writeFileSync(entryPath,`import {createProvider,createAssistantMessageEventStream} from '@earendil-works/pi-ai';
export default function(pi) {
  const model = ${JSON.stringify(nativeModel)};
  const run = () => { const stream = createAssistantMessageEventStream();
    const message = {role:'assistant',content:[{type:'text',text:'local provider receipt'}],api:model.api,provider:model.provider,model:model.id,usage:${JSON.stringify(usage)},stopReason:'stop',timestamp:Date.now()};
    stream.push({type:'done',reason:'stop',message});stream.end(message);return stream;
  };
  pi.registerProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'Fixture',resolve:async()=>({auth:{}})}},api:{stream:run,streamSimple:run}}));
  pi.on('session_start',async(_,ctx)=>{const selected=ctx.modelRegistry.find(model.provider,model.id);if(!selected || !await pi.setModel(selected))throw new Error('Native provider unavailable');});
}`);
  const opts = options(dir);
  const ledger: any[] = [];
  opts.streamModel = async () => {throw new Error("Host model must not run");};
  opts.nativeModels = {beforeCall: (metadata: any,id: string) => {ledger.push({type:"admit",metadata,id});},recordUsage:(metadata: any,raw: any,id: string)=>{ledger.push({type:"usage",metadata,raw,id});}};
  const host = new PiExtensionTerminalHost();
  const result = await host.run({sessionId:"provider",runId:"provider",callId:"provider",prompt:"Use local provider",extensions:[extension(entryPath)],options:opts});
  assert.equal(result.text,"local provider receipt");
  assert.deepEqual(ledger.map(item=>item.type),["admit","usage"]);
  assert.equal(ledger[0].metadata.provider,"native-fixture");
  assert.equal(ledger[0].id,ledger[1].id);
  assert.equal(ledger[1].raw.totalTokens,2);
});

test("native UI fails promptly without a connected terminal client", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-no-viewer-"));
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `export default function(pi) { pi.on('session_start', async(_,ctx) => { await ctx.ui.confirm('Continue?', 'Needs a human'); }); }`);
  const host = new PiExtensionTerminalHost();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await assert.rejects(host.run({ sessionId: "no-viewer", runId: "run", callId: "call", prompt: "go", extensions: [extension(entryPath)], options: options(dir), signal: controller.signal }), /connected Desktop terminal/);
  } finally { clearTimeout(timeout); }
});

test("native host registers other configured chat models for extension model switching", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-model-switch-"));
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `export default function(pi) { pi.on('session_start', async(_,ctx) => {
    const other = ctx.modelRegistry.getAll().find(m => m.provider === 'fixture' && m.id === 'other');
    if (!other) throw new Error('Missing configured model');
    await pi.setModel(other);
  }); }`);
  const opts = options(dir);
  opts.runtime = () => ({ cwd: dir, model, availableModels: [model, {...model,id:"other",name:"Other"}], scopedModels: [], models: {chat:[],classifier:[],image:[],providerAuth:{}}, session: {cwd:dir,entries:[]} });
  const originalStream = opts.streamModel;
  let selected = "";
  opts.streamModel = async (input: any, emit: any) => { selected = input.model.id; return originalStream(input, emit); };
  await new PiExtensionTerminalHost().run({sessionId:"model-switch",runId:"run",callId:"call",prompt:"go",extensions:[extension(entryPath)],options:opts});
  assert.equal(selected, "other");
});

test("permanent purge removes native contexts and cached terminals, but refuses active writers", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-purge-"));
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `export default function(pi) { pi.registerCommand('done', {handler:async()=>{}}); }`);
  const host = new PiExtensionTerminalHost();
  const result = await host.run({sessionId:"purge",runId:"run",callId:"call",prompt:"/done",extensions:[extension(entryPath)],options:options(dir)});
  const { createHash } = await import("node:crypto");
  const { existsSync } = await import("node:fs");
  const root = join(process.env.DATA_DIR!, "pi-native", createHash("sha256").update("purge").digest("hex"));
  host.purgeSession("purge");
  assert.equal(existsSync(root), false);
  assert.equal(host.list().some(item=>item.id===result.terminalId), false);
  assert.throws(()=>host.output(result.terminalId), /not found/);
  host.purgeSession("purge");
});

test("native UI stops on client disconnection or a human response deadline", { timeout: 20_000 }, async () => {
  for (const disconnected of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "pi-native-interaction-deadline-"));
    const entryPath = join(dir, "index.ts");
    writeFileSync(entryPath, `export default function(pi) { pi.on('session_start',async(_,ctx)=>{ await ctx.ui.custom(()=>({render:()=>['Deadline fixture ready'],handleInput(){}})); }); }`);
    let now = 0;
    const host = new PiExtensionTerminalHost({now:()=>now,clientLeaseMs:100,interactionTimeoutMs:50});
    host.heartbeat();
    let shown!: () => void;
    const ready = new Promise<void>(resolve=>{shown=resolve;});
    const unsubscribe = host.subscribe(id=>{if(host.output(id).output.includes("Deadline fixture ready")) shown();});
    const pending = host.run({sessionId:`deadline-${disconnected}`,runId:"run",callId:"call",prompt:"go",extensions:[extension(entryPath)],options:options(dir)});
    const rejected = assert.rejects(pending, disconnected ? /connected Desktop terminal/ : /timed out waiting for a human response/);
    await ready;
    now = 150;
    if (!disconnected) host.heartbeat();
    await rejected;
    unsubscribe();
    assert.equal(host.list().find(item=>item.sessionId===`deadline-${disconnected}`)?.requiresReview,true);
  }
});

test("native environment inherits home, network and regional settings without provider secrets", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-env-"));
  const entryPath = join(dir, "index.ts");
  const receipt = join(dir,"env.json");
  writeFileSync(entryPath, `import {writeFileSync} from 'node:fs'; export default function(pi) { pi.registerCommand('env',{handler:async()=>{writeFileSync(${JSON.stringify(receipt)},JSON.stringify({home:process.env.HOME,proxy:process.env.HTTPS_PROXY,tz:process.env.TZ,secret:process.env.MOLIBOT_FIXTURE_SECRET}));}}); }`);
  const keys = ["HTTPS_PROXY","TZ","MOLIBOT_FIXTURE_SECRET"];
  const previous = keys.map(key=>process.env[key]);
  process.env.HTTPS_PROXY="http://127.0.0.1:9";
  process.env.TZ="Asia/Shanghai";
  process.env.MOLIBOT_FIXTURE_SECRET="fixture-do-not-inherit";
  try {
    await new PiExtensionTerminalHost().run({sessionId:"env",runId:"run",callId:"call",prompt:"/env",extensions:[extension(entryPath)],options:options(dir)});
    assert.deepEqual(JSON.parse(readFileSync(receipt,"utf8")),{home:process.env.HOME,proxy:process.env.HTTPS_PROXY,tz:"Asia/Shanghai"});
  } finally {keys.forEach((key,i)=>{if(previous[i]===undefined) delete process.env[key];else process.env[key]=previous[i];});}
});

test("model errors retain effects review and are reported as failures after restart", { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-model-failure-"));
  const entryPath=join(dir,"index.ts");
  writeFileSync(entryPath,`export default function(pi){pi.on('session_start',()=>{});}`);
  const opts=options(dir);
  opts.streamModel=async()=>{throw new Error("Fixture model failed");};
  const host=new PiExtensionTerminalHost();
  await assert.rejects(host.run({sessionId:"model-failure",runId:"run",callId:"call",prompt:"go",extensions:[extension(entryPath)],options:opts}),/Fixture model failed/);
  assert.equal(host.list().find(item=>item.sessionId==="model-failure")?.requiresReview,true);
  const recovered=new PiExtensionTerminalHost();
  const failed=recovered.list().find(item=>item.sessionId==="model-failure")!;
  assert.match(failed.error!,/task failed/);
  recovered.review(failed.id);
});

test("native terminal ! commands execute through the controlled host shell", { timeout: 15_000 }, async () => {
  const dir=mkdtempSync(join(tmpdir(),"pi-native-shell-"));
  const entryPath=join(dir,"index.ts");
  const receipt=join(dir,"shell-done");
  writeFileSync(entryPath,`import {watch,existsSync} from 'node:fs'; export default function(pi) {
    pi.registerCommand('hold',{handler:async(_,ctx)=>{await new Promise(resolve=>{
      const watcher=watch(${JSON.stringify(dir)},()=>{if(existsSync(${JSON.stringify(receipt)})){watcher.close();resolve();}});
      ctx.ui.notify('Shell input fixture ready');
    });}});
  }`);
  const host=new PiExtensionTerminalHost();
  const opts=options(dir);
  let toolCalls=0;
  opts.streamModel=async()=>{throw new Error("Shell command must not invoke a model");};
  opts.toolCatalog=()=>[{name:"bash",label:"Bash",description:"Controlled shell",parameters:{type:"object",properties:{command:{type:"string"}}}}];
  opts.executeTool=async(name:string,args:any)=>{
    toolCalls++;
    assert.equal(name,"bash");
    assert.equal(args.command,"fixture command");
    writeFileSync(receipt,"executed");
    return {isError:false,result:{content:[{type:"text",text:"controlled shell result"}],details:{exitCode:0}}};
  };
  let sent=false;
  const unsubscribe=host.subscribe(id=>{
    if(!sent&&host.output(id).output.includes("Shell input fixture ready")) {
      sent=true;
      void host.input(id,"!fixture command\r");
    }
  });
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8_000);
  try {
    await host.run({sessionId:"shell",runId:"run",callId:"call",prompt:"/hold",extensions:[extension(entryPath)],options:opts,signal:controller.signal});
    assert.equal(toolCalls,1);
    assert.equal(readFileSync(receipt,"utf8"),"executed");
  } finally {clearTimeout(timeout);unsubscribe();}
});


test("native initialization owns the session before the asynchronous snapshot returns", async () => {
  const host=new PiExtensionTerminalHost();
  let release!:()=>void;
  const preparing=new Promise<void>(resolve=>{release=resolve;});
  const controller=new AbortController();
  const opts=options("/fixture");
  const snapshot=opts.runtime;
  opts.runtime=async()=>{await preparing;return snapshot();};
  const input={sessionId:"initializing",runId:"run",callId:"call",prompt:"go",extensions:[],options:opts,signal:controller.signal};
  const pending=host.run(input);
  const rejected=assert.rejects(pending,/cancel initialization/);
  assert.throws(()=>host.purgeSession("initializing"),/Stop the active native/);
  await assert.rejects(host.run(input),/already owns an active/);
  controller.abort(new Error("cancel initialization"));
  release();
  await rejected;
  host.purgeSession("initializing");
});

test("native tool approval selector accepts a structured human reply while tool execution is pending", { timeout: 15_000 }, async () => {
  const dir=mkdtempSync(join(tmpdir(),"pi-native-selector-"));
  const entryPath=join(dir,"index.ts");
  const receipt=join(dir,"choice.json");
  writeFileSync(entryPath,`import {writeFileSync} from 'node:fs'; export default function(pi) {
    pi.registerTool({name:'fixture_approval',label:'Fixture approval',description:'Simulated application approval',parameters:{type:'object',properties:{}},
      execute:async(id,args,signal,onUpdate,ctx)=>{
        const choice=await ctx.ui.select('Allow fixture access?', ['Allow once','Allow for this session','Always allow','Decline']);
        writeFileSync(${JSON.stringify(receipt)},JSON.stringify(choice));
        return {content:[{type:'text',text:String(choice)}],details:{}};
      }});
  }`);
  const host=new PiExtensionTerminalHost();
  host.heartbeat();
  const heartbeat=setInterval(()=>host.heartbeat(),1_000);
  const opts=options(dir);
  const base=opts.streamModel;
  let calls=0;
  opts.streamModel=async(input:any,emit:any)=>{
    if(calls++>0)return base(input,emit);
    const message={role:'assistant',provider:model.provider,model:model.id,api:model.api,usage,timestamp:Date.now(),stopReason:'toolUse',content:[{type:'toolCall',id:'approval',name:'fixture_approval',arguments:{}}]};
    emit({type:'done',reason:'toolUse',message});return {message};
  };
  let sent=false;
  const unsubscribe=host.subscribe(id=>{const dialog=host.output(id).terminal.dialog;if(!sent&&dialog?.title==='Allow fixture access?'){sent=true;host.respond(id,dialog.id,'Allow for this session');}});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8_000);
  try {
    await host.run({sessionId:'selector',runId:'run',callId:'call',prompt:'Use fixture approval',extensions:[extension(entryPath)],options:opts,signal:controller.signal});
    assert.equal(JSON.parse(readFileSync(receipt,'utf8')),'Allow for this session');
  } finally {clearInterval(heartbeat);clearTimeout(timeout);unsubscribe();}
});

test("native cancellation waits for extension shutdown before killing the process", { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-shutdown-"));
  const entryPath = join(dir, "index.ts");
  const receipt = join(dir, "closed.txt");
  writeFileSync(entryPath, `import {writeFileSync} from 'node:fs'; export default function(pi) {
    pi.on('session_shutdown', async () => {await new Promise(resolve=>setTimeout(resolve,600)); writeFileSync(${JSON.stringify(receipt)},'closed');});
    pi.registerCommand('hold',{handler:async(args,ctx)=>{ctx.ui.notify('Shutdown fixture ready'); await new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true}));}});
  }`);
  const host = new PiExtensionTerminalHost();
  const controller = new AbortController();
  const unsubscribe = host.subscribe(id => {if(host.output(id).output.includes('Shutdown fixture ready')) controller.abort(new Error('Fixture stop'));});
  try {
    await assert.rejects(host.run({ sessionId: 'slow-shutdown', runId: 'run', callId: 'call', prompt: '/hold', extensions: [extension(entryPath)], options: options(dir), signal: controller.signal }), /aborted|Fixture stop/);
    assert.equal(readFileSync(receipt, 'utf8'), 'closed');
    assert.equal(host.list()[0].cleanupStatus,'hooks_completed');
    assert.equal(host.list()[0].sharingStatus,'unverified');
  } finally {unsubscribe();}
});

test("native shutdown errors cannot be reported as successful completion", { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-shutdown-error-"));
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, `export default function(pi) {pi.on('session_shutdown', async()=>{throw new Error('Fixture cleanup failed');});}`);
  const host = new PiExtensionTerminalHost();
  await assert.rejects(host.run({sessionId:'shutdown-error',runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:options(dir)}), /Fixture cleanup failed/);
  assert.equal(host.list()[0].status,'failed');
  assert.equal(host.list()[0].cleanupStatus,'unknown');
  assert.equal(host.list()[0].requiresReview,true);
});

test("native selection uses a structured human reply bound to the pending dialog", { timeout: 10_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-chat-dialog-"));
  const entryPath = join(dir, "index.ts");
  const receipt = join(dir, "choice.txt");
  writeFileSync(entryPath, `import {writeFileSync} from 'node:fs';export default function(pi){pi.on('session_start',async(_,ctx)=>{const result=await ctx.ui.select('Allow fixture?', ['Allow once','Decline']);writeFileSync(${JSON.stringify(receipt)},String(result));});}`);
  const host = new PiExtensionTerminalHost();
  host.heartbeat();
  const controller = new AbortController();
  let replied = false;
  const unsubscribe = host.subscribe(id => {
    const summary = host.output(id).terminal;
    const dialog = (summary as any).dialog;
    if (!dialog || replied) return;
    replied = true;
    assert.equal(dialog.kind, 'select');
    assert.throws(()=>(host as any).respond(id,'stale','Allow once'),/pending|expired/);
    assert.throws(()=>(host as any).respond(id,dialog.id,'Forged option'),/option/);
    (host as any).respond(id,dialog.id,'Allow once');
    assert.throws(()=>(host as any).respond(id,dialog.id,'Decline'),/pending|expired/);
  });
  const timeout = setTimeout(()=>controller.abort(new Error('Structured dialog missing')),2_000);
  try {
    await host.run({sessionId:'structured-dialog',runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:options(dir),signal:controller.signal});
    assert.equal(replied,true);
    assert.equal(readFileSync(receipt,'utf8'),'Allow once');
  } finally {clearTimeout(timeout);unsubscribe();}
});

test("native confirmation, input, editor, timeout and cancellation preserve Pi return values", {timeout:10_000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pi-dialog-values-'));
  const entryPath=join(dir,'index.ts');
  const receipt=join(dir,'values.json');
  writeFileSync(entryPath,`import {writeFileSync} from 'node:fs';export default function(pi){pi.on('session_start',async(_,ctx)=>{
    const confirm=await ctx.ui.confirm('Confirm fixture','Details');
    const input=await ctx.ui.input('Input fixture','Placeholder');
    const editor=await ctx.ui.editor('Editor fixture','Initial');
    const cancelled=await ctx.ui.select('Cancel fixture',['Allow','Decline']);
    const timeout=await ctx.ui.select('Timeout fixture',['Allow','Decline'],{timeout:20});
    writeFileSync(${JSON.stringify(receipt)},JSON.stringify({confirm,input,editor,cancelled:cancelled===undefined,timeout:timeout===undefined}));
  });}`);
  const host=new PiExtensionTerminalHost();host.heartbeat();
  const unsubscribe=host.subscribe(id=>{
    const dialog=host.output(id).terminal.dialog;
    if(!dialog || dialog.title==='Timeout fixture')return;
    if(dialog.kind==='confirm'){assert.equal(dialog.message,'Details');assert.throws(()=>host.respond(id,dialog.id,'true'),/boolean/);host.respond(id,dialog.id,false);}
    else if(dialog.kind==='input'){assert.equal(dialog.placeholder,'Placeholder');host.respond(id,dialog.id,'');}
    else if(dialog.kind==='editor'){assert.equal(dialog.initialValue,'Initial');host.respond(id,dialog.id,'edited\ntext');}
    else host.respond(id,dialog.id,null);
  });
  try {
    await host.run({sessionId:'dialog-values',runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:options(dir)});
    assert.deepEqual(JSON.parse(readFileSync(receipt,'utf8')),{confirm:false,input:'',editor:'edited\ntext',cancelled:true,timeout:true});
    assert.equal(host.list()[0].dialog,undefined);
  } finally {unsubscribe();}
});

test("stopping a pending Pi dialog clears it and rejects late human replies", {timeout:10_000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pi-dialog-stop-'));
  const entryPath=join(dir,'index.ts');
  writeFileSync(entryPath,`export default function(pi){pi.on('session_start',async(_,ctx)=>{await ctx.ui.confirm('Stop fixture','Pending');});pi.on('session_shutdown',async()=>{await new Promise(resolve=>setTimeout(resolve,300));});}`);
  const host=new PiExtensionTerminalHost();host.heartbeat();
  let stopped=false;
  const unsubscribe=host.subscribe(id=>{
    const dialog=host.output(id).terminal.dialog;
    if(!dialog||stopped)return;
    stopped=true;host.stop(id);
    assert.equal(host.output(id).terminal.dialog,undefined);
    assert.throws(()=>host.respond(id,dialog.id,true),/pending|expired/);
  });
  try {
    await assert.rejects(host.run({sessionId:'dialog-stop',runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:options(dir)}),/Stopped from the native Pi terminal/);
    assert.equal(stopped,true);
    assert.equal(host.list()[0].requiresReview,true);
  } finally {unsubscribe();}
});

test("cleanup killed after the grace period remains unknown rather than claiming sharing stopped", {timeout:25_000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pi-cleanup-unknown-'));
  const entryPath=join(dir,'index.ts');
  writeFileSync(entryPath,`export default function(pi){pi.on('session_start',async(_,ctx)=>{await ctx.ui.confirm('Grace fixture','Pending');});pi.on('session_shutdown',async()=>{await new Promise(resolve=>setTimeout(resolve,60_000));});}`);
  const host=new PiExtensionTerminalHost();host.heartbeat();
  let stopped=false, cleaning=false;
  const unsubscribe=host.subscribe(id=>{
    const terminal=host.output(id).terminal;
    if(terminal.cleanupStatus==='running')cleaning=true;
    if(!stopped&&terminal.dialog){stopped=true;host.stop(id);}
  });
  try {
    await assert.rejects(host.run({sessionId:'unknown-cleanup',runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:options(dir)}),/Stopped from the native Pi terminal/);
    assert.equal(cleaning,true);
    assert.equal(host.list()[0].cleanupStatus,'unknown');
    assert.equal(host.list()[0].sharingStatus,'unverified');
    assert.equal(host.list()[0].requiresReview,true);
  } finally {unsubscribe();}
});

test("the terminal HTTP route resolves only the current structured dialog", {timeout:10_000}, async()=>{
  const {piExtensionTerminalHost:host}=await import('./nativeTerminal.js');
  const {GET,POST}=await import('../../../../routes/api/settings/plugins/extensions/terminal/+server.js');
  const dir=mkdtempSync(join(tmpdir(),'pi-dialog-http-'));
  const entryPath=join(dir,'index.ts');
  const receipt=join(dir,'reply.txt');
  writeFileSync(entryPath,`import {writeFileSync} from 'node:fs';export default function(pi){pi.on('session_start',async(_,ctx)=>{const choice=await ctx.ui.select('HTTP fixture',['Allow once','Decline']);writeFileSync(${JSON.stringify(receipt)},String(choice));});}`);
  const routeUrl=new URL('http://127.0.0.1/api/settings/plugins/extensions/terminal?client=desktop');
  await GET({url:routeUrl} as any);
  let ready!:(value:{id:string;dialogId:string})=>void;
  const awaitingDialog=new Promise<{id:string;dialogId:string}>(resolve=>{ready=resolve;});
  const unsubscribe=host.subscribe(id=>{const dialog=host.output(id).terminal.dialog;if(dialog)ready({id,dialogId:dialog.id});});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new Error('HTTP fixture timeout')),5_000);
  const pending=host.run({sessionId:'dialog-http',runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:options(dir),signal:controller.signal});
  try {
    const request=await awaitingDialog;
    const list=await (await GET({url:routeUrl} as any)).json();
    assert.equal(list.terminals.find((item:any)=>item.id===request.id).dialog.id,request.dialogId);
    const respond=(value:string)=>POST({request:new Request(routeUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request,action:'respond',value})})} as any);
    assert.equal((await respond('forged option')).status,400);
    assert.equal((await respond('Allow once')).status,200);
    await pending;
    assert.equal(readFileSync(receipt,'utf8'),'Allow once');
    assert.equal((await respond('Decline')).status,400);
  } finally {clearTimeout(timeout);controller.abort();await pending.catch(()=>{});unsubscribe();}
});

for (const scenario of ['success','cancel','retry']) test(`LCU auto-stop ${scenario} uses only the owned cleanup connection`, {timeout:15_000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pi-lcu-auto-stop-'));
  const entryPath=join(dir,'index.ts'),receipt=join(dir,'effects.json'),allow=join(dir,'allow-stop');
  const helper=join(process.cwd(),'scripts','runtime','lcu-auto-stop.mjs');
  writeFileSync(entryPath,`import {writeFileSync,existsSync} from 'node:fs';import {withLcuAutoStop} from ${JSON.stringify(helper)};
  export default function(pi){let apps=['owned.app'];const calls=[];const save=()=>writeFileSync(${JSON.stringify(receipt)},JSON.stringify(calls));
    const client=withLcuAutoStop({hasHostControl:true,
      controlStatus:async turn=>{calls.push(['status',turn]);save();return {computerUse:{activeApplications:apps.map(bundleIdentifier=>({bundleIdentifier}))}};},
      controlStop:async turn=>{calls.push(['stop',turn]);save();if(${JSON.stringify(scenario)}==='retry'&&!existsSync(${JSON.stringify(allow)}))throw new Error('Fixture stop unavailable');apps=[];return {accepted:true,applicationId:turn.app};},
      turnEnded:async turn=>{calls.push(['end',turn]);save();},close:async()=>{calls.push(['close']);save();}
    },{deadlineMs:200,pollMs:1});const turn={sessionId:'owned-session',turnId:'owned-turn',event:'Stop'};
    pi.on('agent_end',async(_,ctx)=>{try{await client.turnEnded(turn);}catch(error){ctx.ui.notify(error.message,'warning');}});
    pi.on('session_shutdown',async()=>{try{await client.turnEnded(turn);}finally{await client.close();}});
    ${scenario==='cancel' ? "pi.on('session_start',async(_,ctx)=>{await ctx.ui.confirm('Cancel LCU fixture','Pending');});" : ''}
  }`);
  const host=scenario==='retry'?(await import('./nativeTerminal.js')).piExtensionTerminalHost:new PiExtensionTerminalHost();host.heartbeat();let id='';let modelCalls=0;
  const opts=options(dir),base=opts.streamModel;opts.streamModel=async(...args:any[])=>{modelCalls++;return base(...args);};
  const unsubscribe=host.subscribe(current=>{if(scenario==='cancel'&&host.output(current).terminal.dialog)host.stop(current);});
  try {
    const running=host.run({sessionId:`lcu-${scenario}`,runId:'run',callId:'call',prompt:'go',extensions:[extension(entryPath)],options:opts,onStarted:terminal=>{id=terminal.id;}});
    if(scenario==='success')await running;else await assert.rejects(running,scenario==='cancel'?/Stopped from/:/cleanup failed/);
    if(scenario==='retry'){
      assert.equal(host.output(id).terminal.sharingStatus,'unknown');assert.equal(host.output(id).terminal.sharingRetryable,true);
      assert.throws(()=>host.review(id),/Retry stopping/);assert.throws(()=>host.purgeSession(`lcu-${scenario}`),/Stop the active/);
      await assert.rejects(host.run({sessionId:`lcu-${scenario}`,runId:'next',callId:'next',prompt:'go',extensions:[extension(entryPath)],options:opts}),/already owns/);
      writeFileSync(allow,'allowed');
      const {POST}=await import('../../../../routes/api/settings/plugins/extensions/terminal/+server.js');
      const response=POST({request:new Request('http://127.0.0.1/api/settings/plugins/extensions/terminal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'retrySharing',id})})} as any);
      const [http]=await Promise.all([response,host.retrySharing(id)]);assert.equal(http.status,200);
    }
    assert.equal(host.output(id).terminal.sharingStatus,'released');assert.equal(host.output(id).terminal.sharingRetryable,false);
    const calls=JSON.parse(readFileSync(receipt,'utf8'));
    assert.deepEqual(calls.filter((call:any)=>call[0]==='stop').map((call:any)=>call[1]),Array(scenario==='retry'?3:1).fill({sessionId:'owned-session',turnId:'owned-turn',app:'owned.app'}));
    assert.equal(calls.filter((call:any)=>call[0]==='end').length,1);assert.equal(calls.at(-1)[0],'close');
    assert.equal(modelCalls,scenario==='cancel'?0:1);
  } finally {unsubscribe();}
});
