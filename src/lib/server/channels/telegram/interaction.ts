import { InlineKeyboard } from "grammy";
import type { InteractionInputPrompt, InteractionView } from "$lib/server/agent/interactions/types.js";

function compact(value: string, max = 120): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

export function formatTelegramInteractionView(view: InteractionView): string {
  const lines: string[] = [`*${view.title}*`];
  if (view.body) lines.push("", view.body);
  for (const section of view.sections ?? []) {
    if (section.title) lines.push("", `*${section.title}*`);
    if (section.body) lines.push(section.body);
    for (const row of section.rows ?? []) {
      const mark = row.selected ? "✓ " : "";
      const detail = row.detail ? ` — ${compact(row.detail)}` : "";
      lines.push(`• ${mark}${row.label}${detail}`);
    }
  }
  if (view.note) lines.push("", `_${view.note}_`);
  return lines.join("\n");
}

function addButtons(keyboard: InlineKeyboard, buttons: NonNullable<InteractionView["actions"]>): void {
  let column = 0;
  for (const button of buttons) {
    if (!button.token || button.disabledReason) continue;
    keyboard.text(button.label, `ix:${button.token}`);
    column += 1;
    if (column >= 2) {
      keyboard.row();
      column = 0;
    }
  }
  if (column !== 0) keyboard.row();
}

export function buildTelegramInteractionKeyboard(view: InteractionView): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const section of view.sections ?? []) {
    for (const row of section.rows ?? []) {
      if (!row.actions?.length) continue;
      addButtons(keyboard, row.actions.map((action) => ({
        ...action,
        label: row.actions?.length === 1 ? `${action.label}: ${compact(row.label, 36)}` : action.label
      })));
    }
    if (section.actions?.length) addButtons(keyboard, section.actions);
  }
  if (view.actions?.length) addButtons(keyboard, view.actions);
  return keyboard;
}

export function formatTelegramInputPrompt(input: InteractionInputPrompt): string {
  return `*${input.title}*\n\n${input.body}`;
}

export function buildTelegramInputKeyboard(input: InteractionInputPrompt): InlineKeyboard {
  return new InlineKeyboard().text("Cancel / 取消", `ix:${input.cancelToken}`);
}
