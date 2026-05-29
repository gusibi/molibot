import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import { ToolRegistry, ToolRuntime } from "$lib/server/agent/tools/toolRuntime.js";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";

function context(events: RunDetailEntry[] = []): ToolExecutionContext {
  return {
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "agent-1",
    cwd: "/tmp",
    fs: {
      readText: async () => "",
      writeText: async () => {}
    },
    shell: {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" })
    },
    network: {
      fetch: async () => ({})
    },
    emit: (event) => {
      events.push(event);
    }
  };
}

function tool(input: Partial<ToolDefinition>): ToolDefinition {
  return {
    id: "echo",
    name: "Echo",
    description: "Echo input",
    inputSchema: {},
    risk: "low",
    source: "builtin",
    handler: async (value) => ({ ok: true, content: value }),
    ...input
  };
}

test("ToolRuntime executes allowed tools and emits audit events", async () => {
  const registry = new ToolRegistry();
  registry.register(tool({}));
  const events: RunDetailEntry[] = [];

  const result = await new ToolRuntime(registry).executeToolCall({
    toolId: "echo",
    input: "hello",
    context: context(events)
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "hello");
  assert.deepEqual(events.map((event) => event.type), ["tool_start", "tool_end"]);
  assert.equal(events[0]?.workspaceId, "personal");
});

test("ToolRuntime creates approval request for high-risk tools without bypassing execution", async () => {
  const registry = new ToolRegistry();
  let executed = false;
  registry.register(tool({
    id: "host-bash",
    name: "Host Bash",
    risk: "high",
    source: "host",
    handler: async () => {
      executed = true;
      return { ok: true };
    }
  }));
  const store = new MemoryApprovalBrokerStore();
  const runtime = new ToolRuntime(registry, { approvalBroker: new ApprovalBroker(store) });

  const result = await runtime.executeToolCall({
    toolId: "host-bash",
    input: { command: "git status" },
    context: context()
  });

  assert.equal(result.ok, false);
  assert.equal(result.metadata?.status, "waiting_for_approval");
  assert.equal(executed, false);
  assert.equal(store.listPendingRequests().length, 1);
});

test("ToolRuntime uses existing approval grant to execute high-risk tool", async () => {
  const registry = new ToolRegistry();
  registry.register(tool({
    id: "host-bash",
    name: "Host Bash",
    risk: "high",
    source: "host",
    handler: async () => ({ ok: true, content: "ran" })
  }));
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  store.saveGrant({
    id: "grant-1",
    scope: "session",
    capability: "host:host-bash",
    actorId: "agent-1",
    workspaceId: "personal",
    sessionId: "session-1",
    createdAt: "2026-05-28T00:00:00.000Z"
  });

  const result = await new ToolRuntime(registry, { approvalBroker: broker }).executeToolCall({
    toolId: "host-bash",
    input: { command: "git status" },
    context: context()
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "ran");
});
