import test from "node:test";
import assert from "node:assert/strict";
import { QqApprovalInteractions, QQ_APPROVAL_BUTTON_PREFIX, type QqApprovalDeps } from "./approvalButtons.js";
import type { GatewayInteractionEvent } from "#qqbot/src/gateway.js";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/types.js";

function buildPrompt(): HostBashApprovalPrompt {
  return {
    type: "host_bash_approval",
    requestId: "req-1",
    title: "Host Bash 审批",
    body: "rm -rf /tmp/test",
    options: [
      { id: "approve_once", label: "批准一次", style: "primary" },
      { id: "approve_session", label: "本会话批准", style: "primary" },
      { id: "approve_persistent", label: "持久批准", style: "primary" },
      { id: "reject", label: "拒绝", style: "danger" },
    ],
    request: {
      toolId: "bash",
      displayName: "bash",
      command: "rm",
      args: ["-rf", "/tmp/test"],
    },
  } as HostBashApprovalPrompt;
}

interface DepLog {
  acks: Array<{ id: string; code: number }>;
  sentTexts: Array<{ target: { mode: string; id: string }; text: string }>;
  approvals: Array<{ kind: string; requestId?: string; scope?: string }>;
}

function buildDeps(log: DepLog): QqApprovalDeps {
  return {
    commandService: {
      approveHostTool: async (input, approvalId, scope) => {
        log.approvals.push({ kind: `approve:${scope}`, requestId: approvalId });
        return { ok: true, message: "已批准（一次）。" };
      },
      approveHostToolForSession: async (input, approvalId) => {
        log.approvals.push({ kind: "approve:session", requestId: approvalId });
        return { ok: true, message: "已批准（本会话）。" };
      },
      rejectHostTool: async (input, approvalId) => {
        log.approvals.push({ kind: "reject", requestId: approvalId });
        return { ok: true, message: "已拒绝。" };
      },
    },
    sendText: async (target, text) => {
      log.sentTexts.push({ target, text });
    },
    acknowledge: async (id, code) => {
      log.acks.push({ id, code });
    },
    isChatAllowed: () => true,
  };
}

function c2cInteraction(buttonData: string): GatewayInteractionEvent {
  return { id: "ix-1", buttonData, userOpenid: "user-1" };
}

test("approval keyboard layout: approve row + reject row, hta data within QQ limit", () => {
  const interactions = new QqApprovalInteractions(buildDeps({ acks: [], sentTexts: [], approvals: [] }));
  const keyboard = interactions.buildKeyboard("user-1", buildPrompt());

  assert.equal(keyboard.content.rows.length, 2);
  const approveButtons = keyboard.content.rows[0]!.buttons;
  assert.equal(approveButtons.length, 3);
  for (const button of approveButtons) {
    assert.ok(button.action.data.startsWith(QQ_APPROVAL_BUTTON_PREFIX));
    assert.ok(button.action.data.length <= 32, `button data exceeds 32 bytes: ${button.action.data}`);
    assert.equal(button.action.click_limit, 1);
    assert.equal(button.action.permission.type, 2);
    assert.equal(button.render_data.visited_label, "已处理");
  }
  const rejectButton = keyboard.content.rows[1]!.buttons[0]!;
  assert.ok(rejectButton.action.data.startsWith(QQ_APPROVAL_BUTTON_PREFIX));
  assert.equal(rejectButton.render_data.label, "拒绝");
});

test("valid approve click acks 0, resolves once via command service and replies result", async () => {
  const log: DepLog = { acks: [], sentTexts: [], approvals: [] };
  const interactions = new QqApprovalInteractions(buildDeps(log));
  const keyboard = interactions.buildKeyboard("user-1", buildPrompt());
  const approveOnceData = keyboard.content.rows[0]!.buttons[0]!.action.data;

  await interactions.handleInteraction(c2cInteraction(approveOnceData));

  assert.deepEqual(log.acks, [{ id: "ix-1", code: 0 }]);
  assert.deepEqual(log.approvals, [{ kind: "approve:once", requestId: "req-1" }]);
  assert.equal(log.sentTexts.length, 1);
  assert.equal(log.sentTexts[0]!.text, "已批准（一次）。");
  assert.equal(log.sentTexts[0]!.target.mode, "c2c");

  // token 已消耗：重复点击走失效提示，不再触发审批
  log.acks.length = 0;
  log.approvals.length = 0;
  await interactions.handleInteraction(c2cInteraction(approveOnceData));
  assert.deepEqual(log.acks, [{ id: "ix-1", code: 1 }]);
  assert.deepEqual(log.approvals, []);
  assert.match(log.sentTexts[1]!.text, /已失效/);
});

test("reject click routes to rejectHostTool", async () => {
  const log: DepLog = { acks: [], sentTexts: [], approvals: [] };
  const interactions = new QqApprovalInteractions(buildDeps(log));
  const keyboard = interactions.buildKeyboard("user-1", buildPrompt());
  const rejectData = keyboard.content.rows[1]!.buttons[0]!.action.data;

  await interactions.handleInteraction(c2cInteraction(rejectData));

  assert.deepEqual(log.acks, [{ id: "ix-1", code: 0 }]);
  assert.deepEqual(log.approvals, [{ kind: "reject", requestId: "req-1" }]);
});

test("disallowed chat is rejected with ack code 4 and no command side effects", async () => {
  const log: DepLog = { acks: [], sentTexts: [], approvals: [] };
  const deps = buildDeps(log);
  deps.isChatAllowed = () => false;
  const interactions = new QqApprovalInteractions(deps);
  const keyboard = interactions.buildKeyboard("user-1", buildPrompt());

  await interactions.handleInteraction(c2cInteraction(keyboard.content.rows[0]!.buttons[0]!.action.data));

  assert.deepEqual(log.acks, [{ id: "ix-1", code: 4 }]);
  assert.deepEqual(log.approvals, []);
  assert.deepEqual(log.sentTexts, []);
});

test("token registered for another scope is rejected with ack code 1", async () => {
  const log: DepLog = { acks: [], sentTexts: [], approvals: [] };
  const interactions = new QqApprovalInteractions(buildDeps(log));
  const keyboard = interactions.buildKeyboard("user-1", buildPrompt());

  // 同一 token 由别的会话点击
  await interactions.handleInteraction({
    id: "ix-2",
    buttonData: keyboard.content.rows[0]!.buttons[0]!.action.data,
    userOpenid: "user-2",
  });

  assert.deepEqual(log.acks, [{ id: "ix-2", code: 1 }]);
  assert.deepEqual(log.approvals, []);
  // 失效提示发给点击者所在的会话
  assert.equal(log.sentTexts.length, 1);
  assert.equal(log.sentTexts[0]!.target.id, "user-2");
});

test("group interaction resolves in the group scope", async () => {
  const log: DepLog = { acks: [], sentTexts: [], approvals: [] };
  const interactions = new QqApprovalInteractions(buildDeps(log));
  const keyboard = interactions.buildKeyboard("group-1", buildPrompt());

  await interactions.handleInteraction({
    id: "ix-3",
    buttonData: keyboard.content.rows[1]!.buttons[0]!.action.data,
    groupOpenid: "group-1",
    groupMemberOpenid: "member-9",
  });

  assert.deepEqual(log.acks, [{ id: "ix-3", code: 0 }]);
  assert.equal(log.sentTexts[0]!.target.mode, "group");
  assert.equal(log.sentTexts[0]!.target.id, "group-1");
});
