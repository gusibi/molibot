import assert from "node:assert/strict";
import test from "node:test";
import { buildHostBashApprovalPrompt, buildNonInteractiveHostBashApprovalText } from "$lib/server/hostBash/approval.js";
import type { HostBashApprovalRecord } from "$lib/server/hostBash/types.js";

function approval(overrides: Partial<HostBashApprovalRecord> = {}): HostBashApprovalRecord {
  return {
    id: "hba-agent-browser-1",
    toolId: "agent-browser",
    displayName: "Agent Browser",
    command: "agent-browser",
    reason: "Requires browser IPC outside sandbox.",
    permissions: {
      envAllowlist: ["PATH", "HOME"],
      filesystem: "workspace-write",
      network: "internet"
    },
    channel: "weixin",
    chatId: "chat-1",
    scopeId: "chat-1",
    requestedAt: "2026-06-05T00:00:00.000Z",
    approvalMode: "persistent",
    status: "pending",
    pendingAction: {
      kind: "run_approved_host_bash",
      originalCommand: "agent-browser open https://example.com",
      args: ["open", "https://example.com"]
    },
    ...overrides
  };
}

test("host bash approval prompt shows only the action and complete command", () => {
  const prompt = buildHostBashApprovalPrompt(approval());

  assert.equal(prompt.title, "⚠️ 需要你的确认");
  assert.equal(
    prompt.body,
    "【操作】执行 Bash\n【命令】agent-browser open https://example.com\n【工具】Agent Browser"
  );
  // Ordered reject → widest grant → safest grant, matching the desktop card's
  // left-to-right layout so the number shortcuts line up with what is rendered.
  assert.deepEqual(
    prompt.options.map((option) => option.label),
    ["拒绝", "一直允许", "本会话允许", "仅此一次"]
  );
  assert.doesNotMatch(prompt.body, /Tool ID|Reason|Permissions|hba-agent-browser-1/);
});

test("persistent option names the bot or project it grants access to", () => {
  const projectPrompt = buildHostBashApprovalPrompt(approval({
    owner: { kind: "project", id: "proj-1", key: "project:proj-1", label: "molibot" }
  }));
  assert.equal(
    projectPrompt.options.find((option) => option.id === "approve_persistent")?.label,
    "本项目一直允许"
  );
  assert.deepEqual(projectPrompt.request.owner, {
    kind: "project",
    id: "proj-1",
    key: "project:proj-1",
    label: "molibot"
  });

  const botPrompt = buildHostBashApprovalPrompt(approval({
    owner: { kind: "bot", id: "moli-w", key: "bot:moli-w", label: "moli-w" }
  }));
  assert.equal(
    botPrompt.options.find((option) => option.id === "approve_persistent")?.label,
    "本 Bot 一直允许"
  );
});

test("one-time approval prompt omits the persistent option", () => {
  const prompt = buildHostBashApprovalPrompt(approval({
    approvalMode: "ephemeral",
    classification: {
      kind: "one-time-script",
      originalCommand: "agent-browser open https://example.com",
      reason: "Unsupported shell operator: >",
      detectedTokens: [">"]
    }
  }));

  assert.deepEqual(
    prompt.options.map((option) => option.id),
    ["reject", "approve_session", "approve_once"]
  );
});

test("non-interactive approval text spells out the always-allow scope", () => {
  const text = buildNonInteractiveHostBashApprovalText(buildHostBashApprovalPrompt(approval({
    owner: { kind: "project", id: "proj-1", key: "project:proj-1", label: "molibot" }
  })));
  assert.match(text, /♾️ 回复「一直允许」执行并在本项目的所有会话中长期允许 Agent Browser/);
});

test("non-interactive approval text keeps decisions concise and hides internal commands", () => {
  const text = buildNonInteractiveHostBashApprovalText(buildHostBashApprovalPrompt(approval({
    approvalMode: "ephemeral"
  })));

  assert.match(text, /【操作】执行 Bash/);
  assert.match(text, /✅ 回复「批准」或「仅此一次」仅执行这条命令一次/);
  assert.match(text, /🟡 回复「本会话允许」执行并仅在当前会话允许 Host Bash/);
  assert.match(text, /❌ 回复「拒绝」取消执行/);
  assert.doesNotMatch(text, /hosttools|hba-agent-browser-1|This channel|Permissions/);
});
