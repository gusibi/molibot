import test from "node:test";
import assert from "node:assert/strict";
import { buildHostToolApprovalPrompt, buildNonInteractiveHostToolApprovalText } from "./hostTools.js";
import type { HostToolApprovalRequest } from "./index.js";

test("non-interactive host tool approval text explains text fallback and explicit commands", () => {
  const request: HostToolApprovalRequest = {
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
    channel: "weixin",
    chatId: "chat-1",
    scopeId: "chat-1",
    requestedAt: "2026-05-16T00:00:00.000Z",
    approvalMode: "persistent",
    status: "pending",
    pendingAction: {
      kind: "run_approved_host_tool",
      originalCommand: "agent-browser --open",
      args: ["--open"]
    }
  };

  const text = buildNonInteractiveHostToolApprovalText(buildHostToolApprovalPrompt(request));

  assert.match(text, /Host tool approval: Agent Browser/);
  assert.match(text, /This channel does not support approval buttons/);
  assert.match(text, /Reply `批准`, `安装`, or `approve`/);
  assert.match(text, /Reply `拒绝` or `reject`/);
  assert.match(text, /\/hosttools approve hta-agent-browser-1/);
  assert.match(text, /\/hosttools reject hta-agent-browser-1/);
});
