import type * as lark from "@larksuiteoapi/node-sdk";
import { formatFeishuCardMarkdown, markdownToFeishuMarkdown } from "$lib/server/channels/feishu/formatting.js";
import type { InteractionButton, InteractionInputPrompt, InteractionView } from "$lib/server/agent/interactions/types.js";

function buttonType(style: InteractionButton["style"]): "default" | "primary" | "danger" {
  if (style === "primary") return "primary";
  if (style === "danger") return "danger";
  return "default";
}

function actionElement(buttons: InteractionButton[]): any | null {
  const actions = buttons
    .filter((button) => button.token && !button.disabledReason)
    .map((button) => ({
      tag: "button",
      type: buttonType(button.style),
      text: { tag: "plain_text", content: button.label },
      value: { kind: "interaction", token: button.token }
    }));
  return actions.length > 0 ? { tag: "action", layout: "flow", actions } : null;
}

export function buildFeishuInteractionCard(view: InteractionView): lark.InteractiveCard {
  const elements: any[] = [];
  if (view.body) elements.push({ tag: "markdown", content: formatFeishuCardMarkdown(view.body) });
  for (const section of view.sections ?? []) {
    if (section.title) elements.push({ tag: "markdown", content: `**${section.title}**` });
    if (section.body) elements.push({ tag: "markdown", content: formatFeishuCardMarkdown(section.body) });
    for (const row of section.rows ?? []) {
      const selected = row.selected ? "✅ " : "";
      const detail = row.detail ? `\n${row.detail}` : "";
      elements.push({
        tag: "markdown",
        content: markdownToFeishuMarkdown(`${selected}**${row.label}**${detail}`)
      });
      const actions = actionElement(row.actions ?? []);
      if (actions) elements.push(actions);
    }
    const sectionActions = actionElement(section.actions ?? []);
    if (sectionActions) elements.push(sectionActions);
  }
  const actions = actionElement(view.actions ?? []);
  if (actions) elements.push(actions);
  if (view.note) {
    elements.push({
      tag: "note",
      elements: [{ tag: "plain_text", content: view.note }]
    });
  }
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false,
      update_multi: false
    },
    header: {
      template: view.surface === "confirm" ? "orange" : view.surface === "result" ? "grey" : "blue",
      title: { tag: "plain_text", content: view.title }
    },
    elements
  };
}

export function buildFeishuInteractionInputCard(input: InteractionInputPrompt): lark.InteractiveCard {
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: false,
      update_multi: false
    },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: input.title }
    },
    elements: [
      { tag: "markdown", content: markdownToFeishuMarkdown(input.body) },
      {
        tag: "note",
        elements: [{ tag: "plain_text", content: "Reply directly to this message. Only that reply will be consumed." }]
      },
      {
        tag: "action",
        layout: "flow",
        actions: [{
          tag: "button",
          type: "default",
          text: { tag: "plain_text", content: "Cancel / 取消" },
          value: { kind: "interaction", token: input.cancelToken }
        }]
      }
    ]
  };
}
