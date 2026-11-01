import { applySqliteMigrations, SQLITE_MIGRATIONS } from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/chord/sqlite/node";
import { DatabaseSync } from "node:sqlite";
import { currentPiInvocation } from "$lib/server/agent/durable/piInvocation.js";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PiRecoveryStore } from "$lib/server/agent/core/piRecoveryStore.js";
import { PiRunSession } from "$lib/server/agent/core/piRunSession.js";
import {
  inspectPiRecovery,
  pendingPiRecovery,
  PI_RECOVERY_REVIEW_MODEL,
  PI_RECOVERY_REVIEW_TOOL,
  PI_RECOVERY_UNAVAILABLE
} from "./piRecovery.js";

const model: Model<"openai-completions"> = { api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

const answer = (): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
  content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

function binding(directory: string) {
  return { storagePath: join(directory, "pi.sqlite"), requestId: "inbound", admissionKey: "manual",
    models: [model], scope: { ownerId: "owner", executionId: "run", stepId: "step", planVersion: 1, authorityKey: "manual" },
    assertStorageOwnership: () => {}, assertAuthority: () => {} };
}

function saveOwner(dataRoot: string, storagePath: string | undefined): void {
  const store = new PiRecoveryStore(dataRoot);
  try {
    store.save({ runId: "run", workspaceDir: dataRoot, chatId: "chat", sessionId: "session", channel: "web",
      context: {}, actor: "actor", workspaceId: "personal", models: [], storagePath, deferred: false });
  } finally { store.close(); }
}

/** Hold a native generation at the `request` checkpoint, then abort it so the test process can exit. */
async function holdRequest(directory: string) {
  let reached!: () => void;
  const atRequest = new Promise<void>(resolve => { reached = resolve; });
  const run = new PiRunSession({ initialState: { model, systemPrompt: "Answer", messages: [], tools: [] },
    getApiKey: () => "fixture",
    streamFn: (_model, _context, options) => {
      reached();
      const stream = createAssistantMessageEventStream();
      options?.signal?.addEventListener("abort", () => { stream.push({ type: "error", reason: "aborted", error: { ...answer(), stopReason: "aborted", content: [] } }); stream.end(); }, { once: true });
      return stream;
    } });
  run.startTurn(); run.bindRun(binding(directory));
  const work = run.prompt("Do work").catch(() => undefined);
  await atRequest;
  return { run, work };
}

/** Hold a native tool at the `execute` checkpoint, then abort loop. */
async function holdTool(directory: string, replay: "safe" | undefined, nested = false) {
  let reached!: () => void;
  const atTool = new Promise<void>(resolve => { reached = resolve; });
  let requests = 0;
  const tool: AgentTool = { name: "slow", label: "Slow", description: "Slow", replay,
    parameters: { type: "object", properties: {} },
    execute: async (_id, _args, signal) => {
      reached();
      await new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      throw new Error("unreachable");
    } };
  const parent: AgentTool = { ...tool, name: "parent", replay: "safe", execute: async () => {
    const invocation = currentPiInvocation()!;
    const result = await invocation.api.executeTool(tool.name, {}, invocation.context, { key: "leaf" });
    return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
  } };
  const run = new PiRunSession({ initialState: { model, systemPrompt: "Answer", messages: [], tools: nested ? [parent, tool] : [tool] },
    getApiKey: () => "fixture",
    streamFn: () => {
      requests += 1;
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = requests === 1
        ? { ...answer(), stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: nested ? "parent" : "slow", arguments: {} }] }
        : answer();
      stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
      stream.end();
      return stream;
    } });
  run.startTurn(); run.bindRun(binding(directory));
  const work = run.prompt("Use the tool").catch(() => undefined);
  await atTool;
  return { run, work };
}

async function settle(run: PiRunSession, work: Promise<unknown>): Promise<void> {
  run.abort();
  await run.close();
  await work;
}

test("a live model request is not resent automatically", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-request-"));
  const { run, work } = await holdRequest(directory);
  try {
    saveOwner(directory, join(directory, "pi.sqlite"));
    const [inspection] = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspection.disposition, "review");
    assert.equal(inspection.reason, PI_RECOVERY_REVIEW_MODEL);
    assert.deepEqual(await pendingPiRecovery(directory, () => "running"), []);
  } finally { await settle(run, work); rmSync(directory, { recursive: true, force: true }); }
});

test("an interrupted unsafe tool is not replayed automatically", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-unsafe-"));
  const { run, work } = await holdTool(directory, undefined);
  try {
    saveOwner(directory, join(directory, "pi.sqlite"));
    const [inspection] = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspection.disposition, "review");
    assert.equal(inspection.reason, PI_RECOVERY_REVIEW_TOOL);
  } finally { await settle(run, work); rmSync(directory, { recursive: true, force: true }); }
});

test("an interrupted replay-safe tool resumes from its native checkpoint", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-safe-"));
  const { run, work } = await holdTool(directory, "safe");
  try {
    saveOwner(directory, join(directory, "pi.sqlite"));
    const [inspection] = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspection.disposition, "resume");
    const pending = await pendingPiRecovery(directory, () => "running");
    assert.deepEqual(pending.map(record => record.runId), ["run"]);
  } finally { await settle(run, work); rmSync(directory, { recursive: true, force: true }); }
});

test("a committed run without live work reconciles rather than blocking", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-done-"));
  const run = new PiRunSession({ initialState: { model, systemPrompt: "Answer", messages: [], tools: [] },
    getApiKey: () => "fixture", streamFn: () => { const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: answer() }); stream.end(); return stream; } });
  try {
    run.startTurn(); run.bindRun(binding(directory));
    await run.prompt("Answer once");
    saveOwner(directory, join(directory, "pi.sqlite"));
    const [inspection] = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspection.disposition, "resume");
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("a missing execution record is reported instead of guessed", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-missing-"));
  try {
    saveOwner(directory, join(directory, "absent.sqlite"));
    const [inspection] = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspection.disposition, "unavailable");
    assert.equal(inspection.reason, PI_RECOVERY_UNAVAILABLE);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const replay of [undefined, "safe"] as const) test(`native nested ${replay ?? "unsafe"} tools are classified at startup`, { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-nested-"));
  const { run, work } = await holdTool(directory, replay, true);
  try {
    saveOwner(directory, join(directory, "pi.sqlite"));
    const [inspection] = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspection.disposition, replay === "safe" ? "resume" : "review");
    assert.deepEqual(inspection.uncertainCallIds ?? [], replay === "safe" ? [] : ["call-1/leaf"]);
  } finally { await settle(run, work); rmSync(directory, { recursive: true, force: true }); }
});


test("startup recovery preserves schema v1 before its inspection migrates the native execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-recovery-upgrade-"));
  const file = join(directory, "pi.sqlite");
  try {
    const legacy = await openNodeSqliteDatabase(file);
    try { await applySqliteMigrations(legacy, SQLITE_MIGRATIONS.slice(0, 1)); }
    finally { await legacy.close(); }
    saveOwner(directory, file);
    await inspectPiRecovery(directory, () => "running");
    const backups = readdirSync(directory).filter(name => name.includes("backup-pi-schema-v1") && name.endsWith(".sqlite"));
    assert.equal(backups.length, 1);
    const original = new DatabaseSync(join(directory, backups[0]), { readOnly: true });
    try { assert.equal(original.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get()?.version, 1); }
    finally { original.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
