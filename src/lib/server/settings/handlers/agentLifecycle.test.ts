import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "../defaults.js";
import type { RuntimeSettings } from "../schema.js";
import type { SessionLifecycleService, LifecycleItemOutcome } from "$lib/server/sessions/sessionLifecycleService.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { requireEnabledAgent } from "$lib/server/sessions/sessionAgentService.js";
import { AgentDeleteBlockedError, agentBlockers, deleteAgent } from "./agentLifecycle.js";

function settings(): RuntimeSettings {
  const next = structuredClone(defaultRuntimeSettings);
  next.agents = [
    { id: "default", name: "Momo", description: "", enabled: true },
    { id: "writer", name: "Writer", description: "", enabled: true }
  ];
  next.deletedAgentIds = [];
  next.pendingAgentDeletions = [];
  next.channels = {
    ...next.channels,
    telegram: {
      instances: [
        { id: "unbound", name: "Unbound", enabled: true, credentials: {}, allowedChatIds: [] },
        { id: "personal", name: "Personal", enabled: true, agentId: "writer", credentials: {}, allowedChatIds: [] }
      ]
    }
  };
  return next;
}

function runtimeFor(initial: RuntimeSettings, dataDir: string, outcomes: () => LifecycleItemOutcome[] = () => []) {
  let current = structuredClone(initial);
  const archiveSnapshots: string[][] = [];
  let archiveCalls = 0;
  const runtime = {
    getSettings: () => current,
    updateSettings: (patch: Partial<RuntimeSettings>) => {
      current = { ...current, ...patch };
      return current;
    },
    sessions: {} as SessionStore,
    sessionLifecycle: {
      listAgentHistory: () => [],
      archiveAgentHistory: () => {
        archiveCalls += 1;
        archiveSnapshots.push([...(current.pendingAgentDeletions ?? [])]);
        return outcomes();
      }
    } as unknown as SessionLifecycleService,
    dataDir
  };
  return { runtime, archiveSnapshots, archiveCalls: () => archiveCalls, current: () => current };
}

function tempDir(t: test.TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "molibot-agent-lifecycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("channel bindings are blockers, including empty bindings that normalize to Momo", (t) => {
  const current = settings();
  const deps = { sessions: {} as SessionStore, sessionLifecycle: { listAgentHistory: () => [] } as unknown as SessionLifecycleService, dataDir: tempDir(t) };
  assert.deepEqual(agentBlockers(current, deps, "writer"), [{ kind: "channel", channel: "telegram", instanceId: "personal" }]);
  assert.deepEqual(
    agentBlockers(current, deps, "default").map(blocker => `${blocker.kind}:${"channel" in blocker ? blocker.channel : ""}`),
    ["channel:web", "channel:telegram"]
  );
});

test("live scheduled tasks block deletion while completed ones do not", (t) => {
  const root = tempDir(t);
  const events = join(root, "sessions", "writer", "events");
  mkdirSync(events, { recursive: true });
  writeFileSync(join(events, "live.json"), JSON.stringify({ agentId: "writer", status: { state: "pending" } }));
  writeFileSync(join(events, "done.json"), JSON.stringify({ agentId: "writer", status: { state: "completed" } }));
  const current = settings();
  current.channels.telegram!.instances = [];
  const deps = { sessions: {} as SessionStore, sessionLifecycle: { listAgentHistory: () => [] } as unknown as SessionLifecycleService, dataDir: root };
  assert.deepEqual(agentBlockers(current, deps, "writer"), [{ kind: "task", file: "live.json" }]);
});

test("deletion is blocked before any state changes", (t) => {
  const { runtime, current, archiveCalls } = runtimeFor(settings(), tempDir(t));
  assert.throws(() => deleteAgent(runtime, "writer"), AgentDeleteBlockedError);
  assert.equal(archiveCalls(), 0);
  assert.equal(current().agents.some(agent => agent.id === "writer"), true);
  assert.deepEqual(current().pendingAgentDeletions, []);
  assert.deepEqual(current().deletedAgentIds, []);
});

test("deletion archives while pending, then tombstones, and rejects admission meanwhile", (t) => {
  const initial = settings();
  initial.channels.telegram!.instances = [];
  const { runtime, archiveSnapshots, current } = runtimeFor(initial, tempDir(t));
  deleteAgent(runtime, "writer");
  assert.deepEqual(archiveSnapshots, [["writer"]]);
  const after = current();
  assert.equal(after.agents.some(agent => agent.id === "writer"), false);
  assert.deepEqual(after.deletedAgentIds, ["writer"]);
  assert.deepEqual(after.pendingAgentDeletions, []);
});

test("a failed archive keeps the Agent in deleting and a later retry completes it", (t) => {
  const initial = settings();
  initial.channels.telegram!.instances = [];
  let fail = true;
  const { runtime, current, archiveCalls } = runtimeFor(initial, tempDir(t), () =>
    fail ? [{ status: "failed", conversationId: "session-1", reason: "disk" }] : []
  );
  assert.throws(() => deleteAgent(runtime, "writer"), /requires retry/);
  assert.equal(current().agents.some(agent => agent.id === "writer"), true);
  assert.deepEqual(current().pendingAgentDeletions, ["writer"]);
  assert.deepEqual(current().deletedAgentIds, []);
  assert.throws(() => requireEnabledAgent(current(), "writer"), /being deleted/);

  fail = false;
  deleteAgent(runtime, "writer");
  assert.equal(archiveCalls(), 2);
  assert.deepEqual(current().deletedAgentIds, ["writer"]);
  assert.deepEqual(current().pendingAgentDeletions, []);
});

test("a restart resumes a persisted pending deletion without re-running blockers", (t) => {
  const initial = settings();
  initial.channels.telegram!.instances = [];
  initial.pendingAgentDeletions = ["writer"];
  const { runtime, current, archiveCalls } = runtimeFor(initial, tempDir(t));
  deleteAgent(runtime, "writer");
  assert.equal(archiveCalls(), 1);
  assert.deepEqual(current().deletedAgentIds, ["writer"]);
});

test("deleting an already tombstoned Agent is idempotent", (t) => {
  const initial = settings();
  initial.channels.telegram!.instances = [];
  initial.agents = initial.agents.filter(agent => agent.id !== "writer");
  initial.deletedAgentIds = ["writer"];
  const { runtime, archiveCalls } = runtimeFor(initial, tempDir(t));
  assert.deepEqual(deleteAgent(runtime, "writer").ok, true);
  assert.equal(archiveCalls(), 0);
});
