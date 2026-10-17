import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const root = mkdtempSync(join(tmpdir(), "molibot-plan-api-"));
Object.assign(process.env, { DATA_DIR: root, DB_DIR: join(root, "db"), SETTINGS_DB_FILE: join(root, "settings.sqlite"), SETTINGS_FILE: join(root, "settings.json"), SESSIONS_DIR: join(root, "sessions"), SESSIONS_INDEX_FILE: join(root, "sessions", "index.json"), WEB_WORKSPACE_DIR: join(root, "web"), PI_CODING_AGENT_DIR: join(root, "pi"), MOLIBOT_DISABLE_EXTERNAL_CHANNELS: "1" });
const { GET, POST } = await import("./+server.js");
const { getRuntime } = await import("$lib/server/app/runtime.js");
const { durableExecutionEventsDir } = await import("$lib/server/agent/durable/events.js");
const { config } = await import("$lib/server/app/env.js");
assert.equal(config.dataDir, root);
const { storageMigrationStatus, confirmStorageMigration } = await import("$lib/server/sessions/agentStorageLifecycle.js");
if (storageMigrationStatus().needed) await confirmStorageMigration();
const runtime = getRuntime();
async function post(body: Record<string, unknown>) {
  const response = await POST({ request: new Request("http://localhost/api/desktop/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) } as Parameters<typeof POST>[0]);
  return { status: response.status, body: await response.json() };
}
async function read(id: string) {
  const url = new URL(`http://localhost/api/desktop/plans?id=${id}`);
  const response = await GET({ url, request: new Request(url) } as Parameters<typeof GET>[0]);
  return response.json();
}

test("public plan API saves 31 steps, previews a version, approves once into B Session and rejects stale decisions", async () => {
  const source = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const receiver = runtime.sessions.createWebConversation("web:personal:web-anonymous", undefined, "default");
  const created = await post({ action: "create", planId: "api-plan", agentId: "default", botId: "default", sourceChannel: "web", sourceChatId: "web:personal:web-anonymous", sourceUiSessionId: source.id, title: "31 steps", tasks: [{ title: "All work", steps: Array.from({ length: 31 }, (_, index) => ({ title: `Step ${index + 1}` })) }] });
  assert.equal(created.status, 200);
  let item = created.body.item;
  assert.equal(item.tasks[0].steps.length, 31);
  assert.equal(item.execution.status, "planned");
  const edited = await post({ action: "edit", executionId: item.execution.id, expectedVersion: item.execution.version, title: "Reviewed plan", summary: "Preserve input", tasks: item.tasks.map((task: any) => ({ ...task, steps: task.steps.map((step: any) => ({ ...step })) })), acceptanceCriteria: [{ description: "Owner verifies all output" }] });
  assert.equal(edited.status, 200);
  item = edited.body.item;
  const body = { action: "approve", planId: item.execution.id, expectedVersion: item.execution.version, sessionId: receiver.id, mode: "manual" };
  const results = await Promise.all([post(body), post({ ...body, sessionId: source.id })]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status !== 200).length, 1);
  const saved = (await read(item.execution.id)).item;
  assert.equal(saved.execution.status, "queued");
  assert.equal(saved.binding.sessionId, receiver.id);
  assert.equal(saved.execution.sourceUiSessionId, source.id);
  assert.equal(saved.tasks[0].steps.length, 31);
  assert.equal(readdirSync(durableExecutionEventsDir(root)).filter(name => name.includes(item.execution.id)).length, 1);
  const cancel = await post({ action: "cancel", planId: item.execution.id, expectedVersion: saved.execution.version, actionId: "cancel-api-plan" });
  assert.equal(cancel.body.item.execution.status, "cancelled");
  const removed = await post({ action: "delete", planId: item.execution.id, expectedVersion: cancel.body.item.execution.version });
  assert.equal(removed.body.deleted, true);
  assert.notEqual((await post(body)).status, 200);
});

test("event connection starts with a reload notification and observes committed edits", async () => {
  const controller = new AbortController();
  const url = new URL("http://localhost/api/desktop/plans?stream=true");
  const response = await GET({ url, request: new Request(url, { signal: controller.signal }) } as Parameters<typeof GET>[0]);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /snapshot/);
  const created = await post({ action: "create", planId: "event-plan", botId: "default", title: "Event", tasks: [{ title: "Task", steps: [{ title: "Step" }] }] });
  assert.equal(created.status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /changed/);
  controller.abort(); await reader.cancel();
  assert.equal((await read("event-plan")).item.meta.title, "Event");
});

test.after(() => { rmSync(root, { recursive: true, force: true }); });
