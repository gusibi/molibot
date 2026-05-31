import test from "node:test";
import assert from "node:assert/strict";
import { decideBashToolPolicy } from "$lib/server/agent/tools/bashPolicy.js";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";

const bashTool: ToolDefinition = {
  id: "bash",
  name: "bash",
  description: "Run bash",
  inputSchema: {},
  risk: "high",
  source: "host",
  handler: async () => ({ ok: true })
};

function context(events: RunDetailEntry[] = []): ToolExecutionContext {
  return {
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "chat-1",
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

function emptyHostBashStore(): any {
  return {
    getApprovedEntry: () => undefined
  };
}

test("decideBashToolPolicy allows ordinary bash when sandbox is enabled", () => {
  const decision = decideBashToolPolicy({
    tool: bashTool,
    input: { command: "printf hello" },
    ctx: context(),
    sandboxEnabled: true,
    hostBashStore: emptyHostBashStore()
  });

  assert.equal(decision.type, "allow");
});

test("decideBashToolPolicy allows ordinary bash when sandbox is disabled", () => {
  const decision = decideBashToolPolicy({
    tool: bashTool,
    input: { command: "printf hello" },
    ctx: context(),
    sandboxEnabled: false,
    hostBashStore: emptyHostBashStore()
  });

  assert.equal(decision.type, "allow");
});

test("decideBashToolPolicy ignores hostApproval requests when sandbox is disabled", () => {
  const decision = decideBashToolPolicy({
    tool: bashTool,
    input: {
      command: "agent-browser --open",
      hostApproval: { reason: "Host full access is already enabled." }
    },
    ctx: context(),
    sandboxEnabled: false,
    hostBashStore: emptyHostBashStore()
  });

  assert.equal(decision.type, "allow");
});

test("decideBashToolPolicy requires approval for explicit hostApproval when sandbox is enabled", () => {
  const decision = decideBashToolPolicy({
    tool: bashTool,
    input: {
      command: "agent-browser --open",
      hostApproval: { reason: "Needs browser IPC outside the sandbox." }
    },
    ctx: context(),
    sandboxEnabled: true,
    hostBashStore: emptyHostBashStore()
  });

  assert.equal(decision.type, "approval_required");
});
