import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { getPiModels } from '../../src/lib/server/providers/piRuntime.js';
import { defaultRuntimeSettings } from '../../src/lib/server/settings/defaults.js';
import { MomRunner } from '../../src/lib/server/agent/core/runner.js';
import { MomRuntimeStore } from '../../src/lib/server/agent/session/store.js';
import { getTurnOrchestrator } from '../../src/lib/server/agent/core/turnOrchestrator.js';
import { inspectPiRecovery, pendingPiRecovery } from '../../src/lib/server/app/piRecovery.js';

const directory = process.env.DATA_DIR!;
const mode = process.env.PI_MODEL_FIXTURE_MODE ?? 'codemode';
const keepAlive = setInterval(() => {}, 1000);
const workspace = join(directory, 'sessions', 'fixture');
mkdirSync(join(workspace, 'chat'), { recursive: true });
const settings = { ...defaultRuntimeSettings, permissionMode: (mode.startsWith('manual') ? 'manual' : mode === 'plan' ? 'plan' : 'auto') as 'auto' | 'manual' | 'plan', providerMode: 'custom' as const, defaultCustomProviderId: 'fixture',
  modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: 'custom|fixture|fixture' },
  customProviders: [{ id: 'fixture', name: 'Fixture', enabled: true, protocol: 'openai-compatible' as const,
    baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key', path: '/chat/completions', defaultModel: 'fixture',
    models: [{ id: 'fixture', enabled: true, tags: ['text'], supportedRoles: ['system', 'user', 'assistant', 'tool'] }] }] };
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
const chatStream = (_model: unknown, _context: unknown, options: any) => {
 ledger.push('stream');
 const stream = createAssistantMessageEventStream();
 if (mode === 'stream_cancel') {
   const partial: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [], stopReason: 'aborted', usage };
   stream.push({ type: 'start', partial });
   options.signal.addEventListener('abort', () => { ledger.push('cancelled'); stream.push({ type: 'error', reason: 'aborted', error: partial }); stream.end(); }, { once: true });
   return stream;
 }
 const answer: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [{ type: 'text', text: 'Streamed fixture' }], stopReason: mode === 'deferred' ? 'deferred' : 'stop', usage,
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
const code = mode === "manual" ? `text(await models.classify({ model: "classifier|fixture|cls", state: {}, questions: { flag: { type: "bool", instructions: "yes?", criteria: { true: "yes", false: "no" } } } }));` : `const catalog = await models.list();
const classifier = catalog.find(x => x.key === 'classifier|fixture|cls');
const question = { state: {}, questions: { flag: { type: 'bool', instructions: 'yes?', criteria: { true: 'yes', false: 'no' } } } };
const results = await Promise.all([models.classify({ ...question, model: classifier.key }), models.classify({ ...question, model: classifier.key })]);
const generated = await models.generateImages({ model: 'image|fixture|img', prompt: 'two images', images: ['data:image/png;base64,YQ=='] });
for (const output of generated.images) image(output);
text({ answers: results, text: generated.text, refs: generated.images.map(x => x.ref) });`;
agent.streamFunction = (_model: unknown, requestContext: unknown) => {
 requestContexts.push(requestContext);
 const stream = createAssistantMessageEventStream();
 const content: any[] = generations++ === 0 ? [{ type: 'toolCall', id: 'work', name: mode === 'extension' ? 'model_fixture' : ['stream', 'deferred', 'stream_cancel', 'manual_stream', 'compact'].includes(mode) ? 'stream_fixture' : 'codemode', arguments: ['extension', 'stream', 'deferred', 'stream_cancel', 'manual_stream', 'compact'].includes(mode) ? {} : { code } }] : [{ type: 'text', text: 'Fixture complete' }];
 const answer: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content, stopReason: content[0].type === 'toolCall' ? 'toolUse' : 'stop', timestamp: Date.now(), usage };
 stream.push({ type: 'done', reason: answer.stopReason as any, message: answer }); stream.end(); return stream;
};
const context = { approvalWaitTimeoutMs: 20, channel: 'web', workspaceDir: workspace, chatDir: join(workspace, 'chat'),
  message: { chatId: 'chat', sessionId: 'session', userId: 'actor', text: 'Do the work', messageId: 1,
    ts: '1', attachments: [], imageContents: [], chatType: 'private' as const },
  respond: async () => {}, replaceMessage: async () => {}, respondInThread: async () => {},
  setWorking: async () => {}, setTyping: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} };
try {
 const commandOutput: string[] = [];
 const outcome = mode === "command" ? await runner.runExtensionCommand({ toolName: "piCommand__fixture__fixture_command", command: "fixture_command", args: "", respond: async text => { commandOutput.push(text); } }) : await runner.run(context);
 const { SqliteImageTaskStore } = await import('../../src/lib/server/agent/imageGenerate/imageTaskStore.js');
 const store = new SqliteImageTaskStore();
 const tasks = store.getUsageTasks().map(task => store.getTask(task.id)); store.close();
 const { DatabaseSync } = await import("node:sqlite");
 const budgetDb = new DatabaseSync(join(directory, "runtime", "run-budgets.sqlite"));
 const modelBudgetReceipts = budgetDb.prepare("SELECT source_id FROM run_budget_receipts WHERE kind = 'modelTurn' AND source_id LIKE '%:model:%'").all(); budgetDb.close();
 const messages = agent.state.messages;
 const { getApprovalBroker } = await import("../../src/lib/server/approval/approvalBroker.js");
 const approvals = getApprovalBroker().listPendingRequests();
 await new Promise<void>((resolve, reject) => process.send!({ type: 'result', outcome, ledger, receipts, tasks, messages, events, approvals, commandOutput, generations, modelBudgetReceipts, requestContexts }, error => error ? reject(error) : resolve()));
 const { getPiExtensionHost } = await import('../../src/lib/server/plugins/piExtensions/host.js'); getPiExtensionHost().dispose();
 clearInterval(keepAlive); process.disconnect?.();
} catch (error) { clearInterval(keepAlive); process.send?.({ type: 'error', error: String(error) }); process.exitCode = 1; process.disconnect?.(); }
