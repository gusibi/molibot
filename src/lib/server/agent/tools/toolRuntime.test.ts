import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalBroker, MemoryApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import { buildBrokerApprovalRecord, createDefaultApprovalRequest, ToolRegistry, ToolRuntime } from "$lib/server/agent/tools/toolRuntime.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
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

test("ToolRuntime records a non-pure tool boundary before and after the handler", async () => {
  const registry = new ToolRegistry();
  const phases: string[] = [];
  registry.register(tool({
    id: "write",
    handler: async () => {
      phases.push("handler");
      return { ok: true, content: "written" };
    }
  }));

  const result = await new ToolRuntime(registry).executeToolCall({
    toolId: "write",
    input: { file_path: "notes/today.md", content: "hello" },
    context: {
      ...context(),
      onSideEffectPreflight: async (effect) => {
        phases.push(`intent:${effect.sideEffectClass}`);
        assert.equal(effect.targetSummary, "write:notes/today.md");
      },
      onSideEffectReceipt: async (effect, receipt) => {
        phases.push(`receipt:${effect.sideEffectClass}`);
        assert.equal(receipt.ok, true);
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(phases, ["intent:idempotent", "handler", "receipt:idempotent"]);
});

test("ToolRuntime terminates before a promoted side effect reaches the handler", async () => {
  const registry = new ToolRegistry();
  let executed = false;
  let receiptCalled = false;
  registry.register(tool({
    id: "write",
    handler: async () => {
      executed = true;
      return { ok: true, content: "must not run" };
    }
  }));

  const result = await new ToolRuntime(registry).executeToolCall({
    toolId: "write",
    input: { file_path: "notes/today.md", content: "hello" },
    context: {
      ...context(),
      onSideEffectPreflight: async () => ({ terminate: true, reason: "promoted" }),
      onSideEffectReceipt: async () => {
        receiptCalled = true;
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.terminate, true);
  assert.equal(result.error, "promoted");
  assert.equal(result.details?.durablePromotion, true);
  assert.equal(executed, false);
  assert.equal(receiptCalled, false);
});

test("ToolRuntime serializes side-effect preflight through receipt", async () => {
  const registry = new ToolRegistry();
  const phases: string[] = [];
  let activeHandlers = 0;
  let maxActiveHandlers = 0;
  registry.register(tool({
    id: "write",
    handler: async () => {
      activeHandlers += 1;
      maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeHandlers -= 1;
      return { ok: true, content: "written" };
    }
  }));

  const runtime = new ToolRuntime(registry);
  const call = (toolCallId: string) => runtime.executeToolCall({
    toolId: "write",
    input: { file_path: `${toolCallId}.md`, content: "hello" },
    context: {
      ...context(),
      toolCallId,
      onSideEffectPreflight: async (effect) => {
        phases.push(`intent:${effect.toolCallId}`);
      },
      onSideEffectReceipt: async (effect) => {
        phases.push(`receipt:${effect.toolCallId}`);
      }
    }
  });

  await Promise.all([call("first"), call("second")]);

  assert.equal(maxActiveHandlers, 1);
  assert.deepEqual(phases, ["intent:first", "receipt:first", "intent:second", "receipt:second"]);
});

test("ToolRuntime leaves pure tools outside the side-effect boundary", async () => {
  const registry = new ToolRegistry();
  registry.register(tool({ id: "read" }));
  let called = false;

  const result = await new ToolRuntime(registry).executeToolCall({
    toolId: "read",
    input: { path: "notes/today.md" },
    context: {
      ...context(),
      onSideEffectPreflight: async () => { called = true; },
      onSideEffectReceipt: async () => { called = true; }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(called, false);
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
  assert.match(result.error ?? "", /aborted/i);
  assert.equal(executed, false);
  // Aborting the wait must leave the request in its `expired` terminal state
  // rather than leaving it pending forever (CLAUDE.md pitfall 23).
  const requests = store.listPendingRequests();
  assert.equal(requests.length, 0, "an aborted wait must not leave a pending request behind");
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

test("ToolRuntime consumes a durable approval before running a high-risk handler", async () => {
  const registry = new ToolRegistry();
  let executed = false;
  let actionKey = "";
  registry.register(tool({
    id: "host-bash",
    name: "Host Bash",
    risk: "high",
    source: "host",
    handler: async () => {
      executed = true;
      return { ok: true, content: "ran once" };
    }
  }));

  const result = await new ToolRuntime(registry).executeToolCall({
    toolId: "host-bash",
    input: { command: "git status" },
    context: {
      ...context(),
      consumeDurableApproval: async (request) => {
        actionKey = request.actionKey;
        return "once";
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(executed, true);
  assert.equal(actionKey, "host-bash:git status:ephemeral");
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

function sampleApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "req-1",
    runId: "run-9",
    sessionId: "sess-9",
    workspaceId: "ws-9",
    actorId: "actor-9",
    capability: "host:bash",
    riskLevel: "high",
    action: { type: "bash", command: "ls -la", toolName: "bash" },
    reason: "needs host access",
    status: "pending",
    requestedBy: { agentId: "actor-9", depth: 0 },
    scopeOptions: ["once", "session"],
    createdAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

test("buildBrokerApprovalRecord fills the constant broker envelope and maps request fields", () => {
  const request = sampleApprovalRequest();
  const record = buildBrokerApprovalRecord({
    request,
    actorId: "chat-7",
    toolId: "bash",
    displayName: "bash",
    command: "ls -la",
    status: "pending"
  });

  assert.equal(record.id, request.id);
  assert.equal(record.reason, request.reason);
  assert.equal(record.scopeId, request.runId);
  assert.equal(record.sessionId, request.sessionId);
  assert.equal(record.requestedAt, request.createdAt);
  assert.equal(record.chatId, "chat-7");
  assert.equal(record.channel, "");
  assert.equal(record.approvalMode, "ephemeral");
  assert.equal(record.toolId, "bash");
  assert.equal(record.displayName, "bash");
  assert.equal(record.command, "ls -la");
  assert.equal(record.status, "pending");
  assert.deepEqual(record.permissions, { envAllowlist: [], filesystem: "scratch-only", network: "none" });
  assert.equal(record.pendingAction, undefined);
});

test("buildBrokerApprovalRecord passes through a one-time pending action", () => {
  const record = buildBrokerApprovalRecord({
    request: sampleApprovalRequest(),
    actorId: "chat-7",
    toolId: "tool",
    displayName: "tool",
    command: "do x",
    status: "pending",
    pendingAction: { kind: "run_one_time_host_script", originalCommand: "do x", args: [], timeout: 300 }
  });
  assert.equal(record.pendingAction?.kind, "run_one_time_host_script");
  assert.equal(record.pendingAction?.originalCommand, "do x");
});

test("a tool that ignores cancellation is released by the shared execution watchdog", async () => {
  const registry = new ToolRegistry();
  registry.register(tool({
    id: "stuck",
    handler: async () => new Promise(() => undefined)
  }));
  const runtime = new ToolRuntime(registry, { executionTimeoutMs: 20 });
  const result = await runtime.executeToolCall({ toolId: "stuck", input: {}, context: context() });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /timed out after 20ms/i);
});

test("an approval_required decision is honoured for a medium-risk tool", async () => {
  // `isHighRisk` was a safe assumption only while high/critical were the only
  // things that could produce `approval_required` — it was effectively always
  // true at that branch. Permission modes break that: Manual asks before a
  // `write`, which is medium risk, so a gate that says "ask" must not fall
  // through to execution just because the tool is not high risk.
  const registry = new ToolRegistry();
  let executed = false;
  registry.register(tool({
    id: "write",
    risk: "medium",
    effect: "write",
    handler: async () => {
      executed = true;
      return { ok: true, content: "written" };
    }
  }));

  const asked: string[] = [];
  const runtime = new ToolRuntime(registry, {
    decidePolicy: (tool, input, ctx) => ({
      type: "approval_required",
      request: {
        id: "req-medium-1",
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        workspaceId: ctx.workspaceId,
        actorId: ctx.actorId,
        toolId: tool.id,
        capability: "file.write",
        actionFingerprint: "fp-1",
        action: { path: "notes.md" },
        risk: tool.risk,
        createdAt: new Date().toISOString()
      } as unknown as ApprovalRequest
    })
  });

  const result = await runtime.executeToolCall({
    toolId: "write",
    input: { path: "notes.md" },
    context: {
      ...context([]),
      onApprovalRequest: async (req) => {
        asked.push(req.requestId);
        return "defer";
      }
    }
  });

  assert.equal(executed, false, "the tool must not run before the user answers");
  assert.equal(result.ok, false);
  assert.equal(result.metadata?.status, "waiting_for_approval");
  assert.deepEqual(asked, ["req-medium-1"], "the request must reach the approval surface");
});

test("an approval card offers a lasting grant, so a mode is not a permanent nag", () => {
  // PRD §132: the scopes existed but `persistent` was never offered, so
  // "always allow" had no way to be chosen through the broker — only Host Bash
  // could produce a lasting grant. With permission modes now sending `write`,
  // `edit` and MCP calls through this path, a card without that option turns
  // Manual into an endless prompt and pushes people to Auto for the wrong
  // reason.
  const request = createDefaultApprovalRequest(
    {
      id: "write",
      name: "Write",
      description: "",
      inputSchema: {},
      risk: "medium",
      source: "builtin",
      effect: "write",
      handler: async () => ({ ok: true, content: "" })
    },
    { path: "notes.md" },
    context([])
  );

  assert.ok(request.scopeOptions.includes("once"), "declining to remember must stay available");
  assert.ok(
    request.scopeOptions.includes("persistent"),
    "an owner-scoped lasting grant must be offerable (PRD §132)"
  );
  // The fingerprint is what a grant matches on, so it has to describe the
  // action rather than the tool alone — otherwise approving one write would
  // grant every future write.
  assert.match(request.actionFingerprint, /notes\.md/);
});

test("ToolRuntime suspends cleanly when the inline handshake window elapses", async () => {
  const registry = new ToolRegistry();
  let executed = false;
  registry.register(tool({
    id: "mcp__test__action",
    name: "Test Action",
    risk: "high",
    source: "mcp",
    handler: async () => {
      executed = true;
      return { ok: true };
    }
  }));
  const store = new MemoryApprovalBrokerStore();
  const broker = new ApprovalBroker(store);

  // Use an ApprovalService adapter with a very short timeoutMs to simulate window elapsing
  const customService = {
    checkGrant: (ctx: any) => broker.checkGrant(ctx),
    createRequest: (req: any) => broker.createRequest(req),
    getRequest: (id: string) => broker.getRequest(id),
    resolve: (input: any) => broker.resolveRequest(input),
    expireRequest: (id: string) => {
      const r = broker.getRequest(id);
      if (r && r.status === "pending") broker.updateRequest({ ...r, status: "expired", resolvedAt: new Date().toISOString() });
    },
    waitForDecision: async (input: any) => {
      // Simulate inline window expiring without user resolution
      return "window_expired" as const;
    }
  };

  const runtime = new ToolRuntime(registry, { approvalService: customService as any });
  const result = await runtime.executeToolCall({
    toolId: "mcp__test__action",
    input: { actionId: "something" },
    context: context()
  });

  assert.equal(result.ok, false);
  assert.equal(result.terminate, true, "the run must terminate/suspend cleanly");
  assert.equal(result.metadata?.status, "waiting_for_approval");
  assert.ok(typeof result.metadata?.approvalRequestId === "string");
  assert.equal(executed, false, "handler must not run before approval");
});

test("installing code can never be granted permanently", () => {
  // `manage` asks in every mode because the request can arrive in content the
  // agent read rather than from the owner. A persistent grant there would let
  // a single approval authorize every future install, which makes the trust
  // circular: anything could install itself and then run freely (pitfall 21d).
  const request = createDefaultApprovalRequest(
    {
      id: "miniAppManage",
      name: "Mini App manage",
      description: "",
      inputSchema: {},
      risk: "critical",
      source: "builtin",
      effect: "manage",
      handler: async () => ({ ok: true, content: "" })
    },
    { action: "install" },
    context([])
  );

  assert.deepEqual(request.scopeOptions, ["once"], "installs are answered one at a time, always");
});
