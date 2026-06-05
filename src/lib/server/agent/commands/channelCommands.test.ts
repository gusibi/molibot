import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedRuntimeCommandService } from "$lib/server/agent/commands/channelCommands.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { ApprovedHostBashEntry, HostBashApprovalRecord } from "$lib/server/hostBash/index.js";

function minimalStore() {
  return {
    getActiveSession: () => "session-1",
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null,
    getSessionHostApprovalMode: () => "default",
    setSessionHostApprovalMode: () => "session",
    appendRuntimeEvent: () => {}
  };
}

function createTestHostBashStore(
  pending: HostBashApprovalRecord[],
  history: HostBashApprovalRecord[] = [],
  whitelist: ApprovedHostBashEntry[] = []
) {
  const approve = (scopeId: string, approvalId?: string, options?: { persistWhitelist?: boolean }) => {
    const index = pending.findIndex((item) =>
      item.scopeId === scopeId && item.status === "pending" && (!approvalId || item.id === approvalId)
    );
    if (index < 0) return null;
    const [record] = pending.splice(index, 1);
    if (!record) return null;
    record.status = "approved";
    history.push(record);
    let approved: ApprovedHostBashEntry | undefined;
    if (record.approvalMode === "persistent" && (options?.persistWhitelist ?? true)) {
      approved = {
        id: `hbw-${record.toolId}`,
        toolId: record.toolId,
        displayName: record.displayName,
        command: record.command,
        reason: record.reason,
        channel: record.channel,
        chatId: record.chatId,
        scopeId: record.scopeId,
        permissions: record.permissions,
        approvedAt: "2026-05-25T00:00:00.000Z",
        approvedFromRecordId: record.id,
        enabled: true
      };
      whitelist.push(approved);
    }
    return { record, approved };
  };

  return {
    listPending: (scopeId: string) => pending.filter((item) => item.scopeId === scopeId && item.status === "pending"),
    listWhitelist: () => whitelist,
    approve,
    reject: (scopeId: string, approvalId?: string) => {
      const index = pending.findIndex((item) =>
        item.scopeId === scopeId && item.status === "pending" && (!approvalId || item.id === approvalId)
      );
      if (index < 0) return null;
      const [record] = pending.splice(index, 1);
      if (!record) return null;
      record.status = "rejected";
      history.push(record);
      return record;
    },
    markExecution: (recordId: string, status: "executed" | "failed", errorText?: string) => {
      const record = history.find((item) => item.id === recordId);
      if (!record) return;
      record.status = status;
      record.errorText = errorText;
    }
  };
}

test("status command includes current session token stats", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 12,
      estimatedContextTokens: 3456,
      compactionCount: 1,
      latestCompaction: {
        timestamp: "2026-04-18T00:00:00.000Z",
        tokensBefore: 8000,
        tokensAfter: 3200,
        summarizedMessages: 18,
        reason: "manual" as const
      },
      usage: {
        runCount: 3,
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 6,
        cacheWriteTokens: 7,
        totalTokens: 181
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/status",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /Current context≈: 3,456 tokens/);
  assert.match(sent[0] ?? "", /Session token total: 181/);
  assert.match(sent[0] ?? "", /Session input\/output: 123 \/ 45/);
  assert.match(sent[0] ?? "", /Compactions: 1/);
});

test("plain approval text approves the only pending host tool request in the chat", async () => {
  const sent: string[] = [];
  const pending: HostBashApprovalRecord = {
    id: "hta-agent-browser-1",
    toolId: "agent-browser",
    displayName: "Agent Browser",
    command: "agent-browser",
    reason: "Requires browser IPC outside sandbox.",
    permissions: {
      envAllowlist: ["PATH", "HOME"],
      filesystem: "scratch-only",
      network: "internet"
    },
    channel: "telegram",
    chatId: "chat-1",
    scopeId: "chat-1",
    requestedAt: "2026-05-12T00:00:00.000Z",
    approvalMode: "persistent",
    status: "pending",
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "agent-browser --open",
      args: ["--open"]
    }
  };
  let autoExecuted = false;
  const pendingApprovals = [pending];
  const approvalHistory: HostBashApprovalRecord[] = [];
  const approvedTools: ApprovedHostBashEntry[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: minimalStore() as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    hostBashStore: createTestHostBashStore(pendingApprovals, approvalHistory, approvedTools) as any,
    executeApprovedHostBash: async () => {
      autoExecuted = true;
      return "Approved and executed immediately.";
    },
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "审批通过",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(autoExecuted, true);
  assert.equal(pendingApprovals.length, 0);
  assert.equal(approvalHistory[0]?.status, "executed");
  assert.equal(approvedTools[0]?.toolId, "agent-browser");
  assert.match(sent[0] ?? "", /Approved Host Bash: Agent Browser/);
  assert.match(sent[0] ?? "", /Approved and executed immediately/);
});

test("hosttools reject rejects a specific pending host tool request", async () => {
  const sent: string[] = [];
  const pending: HostBashApprovalRecord = {
    id: "hta-agent-browser-1",
    toolId: "agent-browser",
    displayName: "Agent Browser",
    command: "agent-browser",
    reason: "Requires browser IPC outside sandbox.",
    permissions: {
      envAllowlist: ["PATH", "HOME"],
      filesystem: "scratch-only",
      network: "internet"
    },
    channel: "qq",
    chatId: "chat-1",
    scopeId: "chat-1",
    requestedAt: "2026-05-12T00:00:00.000Z",
    approvalMode: "persistent",
    status: "pending"
  };
  const pendingApprovals = [pending];
  const approvalHistory: HostBashApprovalRecord[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "qq",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "qq",
    store: minimalStore() as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    hostBashStore: createTestHostBashStore(pendingApprovals, approvalHistory) as any,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/hosttools reject hta-agent-browser-1",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(pendingApprovals.length, 0);
  assert.equal(approvalHistory[0]?.status, "rejected");
  assert.match(sent[0] ?? "", /Rejected Host Bash approval hta-agent-browser-1/);
});

test("hosttools approve-session enables session fallback without persisting approved tool", async () => {
  const sent: string[] = [];
  const runtimeEvents: string[] = [];
  const pending: HostBashApprovalRecord = {
    id: "hta-cat-1",
    toolId: "cat",
    displayName: "cat",
    command: "cat",
    reason: "Needs host file access.",
    permissions: {
      envAllowlist: [],
      filesystem: "workspace-read",
      network: "none"
    },
    channel: "weixin",
    chatId: "chat-1",
    scopeId: "chat-1",
    requestedAt: "2026-05-23T00:00:00.000Z",
    approvalMode: "persistent",
    status: "pending",
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "cat blocked.txt",
      args: ["blocked.txt"]
    }
  };
  let autoExecuted = false;
  let sessionMode: "default" | "session" = "default";
  const pendingApprovals = [pending];
  const approvalHistory: HostBashApprovalRecord[] = [];
  const approvedTools: ApprovedHostBashEntry[] = [];
  const store = {
    ...minimalStore(),
    setSessionHostApprovalMode: (_scopeId: string, _sessionId: string, value: "default" | "session") => {
      sessionMode = value;
      return value;
    },
    appendRuntimeEvent: (_scopeId: string, event: { code: string }) => {
      runtimeEvents.push(event.code);
    }
  };
  const service = new SharedRuntimeCommandService<string>({
    channel: "weixin",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "weixin",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    hostBashStore: createTestHostBashStore(pendingApprovals, approvalHistory, approvedTools) as any,
    executeApprovedHostBash: async () => {
      autoExecuted = true;
      return "Executed immediately.";
    },
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/hosttools approve-session hta-cat-1",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(autoExecuted, true);
  assert.equal(sessionMode, "session");
  assert.equal(pendingApprovals.length, 0);
  assert.equal(approvedTools.length, 0);
  assert.equal(approvalHistory[0]?.status, "executed");
  assert.deepEqual(runtimeEvents, ["SESSION_HOST_APPROVAL_ENABLED"]);
  assert.match(sent[0] ?? "", /Approved for current session only/);
  assert.match(sent[0] ?? "", /Future sandbox permission denials in this session will fall back to Host Bash automatically/);
});

test("status command renders markdown table on qq", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 12,
      estimatedContextTokens: 3456,
      compactionCount: 1,
      latestCompaction: null,
      usage: {
        runCount: 3,
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 181
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "qq",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "qq",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/status",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /\*\*Status\*\*/);
  assert.match(sent[0] ?? "", /\| Item \| Value \|/);
  assert.match(sent[0] ?? "", /\| Current context≈ \| 3,456 tokens \|/);
});

test("runlog latest renders archived detail entries", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    readLatestRunSummary: () => ({ runId: "run-123" }),
    readRunDetail: () => ([
      { timestamp: "2026-05-16T10:00:00.000Z", type: "run_start", summary: "Run started." },
      { timestamp: "2026-05-16T10:00:01.000Z", type: "tool_start", summary: "Sandbox: query notes", toolName: "bash", displayName: "Sandbox" },
      { timestamp: "2026-05-16T10:00:03.000Z", type: "tool_end", summary: "Found 5 books", toolName: "bash", displayName: "Sandbox", isError: false },
      { timestamp: "2026-05-16T10:00:04.000Z", type: "final", summary: "Run finished successfully." }
    ]),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/runlog latest",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.match(sent[0] ?? "", /运行记录 run-123/);
  assert.match(sent[0] ?? "", /Sandbox: Found 5 books/);
  assert.match(sent[0] ?? "", /结束: Run finished successfully/);
});

test("runlog prefers file upload when channel supports it", async () => {
  const sent: string[] = [];
  const uploaded: Array<{ filePath: string; title?: string; text?: string; content: string }> = [];
  const store = {
    getActiveSession: () => "session-1",
    getScratchDir: () => process.cwd(),
    readLatestRunSummary: () => ({ runId: "run-456" }),
    readRunDetail: () => ([
      { timestamp: "2026-05-16T10:00:00.000Z", type: "run_start", summary: "Run started." },
      { timestamp: "2026-05-16T10:00:04.000Z", type: "final", summary: "Run finished successfully." }
    ]),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    },
    uploadFile: async (_target, filePath, title, text) => {
      uploaded.push({
        filePath,
        title,
        text,
        content: readFileSync(filePath, "utf8")
      });
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/runlog latest",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 0);
  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0]?.title ?? "", /run-456\.txt/);
  assert.match(uploaded[0]?.text ?? "", /运行记录已导出：run-456/);
  assert.match(uploaded[0]?.content ?? "", /运行记录 run-456/);
});

test("help command renders markdown table on weixin but stays plain text on telegram", async () => {
  const createStore = () =>
    ({
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    }) as any;

  const weixinSent: string[] = [];
  const telegramSent: string[] = [];

  const weixinService = new SharedRuntimeCommandService<string>({
    channel: "weixin",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "weixin",
    store: createStore(),
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      weixinSent.push(text);
    }
  });

  const telegramService = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: createStore(),
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      telegramSent.push(text);
    }
  });

  await weixinService.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/help",
    target: "target-1"
  });
  await telegramService.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/help",
    target: "target-1"
  });

  assert.match(weixinSent[0] ?? "", /\*\*Available commands\*\*/);
  assert.match(weixinSent[0] ?? "", /\| \/status \| show current bot\/session\/runtime status \|/);
  assert.doesNotMatch(telegramSent[0] ?? "", /\| Item \| Value \|/);
  assert.match(telegramSent[0] ?? "", /Available commands:/);
  assert.match(telegramSent[0] ?? "", /\/status - show current bot\/session\/runtime status/);
  assert.match(telegramSent[0] ?? "", /\/skills <id> - show details for one loaded skill/);
  assert.match(telegramSent[0] ?? "", /\/skills-detail - show full details for all loaded skills/);
});

test("shared commands use the configured runtime locale", async () => {
  const sent: string[] = [];
  const settings: RuntimeSettings = { ...defaultRuntimeSettings, locale: "zh-CN" };
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: minimalStore() as any,
    runners: {} as any,
    getSettings: () => settings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/help",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/stop",
    target: "target-1"
  });

  assert.match(sent[0] ?? "", /可用命令：/);
  assert.match(sent[0] ?? "", /\/status - 查看当前机器人、会话和运行时状态/);
  assert.doesNotMatch(sent[0] ?? "", /\/login|\/logout/);
  assert.equal(sent[1], "当前没有运行中的任务。");
});

test("skills commands split summary and detail output", async () => {
  const sent: string[] = [];
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-skills-"));
  const skillDir = join(workspaceDir, "skills", "web-search");
  const settings: RuntimeSettings = { ...defaultRuntimeSettings, locale: "zh-CN" };
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---",
    "name: web-search",
    "description: Search the web for current information.",
    "aliases: web-search, websearch",
    "mcp_servers: tavily",
    "---",
    "",
    "# Web Search"
  ].join("\n"));

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir,
    authScopePrefix: "telegram",
    store: minimalStore() as any,
    runners: {} as any,
    getSettings: () => settings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/skills",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/skills websearch",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/skills-detail",
    target: "target-1"
  });

  assert.match(sent[0] ?? "", /当前技能列表（共1个）/);
  assert.match(sent[0] ?? "", /\| 编号 \| 名称 \| 路径 \|/);
  assert.match(sent[0] ?? "", /\| 1 \| web-search \| .*\/skills\/web-search\/SKILL\.md \|/);
  assert.match(sent[0] ?? "", /使用 \/skills <id> 查看详情。/);
  assert.doesNotMatch(sent[0] ?? "", /description:/);

  assert.match(sent[1] ?? "", /技能：web-search/);
  assert.match(sent[1] ?? "", /描述：Search the web for current information\./);
  assert.match(sent[1] ?? "", /MCP servers: tavily/);

  assert.match(sent[2] ?? "", /1\. web-search/);
  assert.match(sent[2] ?? "", /- description: Search the web for current information\./);
  assert.match(sent[2] ?? "", /- mcp_servers: tavily/);
});

test("models command renders numbered markdown table with provider and model columns", async () => {
  const sent: string[] = [];
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    locale: "zh-CN",
    providerMode: "custom" as const,
    defaultCustomProviderId: "grok2api",
    customProviders: [
      {
        id: "grok2api",
        name: "Grok2Api",
        enabled: true,
        baseUrl: "http://localhost:8001/v1",
        apiKey: "test-key",
        defaultModel: "grok-4.20-fast",
        path: "/chat/completions",
        models: [
          {
            id: "grok-4.20-auto",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          },
          {
            id: "grok-4.20-fast",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ],
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|grok2api|grok-4.20-fast"
    }
  };
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 0,
      estimatedContextTokens: 0,
      compactionCount: 0,
      latestCompaction: null,
      usage: {
        runCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => settings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/models",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /当前模型列表（共3个）：/);
  assert.match(sent[0] ?? "", /\| 编号 \| 供应商 \| 模型 \|/);
  assert.match(sent[0] ?? "", /\| 1 \| \[Built-in\] anthropic \| claude-sonnet-4-20250514 \|/);
  assert.match(sent[0] ?? "", /\| 2 \| Grok2Api \| grok-4\.20-auto \|/);
  assert.match(sent[0] ?? "", /\| 3 ⭐ 当前活跃中 \| Grok2Api \| grok-4\.20-fast \|/);
  assert.match(sent[0] ?? "", /快捷切换：/);
});

test("stop command aborts current run and clears queued pending tasks", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => true,
    stopRun: () => ({ aborted: true }),
    cancelQueuedPending: async () => 2,
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/stop",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, ["Stopping... Cleared 2 queued task(s)."]);
});

test("stop command clears queued tasks even when nothing is currently running", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    cancelQueuedPending: async () => 3,
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/stop",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, ["No active task. Cleared 3 queued task(s)."]);
});

test("steer and followup commands use live runner controls", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => true,
    stopRun: () => ({ aborted: false }),
    steerRun: (_scopeId, text) => ({ queued: text === "correct that" }),
    followUpRun: (_scopeId, text) => ({ queued: text === "then summarize" }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/steer correct that",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/followup then summarize",
    target: "target-1"
  });

  assert.deepEqual(sent, [
    "Queued steering correction into current task.",
    "Queued follow-up after current task."
  ]);
});

test("steer and followup commands validate usage and running state", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    steerRun: () => ({ queued: false }),
    followUpRun: () => ({ queued: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/steer",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/followup later",
    target: "target-1"
  });

  assert.deepEqual(sent, [
    "Usage: /steer <text>",
    "Nothing running. Send a normal message instead."
  ]);
});

test("steer command can promote a queued item by queue id", async () => {
  const sent: string[] = [];
  const deletedIds: number[] = [];
  const steeredTexts: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => true,
    stopRun: () => ({ aborted: false }),
    steerRun: (_scopeId, text) => {
      steeredTexts.push(text);
      return { queued: true };
    },
    getQueuedPreview: async (_scopeId, id) => ({
      status: id === 12 ? "pending" as const : "not_found" as const,
      preview: id === 12 ? "please correct the scope" : undefined
    }),
    deleteQueued: async (_scopeId, id) => {
      deletedIds.push(id);
      return "deleted";
    },
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/steer 12",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.deepEqual(steeredTexts, ["please correct the scope"]);
  assert.deepEqual(deletedIds, [12]);
  assert.deepEqual(sent, ["Injected queued task 12 into current task."]);
});

test("followup command keeps queued item when no active run is available", async () => {
  const sent: string[] = [];
  let deleted = false;
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    followUpRun: () => ({ queued: false }),
    getQueuedPreview: async () => ({
      status: "pending" as const,
      preview: "then continue"
    }),
    deleteQueued: async () => {
      deleted = true;
      return "deleted";
    },
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/followup 15",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(deleted, false);
  assert.deepEqual(sent, ["Nothing running. Queue item 15 stays queued."]);
});

test("queue commands list, front insert, and delete pending tasks", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 0,
      estimatedContextTokens: 0,
      compactionCount: 0,
      latestCompaction: null,
      usage: {
        runCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    listQueue: async () => [
      { id: 11, status: "running", preview: "current task", createdAt: "2026-04-22T00:00:00.000Z" },
      { id: 12, status: "pending", preview: "queued task", createdAt: "2026-04-22T00:01:00.000Z" }
    ],
    deleteQueued: async (_scopeId, id) => (id === 12 ? "deleted" : "not_found"),
    enqueueFront: async () => 99,
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/queue",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/queue front urgent task",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/queue delete 12",
    target: "target-1"
  });

  assert.match(sent[0] ?? "", /#11 \[running\] current task/);
  assert.match(sent[0] ?? "", /#12 \[pending\] queued task/);
  assert.match(sent[1] ?? "", /Inserted at front of queue\. Queue ID: 99/);
  assert.match(sent[2] ?? "", /Deleted queued task 12\./);
});
