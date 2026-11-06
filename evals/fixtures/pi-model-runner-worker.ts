import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PhotonImage } from '@silvia-odwyer/photon-node';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { getPiModels } from '../../src/lib/server/providers/piRuntime.js';
import { defaultRuntimeSettings } from '../../src/lib/server/settings/defaults.js';
import { MomRunner } from '../../src/lib/server/agent/core/runner.js';
import { MomRuntimeStore } from '../../src/lib/server/agent/session/store.js';
import { getTurnOrchestrator } from '../../src/lib/server/agent/core/turnOrchestrator.js';
import { inspectPiRecovery, pendingPiRecovery } from '../../src/lib/server/app/piRecovery.js';

const directory = process.env.DATA_DIR!;
const mode = process.env.PI_MODEL_FIXTURE_MODE ?? 'codemode';
const fixtureImage = new PhotonImage(new Uint8Array(mode === 'native_blank' ? Array(16).fill(255) : [255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255]),2,2);
const fixtureFrames = Array.from({length:12},(_,index)=>{const frame=new PhotonImage(new Uint8Array([index,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255]),2,2);try{return Buffer.from(frame.get_bytes()).toString('base64');}finally{frame.free();}});
const fixtureImageData = Buffer.from(fixtureImage.get_bytes()).toString('base64'); fixtureImage.free();
const keepAlive = setInterval(() => {}, 1000);
const workspace = join(directory, 'sessions', 'fixture');
mkdirSync(join(workspace, 'chat'), { recursive: true });
const settings = { ...defaultRuntimeSettings, permissionMode: (mode.startsWith('manual') ? 'manual' : mode === 'plan' ? 'plan' : 'auto') as 'auto' | 'manual' | 'plan', providerMode: 'custom' as const, defaultCustomProviderId: 'fixture',
  modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: 'custom|fixture|fixture' },
  customProviders: [{ id: 'fixture', name: 'Fixture', enabled: true, protocol: 'openai-compatible' as const,
    baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key', path: '/chat/completions', defaultModel: 'fixture',
    models: [{ id: 'fixture', enabled: true, tags: ['text'], supportedRoles: ['system', 'user', 'assistant', 'tool'] }] }] };
settings.plugins = { ...settings.plugins, piExtensions: { ...settings.plugins.piExtensions, mode: mode.startsWith('native_') ? 'native' : 'server' } };
if (mode === 'compact') settings.compaction = { ...settings.compaction, keepRecentTokens: 20 };
const events: unknown[] = [];
const receipts: any[] = [];
const extensionDir = join(directory, 'extensions', 'fixture');
mkdirSync(extensionDir, { recursive: true });
writeFileSync(join(extensionDir, 'index.ts'), `import { Type } from "@sinclair/typebox";
export default function(pi: any) { pi.registerCommand("fixture_command", { description: "Read owned context and use shared operations", async handler(_args: string, ctx: any) {
 if (!ctx.sessionManager.getSessionId() || !ctx.model || ctx.signal.aborted) throw new Error("Missing command context");
 const model = ctx.modelRegistry.getModelsOfType("classifier").find((m: any) => m.provider === "fixture");
 const result = await ctx.modelRegistry.classify(model, { state: {}, questions: { flag: { type: "bool", instructions: "yes?", criteria: { true: "yes", false: "no" } } } });
 if (result.stopReason !== "stop") throw new Error(result.errorMessage);
 const read = await ctx.executeTool("read", { path: "input.txt" }); if (read.isError) throw new Error(JSON.stringify(read));
 ctx.ui.notify("Command verified");
} }); pi.registerTool({ name: "stream_fixture", label: "Stream fixture", description: "Call a shared chat model", parameters: Type.Object({}), async execute(_id: string, _args: any, _signal: AbortSignal, _update: any, ctx: any) {
 if (${JSON.stringify(mode)} === "stream_cancel") {
   const controller = new AbortController();
   const stream = ctx.modelRegistry.stream(ctx.model, { messages: [{ role: "user", content: "cancel me", timestamp: 1 }] }, { signal: controller.signal });
   try { for await (const event of stream) { controller.abort(new Error("Fixture cancellation")); } await stream.result(); }
   catch (error) { return { content: [{ type: "text", text: "Cancellation verified" }], details: {} }; }
   throw new Error("Cancellation did not fail the stream");
 }
 if (${JSON.stringify(mode)} === "compact") { ctx.compact({ customInstructions: "Keep fixture facts" }); return { content: [{ type: "text", text: "Compaction requested" }], details: {} }; }
 const result = await ctx.modelRegistry.complete(ctx.model, { systemPrompt: "fixture", messages: [{ role: "user", content: "hello", timestamp: 1 }] });
 if (result.stopReason !== "stop") throw new Error(JSON.stringify(result));
 return { content: result.content, details: { usage: result.usage } };
} }); pi.registerTool({ name: "model_fixture", label: "Fixture", description: "Read context, use shared model work and a nested read", parameters: Type.Object({}), async execute(_id: string, _args: any, _signal: AbortSignal, _update: any, ctx: any) {
 const entries = ctx.sessionManager.getEntries();
 if (entries instanceof Promise) throw new Error("Session reads must be synchronous");
 if (!ctx.sessionManager.getSessionId() || !ctx.model || ctx.signal.aborted) throw new Error("Wrong execution context");
 const classifier = ctx.modelRegistry.getModelsOfType("classifier").find((m: any) => m.provider === "fixture");
 const result = await ctx.modelRegistry.classify(classifier, { state: {}, questions: { flag: { type: "bool", instructions: "yes?", criteria: { true: "yes", false: "no" } } } });
 const read = await ctx.executeTool("read", { path: "input.txt" });
 if (read.isError) throw new Error(JSON.stringify(read));
 return { content: [{ type: "text", text: "Extension verified" }], details: { result, entries: entries.length } };
} }); }`);
let customServer: import('node:http').Server | undefined;
const nativeChoicePath = join(directory, 'native-choice.txt');
const { piExtensionTerminalHost } = await import('../../src/lib/server/plugins/piExtensions/nativeTerminal.js');
if (mode.startsWith('native_')) {
  process.env.HOME = join(directory, 'native-home');
  mkdirSync(process.env.HOME, { recursive: true });
  writeFileSync(join(extensionDir, 'index.ts'), `import {writeFileSync} from 'node:fs';
export default function(pi) {pi.registerTool({name:'native_capture',label:'Capture',description:'Simulated window capture',parameters:{type:'object',properties:{index:{type:'number'}}},execute:async(_id,args)=>({content:[{type:'image',mimeType:'image/png',data:['native_many_images','native_observe'].includes(${JSON.stringify(mode)}) ? ${JSON.stringify(fixtureFrames)}[args.index??0] : ${JSON.stringify(fixtureImageData)}}],details:{}})}); pi.registerCommand('native_command',{handler:async(args)=>{writeFileSync(${JSON.stringify(nativeChoicePath)},'command:'+args);}}); pi.on('session_start', async (_,ctx) => {
  const value = await ctx.ui.custom((tui,theme,keys,done) => ({render(){return ['Native runner choice'];},handleInput(data){if(data === '\\r')done('accepted');}}));
  writeFileSync(${JSON.stringify(nativeChoicePath)},value);
  ${mode === 'native_custom' ? "const other=ctx.modelRegistry.find('fixture-custom','alt'); if(!other) throw new Error('Missing custom model'); await pi.setModel(other);" : ''}
});}`);
  piExtensionTerminalHost.heartbeat();
  const heartbeat = setInterval(() => piExtensionTerminalHost.heartbeat(), 1500);
  heartbeat.unref();
  const answered = new Set<string>();
  piExtensionTerminalHost.subscribe(id => {
    if (!answered.has(id) && piExtensionTerminalHost.output(id).output.includes('Native runner choice')) {
      answered.add(id);
      void piExtensionTerminalHost.input(id, '\r');
    }
  });
}
if (mode === 'native_custom') {
  const { createServer } = await import('node:http');
  customServer = createServer((request, response) => {
    request.resume();
    if (request.headers.authorization !== 'Bearer fixture-key') { response.writeHead(401); response.end(); return; }
    ledger.push('custom');
    response.writeHead(200, {'content-type':'text/event-stream'});
    response.write(`data: ${JSON.stringify({id:'custom-fixture',object:'chat.completion.chunk',created:1,model:'alt',choices:[{index:0,delta:{role:'assistant',content:'Custom fixture'},finish_reason:null}]})}\n\n`);
    response.write(`data: ${JSON.stringify({id:'custom-fixture',object:'chat.completion.chunk',created:1,model:'alt',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}})}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>customServer!.listen(0,'127.0.0.1',resolve));
  const address=customServer.address() as import('node:net').AddressInfo;
  settings.customProviders.push({...settings.customProviders[0],id:'fixture-custom',baseUrl:`http://127.0.0.1:${address.port}/v1`,defaultModel:'alt',models:[{...settings.customProviders[0].models[0],id:'alt'}]});
}
const scratch = new MomRuntimeStore(workspace).getScratchDir('chat');
mkdirSync(scratch, { recursive: true });
writeFileSync(join(scratch, 'input.txt'), 'owned input');
const runnerStore = new MomRuntimeStore(workspace);
const runner = new MomRunner('web', 'chat', 'session', runnerStore, () => settings, () => settings,
  { record: (receipt: any) => receipts.push(receipt) } as any, { record: () => {} } as any,
  { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: 'fixture', items: [] }),
    createPromptSnapshot: async () => ({ createdAt: new Date().toISOString(), fingerprint: 'fixture', query: '', promptText: '', selected: [], longTerm: [], daily: [] }) } as any,
  { emit: (stage: string, _ctx: unknown, payload: unknown) => events.push({ stage, payload }), flush: async () => {},
    transform: async (_stage: unknown, _ctx: unknown, value: unknown) => value, gate: async () => ({ type: 'allow' }) } as any);
const agent = (runner as any).agent;
if (mode === 'compact') agent.state.messages = [{ role: 'user', content: 'Earlier fixture facts. '.repeat(100), timestamp: 1 }, { role: 'assistant', content: [{ type: 'text', text: 'Remember the fixture facts.' }], provider: 'fixture', model: 'fixture', api: 'openai-completions', timestamp: 2, stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }];
if (mode === 'compact') for (const message of agent.state.messages) runnerStore.appendContextMessage('chat', message, 'session');
const model = agent.state.model;
const usage = { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const classifier = { type: 'classifier', provider: model.provider, id: 'cls', name: 'Fixture classifier', api: 'fixture', baseUrl: '', contextWindow: 4096 };
const image = { type: 'image', provider: model.provider, id: 'img', name: 'Fixture image', api: 'fixture', baseUrl: '', input: ['text', 'image'], output: ['image'] };
const ledger: string[] = [];
let nativeModelCalls = 0;
const chatStream = (_model: unknown, _context: unknown, options: any) => {
 ledger.push('stream');
 if (mode === 'native_failure') throw new Error('Fixture native model failed');
 const stream = createAssistantMessageEventStream();
 if (mode === 'stream_cancel') {
   const partial: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [], stopReason: 'aborted', usage };
   stream.push({ type: 'start', partial });
   options.signal.addEventListener('abort', () => { ledger.push('cancelled'); stream.push({ type: 'error', reason: 'aborted', error: partial }); stream.end(); }, { once: true });
   return stream;
 }
 const step = nativeModelCalls++;
 const capture = ['native_image','native_blank'].includes(mode) ? step === 0 : ['native_many_images','native_observe'].includes(mode) && step < 10;
 const selectImage = ['native_image','native_blank'].includes(mode) ? step === 1 : mode === 'native_many_images' && step === 10;
 const ids = [...new Set(JSON.stringify(_context).match(/pi-image-[a-f0-9]{64}/g) ?? [])];
 const answer: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: capture ? [{type:'toolCall',id:`capture-${step}`,name:'native_capture',arguments:{index:step}}] : selectImage ? [{type:'toolCall',id:'delivery',name:'molibot_deliver_images',arguments:{ids:ids.slice(-1),purpose:'screenshot'}}] : [{ type: 'text', text: 'Streamed fixture' }], stopReason: capture || selectImage ? 'toolUse' : mode === 'deferred' ? 'deferred' : 'stop', usage,
   ...(mode === 'deferred' ? { deferred: { provider: model.provider, modelId: model.id, api: model.api, id: 'owned-remote', pollAfterMs: 1 } } : {}) };
 stream.push({ type: 'done', reason: answer.stopReason as any, message: answer }); stream.end(); return stream;
};
const models = getPiModels();
models.setProvider({ id: model.provider, name: 'Fixture', getModels: () => [model], getAllModels: () => [model, classifier, image] as any,
 auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } },
 stream: chatStream, streamSimple: chatStream,
 fetchDeferred: (_model, handle) => { if (handle.id !== 'owned-remote') throw new Error('Wrong Deferred owner'); ledger.push('poll'); const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [{ type: 'text', text: 'Streamed fixture' }], stopReason: 'stop', usage } }); stream.end(); return stream; },
 classify: async () => { ledger.push('classify'); return { api: 'fixture', provider: model.provider, model: 'cls', answers: { flag: { type: 'bool', probability: .9 } }, usage, stopReason: 'stop', timestamp: Date.now() }; },
 generateImages: async (_model, content) => { ledger.push('images'); if (content.input.filter(x => x.type === 'image').length !== 1) throw new Error('Missing reference image');
 return { api: 'fixture', provider: model.provider, model: 'img', output: [{ type: 'text', text: 'Two fixture images' }, ...['first', 'second'].map(data => ({ type: 'image' as const, mimeType: 'image/png', data: Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"), Buffer.from(data)]).toString("base64") }))], usage, stopReason: 'stop', timestamp: Date.now() }; } });
let generations = 0;
const requestContexts: unknown[] = [];
const code = mode === "manual" ? `text(await models.classify({ provider: "fixture", id: "cls" }, { state: {}, questions: { flag: { type: "bool", instructions: "yes?", criteria: { true: "yes", false: "no" } } } }));` : `const catalog = await models.getAvailableOfType("classifier");
const classifier = catalog.find(x => x.provider === 'fixture' && x.id === 'cls');
const question = { state: {}, questions: { flag: { type: 'bool', instructions: 'yes?', criteria: { true: 'yes', false: 'no' } } } };
const results = await Promise.all([models.classify(classifier, question), models.classify(classifier, question)]);
const generated = await models.generateImages({ provider: 'fixture', id: 'img' }, { input: [{ type: 'text', text: 'two images' }, { type: 'image', mimeType: 'image/png', data: 'YQ==' }] });
for (const output of generated.output.filter(x => x.type === 'image')) image(output);
text({ answers: results, text: generated.output.filter(x => x.type === 'text').map(x => x.text).join('\\n') });`;
agent.streamFunction = (_model: unknown, requestContext: unknown) => {
 requestContexts.push({ ...(requestContext as any), exposedTools: agent.state.tools.map((tool: any) => ({ name: tool.name, parameters: tool.parameters, description: tool.description })) });
 const stream = createAssistantMessageEventStream();
 const content: any[] = generations++ === 0 ? [{ type: 'toolCall', id: 'work', name: ['native_extension','native_custom','native_failure','native_image','native_blank','native_many_images','native_observe','native_route'].includes(mode) ? 'piExtensionRun' : mode === 'extension' ? 'model_fixture' : ['stream', 'deferred', 'stream_cancel', 'manual_stream', 'compact'].includes(mode) ? 'stream_fixture' : 'codemode', arguments: ['native_extension','native_custom','native_failure','native_image','native_blank','native_many_images','native_observe','native_route'].includes(mode) ? { prompt: 'Native fixture work' } : ['extension', 'stream', 'deferred', 'stream_cancel', 'manual_stream', 'compact'].includes(mode) ? {} : { code } }] : [{ type: 'text', text: 'Fixture complete' }];
 if (mode === 'native_route') {content.length=0;content.push({type:'toolCall',id:'model-bypass',name:'bash',arguments:{label:'Unexpected bypass',command:'touch forbidden-fallback.txt'}});}
 if (mode === 'native_failure' && generations === 1) content.push({type:'toolCall',id:'forbidden-fallback',name:'bash',arguments:{label:'Forbidden fallback',command:'touch forbidden-fallback.txt'}});
 const answer: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content, stopReason: content[0].type === 'toolCall' ? 'toolUse' : 'stop', timestamp: Date.now(), usage };
 stream.push({ type: 'done', reason: answer.stopReason as any, message: answer }); stream.end(); return stream;
};
const uploaded: {path:string; data:string}[] = [];
const context = { approvalWaitTimeoutMs: 20, channel: 'web', workspaceDir: workspace, chatDir: join(workspace, 'chat'),
  message: { chatId: 'chat', sessionId: 'session', userId: 'actor', text: mode === 'native_missing' ? '@pi/missing capture' : mode === 'native_route' ? '使用 fixture 查看窗口' : 'Do the work', messageId: 1,
    ts: '1', attachments: [], imageContents: [], chatType: 'private' as const },
  respond: async () => {}, replaceMessage: async () => {}, respondInThread: async () => {},
  setWorking: async () => {}, setTyping: async () => {}, deleteMessage: async () => {}, uploadFile: async (path: string) => {uploaded.push({path,data:readFileSync(path).toString('base64')});} };
try {
 const commandOutput: string[] = [];
 const outcome = mode === "native_command" ? await runner.runExtensionCommand({ toolName: "piCommand__fixture__native_command", command: "native_command", args: "verified", respond: async text => { commandOutput.push(text); } }) : mode === "command" ? await runner.runExtensionCommand({ toolName: "piCommand__fixture__fixture_command", command: "fixture_command", args: "", respond: async text => { commandOutput.push(text); } }) : await runner.run(context);
 const { SqliteImageTaskStore } = await import('../../src/lib/server/agent/imageGenerate/imageTaskStore.js');
 const store = new SqliteImageTaskStore();
 const tasks = store.getUsageTasks().map(task => store.getTask(task.id)); store.close();
 const { DatabaseSync } = await import("node:sqlite");
 const budgetDb = new DatabaseSync(join(directory, "runtime", "run-budgets.sqlite"));
 const modelBudgetReceipts = budgetDb.prepare("SELECT source_id FROM run_budget_receipts WHERE kind = 'modelTurn' AND source_id LIKE '%:model:%'").all(); budgetDb.close();
 const messages = agent.state.messages;
 const { getApprovalBroker } = await import("../../src/lib/server/approval/approvalBroker.js");
 const approvals = getApprovalBroker().listPendingRequests();
 await new Promise<void>((resolve, reject) => process.send!({ type: 'result', runnerStillRunning: runner.isRunning(), fallbackExecuted: existsSync(join(scratch,'forbidden-fallback.txt')), uploaded, fixtureImageData: mode === 'native_many_images' ? fixtureFrames[9] : fixtureImageData, outcome, ledger, receipts, tasks, messages, events, approvals, commandOutput, generations, modelBudgetReceipts, requestContexts, nativeTerminals: piExtensionTerminalHost.list(), nativeChoice: mode.startsWith('native_') && existsSync(nativeChoicePath) ? readFileSync(nativeChoicePath, 'utf8') : undefined }, error => error ? reject(error) : resolve()));
 const { getPiExtensionHost } = await import('../../src/lib/server/plugins/piExtensions/host.js'); getPiExtensionHost().dispose();
 customServer?.closeAllConnections(); customServer?.close(); clearInterval(keepAlive); process.disconnect?.();
} catch (error) { customServer?.closeAllConnections(); customServer?.close(); clearInterval(keepAlive); process.send?.({ type: 'error', error: String(error) }); process.exitCode = 1; process.disconnect?.(); }
