import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideBashToolPolicy } from "$lib/server/agent/tools/bashPolicy.js";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "index.ts"), "utf8");

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

test("deferred entries expose lightweight stubs through the common deferred-entry path", () => {
  assert.match(indexSource, /\.\.\.deferredEntries\.flatMap\(\(item\) => item\.stub \? \[item\.stub\] : \[\]\)/);
});

test("tools index registers imageGenerate as a deferred tool with concise English discovery keywords", () => {
  assert.match(indexSource, /createImageGenerateTool/);
  assert.match(indexSource, /name: "imageGenerate"/);
  assert.match(indexSource, /tool: imageGenerateRuntimeTool/);
  assert.match(indexSource, /"image"/);
  assert.match(indexSource, /"generate"/);
  assert.match(indexSource, /"poster"/);
  assert.doesNotMatch(indexSource, /"图像生成"/);
});
