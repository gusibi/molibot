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

// ---------------------------------------------------------------------------
// Unified execution modes: third-party (MCP) tools through the real ToolRuntime.
// ---------------------------------------------------------------------------

test("a non-read MCP operation runs without an approval card in full access and asks in accept edits", async () => {
  const { createMomTools } = await import("$lib/server/agent/tools/index.js");
  const { getApprovalBroker } = await import("$lib/server/approval/approvalBroker.js");
  const { MomRuntimeStore } = await import("$lib/server/agent/session/store.js");
  const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { storagePaths } = await import("$lib/server/infra/db/storage.js");

  // The approval broker persists to settings.sqlite; point it at a temporary
  // database before the singleton is first constructed so this test neither
  // reads nor writes the real one, and leftovers cannot leak between runs.
  const isolationRoot = mkdtempSync(join(tmpdir(), "molibot-tools-mcp-db-"));
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsDbFile = join(isolationRoot, "settings.sqlite");

  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-tools-mcp-"));
  const store = new MomRuntimeStore(workspaceDir);
  const executions: Array<Record<string, unknown>> = [];
  const fakeMcpTool = {
    name: "mcp__srv__query",
    label: "mcp__srv__query",
    description: "Fictitious MCP tool with non-read effects.",
    parameters: { type: "object", additionalProperties: true },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      executions.push(params);
      return { content: [{ type: "text", text: "mcp executed" }] };
    }
  };

  const baseSettings = {
    ...defaultRuntimeSettings,
    permissionMode: "manual" as const
  };

  const buildTools = (mode: "manual" | "auto") => {
    return createMomTools({
      channel: "web",
      cwd: workspaceDir,
      workspaceDir,
      chatId: "chat-mcp",
      sessionId: "session-mcp",
      timezone: "UTC",
      store,
      memory: {
        syncExternalMemories: async () => {},
        createProfileTurnSnapshot: async () => ({ fingerprint: "profile", items: [] }),
        createPromptSnapshot: async () => ({ createdAt: "", fingerprint: "", query: "", promptText: "", selected: [], longTerm: [], daily: [] })
      } as never,
      getSettings: () => ({ ...baseSettings, permissionMode: mode }) as never,
      updateSettings: (patch) => ({ ...baseSettings, ...patch }) as never,
      getSelectedMcpServerIds: () => new Set<string>(),
      setSelectedMcpServerIds: () => {},
      getLoadedMcpTools: () => [fakeMcpTool] as never,
      refreshLoadedMcpTools: async () => ({ statuses: [], toolCount: 1 }),
      uploadFile: async () => {}
    });
  };

  const prepare = (mode: "manual" | "auto") => {
    const tools = buildTools(mode);
    const wrapTool = (tools as unknown as { wrapTool: (tool: unknown) => { execute: (id: string, params: unknown) => Promise<{ error?: string; details?: { status?: string } }> } }).wrapTool;
    return wrapTool(fakeMcpTool);
  };

  try {
    // Full access: the non-read MCP call goes straight through.
    const autoTool = prepare("auto");
    const autoResult = await autoTool.execute("tc-auto", { serverId: "srv", toolName: "query" });
    assert.equal(autoResult.error, undefined);
    assert.equal(executions.length, 1, "the MCP tool executed exactly once");
    assert.equal(getApprovalBroker().listPendingRequests().filter((r) => r.sessionId === "session-mcp").length, 0, "no approval request in full access");

    // Accept edits: the same call raises an approval request instead.
    executions.length = 0;
    const restrictedTool = prepare("accept_edits");
    const restrictedResult = await restrictedTool.execute("tc-restricted", { serverId: "srv", toolName: "query" });
    assert.match(String(restrictedResult.error ?? ""), /approval/i);
    assert.equal(executions.length, 0, "the restricted call has not executed");
    assert.equal(getApprovalBroker().listPendingRequests().filter((r) => r.sessionId === "session-mcp").length, 1, "exactly one approval request exists");
  } finally {
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(isolationRoot, { recursive: true, force: true });
  }
});

test("full access lets the write tool touch paths outside the workspace roots; restricted modes keep the wall", async () => {
  const { getWriteToolDefinition } = await import("$lib/server/agent/tools/write.js");
  const { mkdtempSync, rmSync, existsSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-write-policy-ws-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "molibot-write-policy-out-"));
  const outsidePath = join(outsideDir, "external.txt");
  try {
    const buildCtx = () => ({
      runId: "run-1", sessionId: "session-1", workspaceId: "personal", actorId: "chat-1",
      cwd: workspaceDir,
      fs: {
        readText: async () => "",
        writeText: async (p: string, c: string) => { const { writeFile } = await import("node:fs/promises"); await writeFile(p, c, "utf8"); },
        readBuffer: async () => Buffer.alloc(0)
      },
      shell: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      network: { fetch: async () => ({}) },
      emit: () => {}
    } as unknown as ToolExecutionContext);
    // Restricted mode keeps the approved-root wall.
    const restricted = getWriteToolDefinition({ cwd: workspaceDir, workspaceDir });
    await assert.rejects(
      restricted.handler({ path: outsidePath, content: "no" }, buildCtx()),
      /Path outside allowed workspace roots/
    );

    // Full access writes the very same path (issue: file tools obey the same
    // effective policy as commands).
    const full = getWriteToolDefinition({ cwd: workspaceDir, workspaceDir, hostWideAccess: true });
    const result = await full.handler({ path: outsidePath, content: "host-wide" }, buildCtx());
    assert.equal(result.ok, true, String(result.error ?? ""));
    assert.equal(existsSync(outsidePath), true);
    assert.equal(readFileSync(outsidePath, "utf8"), "host-wide");
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});
