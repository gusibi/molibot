import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import { ToolRegistry, ToolRuntime } from "$lib/server/agent/tools/toolRuntime.js";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import { WorkspaceStore } from "$lib/server/workspaces/store.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";

function context(events: RunDetailEntry[] = [], signal?: AbortSignal): ToolExecutionContext {
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
    },
    signal
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

test("ToolRuntime blocks high-risk tool and executes when approved", async () => {
  const registry = new ToolRegistry();
  let executed = false;
  registry.register(tool({
    id: "host-bash",
    name: "Host Bash",
    risk: "high",
    source: "host",
    handler: async () => {
      executed = true;
      return { ok: true, content: "ran" };
    }
  }));
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);
  const runtime = new ToolRuntime(registry, { approvalBroker: broker });

  // Approve the request after a short delay
  setTimeout(() => {
    const pending = store.listPendingRequests();
    if (pending.length > 0) {
      const req = pending[0];
      broker.updateRequest({
        ...req,
        status: "approved",
        resolvedAt: new Date().toISOString()
      });
    }
  }, 50);

  const result = await runtime.executeToolCall({
    toolId: "host-bash",
    input: { command: "git status" },
    context: context()
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "ran");
  assert.equal(executed, true);
  assert.equal(store.listPendingRequests().length, 0);
});

test("ToolRuntime blocks high-risk tool and rejects when rejected by user", async () => {
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
  const broker = new ApprovalBroker(store);
  const runtime = new ToolRuntime(registry, { approvalBroker: broker });

  // Reject the request after a short delay
  setTimeout(() => {
    const pending = store.listPendingRequests();
    if (pending.length > 0) {
      const req = pending[0];
      broker.updateRequest({
        ...req,
        status: "rejected",
        resolvedAt: new Date().toISOString()
      });
    }
  }, 50);

  const result = await runtime.executeToolCall({
    toolId: "host-bash",
    input: { command: "git status" },
    context: context()
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /rejected by user/);
  assert.equal(executed, false);
});

test("ToolRuntime stops polling and expires when signal is aborted", async () => {
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
  const broker = new ApprovalBroker(store);
  const runtime = new ToolRuntime(registry, { approvalBroker: broker });

  const controller = new AbortController();
  // Abort after a short delay
  setTimeout(() => {
    controller.abort();
  }, 50);

  const result = await runtime.executeToolCall({
    toolId: "host-bash",
    input: { command: "git status" },
    context: context([], controller.signal)
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /timeout/);
  assert.equal(executed, false);
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
    capability: "bash:host-bash",
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

test("ToolRuntime blocks tool execution if not in workspace whitelist", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "molibot-tool-runtime-"));
  try {
    const store = new WorkspaceStore(join(tempDir, "settings.sqlite"));
    store.upsertWorkspace({
      id: "test-whitelist",
      name: "Test Whitelist",
      enabledToolIds: ["echo"]
    });

    const registry = new ToolRegistry();
    registry.register(tool({ id: "echo" }));
    registry.register(tool({ id: "run_command" }));

    const okResult = await new ToolRuntime(registry, { workspaceStore: store }).executeToolCall({
      toolId: "echo",
      input: "hello",
      context: {
        ...context(),
        workspaceId: "test-whitelist"
      }
    });
    assert.equal(okResult.ok, true);

    const blockedResult = await new ToolRuntime(registry, { workspaceStore: store }).executeToolCall({
      toolId: "run_command",
      input: "ls",
      context: {
        ...context(),
        workspaceId: "test-whitelist"
      }
    });
    assert.equal(blockedResult.ok, false);
    assert.match(blockedResult.error ?? "", /workspace security policy/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
