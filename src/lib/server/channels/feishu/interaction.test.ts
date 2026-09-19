import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFeishuInteractionCard,
  buildFeishuInteractionInputCard
} from "$lib/server/channels/feishu/interaction.js";
import type { InteractionInputPrompt, InteractionView } from "$lib/server/agent/interactions/types.js";

function actionValues(card: any): any[] {
  return (card.elements ?? [])
    .filter((element: any) => element.tag === "action")
    .flatMap((element: any) => element.actions ?? [])
    .map((action: any) => action.value);
}

test("feishu interaction cards disable forwarding and carry token-only action values", () => {
  const view: InteractionView = {
    surface: "sessions",
    title: "Sessions",
    sections: [{
      rows: [{
        label: "session-1",
        detail: "sensitive-server-id",
        actions: [{ label: "Switch", token: "tok123", style: "primary" }]
      }]
    }],
    actions: [{ label: "Menu", token: "menu123" }]
  };
  const card = buildFeishuInteractionCard(view) as any;
  assert.equal(card.config.enable_forward, false);
  assert.equal(card.config.update_multi, false);
  const values = actionValues(card);
  assert.deepEqual(values, [
    { kind: "interaction", token: "tok123" },
    { kind: "interaction", token: "menu123" }
  ]);
  assert.doesNotMatch(JSON.stringify(values), /sensitive-server-id/);
});

test("feishu interaction cards flatten markdown tables into list text", () => {
  const view: InteractionView = {
    surface: "result",
    title: "帮助",
    body: [
      "**常用命令**",
      "",
      "| 项目 | 值 |",
      "| --- | --- |",
      "| /menu | 打开原生操作菜单 |",
      "| /thinking [default\\|off\\|max] | 查看或修改思考级别 |"
    ].join("\n")
  };
  const card = buildFeishuInteractionCard(view) as any;
  const contents = (card.elements ?? [])
    .filter((element: any) => element.tag === "markdown")
    .map((element: any) => element.content)
    .join("\n");

  assert.doesNotMatch(contents, /\|\s*-{3,}\s*\|/);
  assert.match(contents, /• \*\*\/menu\*\*: 打开原生操作菜单/);
  assert.match(contents, /• \*\*\/thinking \[default\|off\|max\]\*\*: 查看或修改思考级别/);
});

test("feishu input card binds cancellation with an interaction token", () => {
  const input: InteractionInputPrompt = {
    requestId: "server-request",
    kind: "skill.run",
    title: "Use skill",
    body: "Reply to this message.",
    cancelToken: "cancel-token",
    expiresAt: Date.now() + 1000
  };
  const card = buildFeishuInteractionInputCard(input) as any;
  assert.equal(card.config.enable_forward, false);
  assert.deepEqual(actionValues(card), [{ kind: "interaction", token: "cancel-token" }]);
  assert.doesNotMatch(JSON.stringify(actionValues(card)), /server-request/);
});
