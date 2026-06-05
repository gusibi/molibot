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
    "【操作】执行 Bash（并长期允许 Agent Browser）\n【命令】agent-browser open https://example.com"
  );
  assert.deepEqual(prompt.options.map((option) => option.label), ["批准", "本轮允许", "拒绝"]);
  assert.doesNotMatch(prompt.body, /Tool ID|Reason|Permissions|hba-agent-browser-1/);
});

test("non-interactive approval text keeps decisions concise and hides internal commands", () => {
  const text = buildNonInteractiveHostBashApprovalText(buildHostBashApprovalPrompt(approval({
    approvalMode: "ephemeral"
  })));

  assert.match(text, /【操作】执行 Bash（仅此命令一次）/);
  assert.match(text, /✅ 回复「批准」仅执行这条命令一次/);
  assert.match(text, /🟡 回复「本轮允许」执行并仅在当前会话允许 Host Bash/);
  assert.match(text, /❌ 回复「拒绝」取消执行/);
  assert.doesNotMatch(text, /hosttools|hba-agent-browser-1|This channel|Permissions/);
});
