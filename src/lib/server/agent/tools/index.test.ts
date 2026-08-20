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

test("decideBashToolPolicy does not double-gate explicit hostApproval; the bash handler blocks on Host Bash approval itself", () => {
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

  assert.equal(decision.type, "allow");
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

test("tools index registers webFetch as a deferred public-page reader", () => {
  assert.match(indexSource, /createWebFetchTool/);
  assert.match(indexSource, /name: "webFetch"/);
  assert.match(indexSource, /tool: webFetchRuntimeTool/);
  assert.match(indexSource, /"fetch"/);
  assert.match(indexSource, /"url"/);
  assert.match(indexSource, /"article"/);
});

test("tools index registers docExtract as the deferred binary-document reader", () => {
  assert.match(indexSource, /createDocExtractTool/);
  assert.match(indexSource, /name: "docExtract"/);
  assert.match(indexSource, /tool: docExtractRuntimeTool/);
  assert.match(indexSource, /"pdf"/);
  assert.match(indexSource, /"invoice"/);
  assert.match(indexSource, /"attachment"/);
});

test("tools index registers documentExport as the verified deliverable writer", () => {
  assert.match(indexSource, /name: "documentExport"/);
  assert.match(indexSource, /tool: documentExportRuntimeTool/);
  assert.match(indexSource, /Generate and re-read verify deliverable DOCX, XLSX, or PDF/);
});

test("tools index registers runtimeTask as the only Agent todo and scheduling CRUD surface", () => {
  assert.match(indexSource, /createRuntimeTaskTool/);
  assert.match(indexSource, /name: "runtimeTask"/);
  assert.match(indexSource, /tool: runtimeTaskTool/);
  assert.match(indexSource, /"todo"/);
  assert.match(indexSource, /"delete"/);
  assert.doesNotMatch(indexSource, /createEventTool/);
});

test("tools index registers videoGenerate as a deferred tool with concise English discovery keywords", () => {
  assert.match(indexSource, /createVideoGenerateTool/);
  assert.match(indexSource, /name: "videoGenerate"/);
  assert.match(indexSource, /Remote URLs only/);
  assert.match(indexSource, /never pass Base64\/data URLs or local paths/);
  assert.match(indexSource, /tool: videoGenerateRuntimeTool/);
  assert.match(indexSource, /"video"/);
  assert.match(indexSource, /"generate"/);
  assert.match(indexSource, /"animate"/);
});

test("tools index registers ttsGenerate as a deferred tool with concise English discovery keywords", () => {
  assert.match(indexSource, /createTtsGenerateTool/);
  assert.match(indexSource, /name: "ttsGenerate"/);
  assert.match(indexSource, /tool: ttsGenerateRuntimeTool/);
  assert.match(indexSource, /"tts"/);
  assert.match(indexSource, /"speech"/);
  assert.match(indexSource, /"voiceover"/);
  assert.doesNotMatch(indexSource, /"文字转语音"/);
});

test("tools index registers miniAppManage as the deferred install receipt seam", () => {
  assert.match(indexSource, /createMiniAppManageTool/);
  assert.match(indexSource, /name: "miniAppManage"/);
  assert.match(indexSource, /tool: miniAppManageRuntimeTool/);
  assert.match(indexSource, /atomically install\/update/);
});

test("Plan mode exposes a role-restricted subagent without the write-capable runtime gate", () => {
  assert.match(
    indexSource,
    /allowedAgents:\s*permissionMode === "plan"\s*\? \["scout", "planner"\]\s*:\s*undefined/
  );
  assert.match(
    indexSource,
    /excludedTools:\s*permissionMode === "plan"\s*\? \["bash"\]\s*:\s*undefined/
  );
  assert.match(
    indexSource,
    /scopedTools\.filter\(\(tool\) => tool\.name === "subagent"\)/
  );
});
