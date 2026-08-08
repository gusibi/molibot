import { InlineKeyboard } from "grammy";
import type { QueuedControlAction } from "$lib/server/agent/commands/channelCommands.js";

const QUEUED_CONTROL_CALLBACK = /^qctl:([xs]):([1-9]\d*)$/;

export function parseTelegramQueuedControlCallback(value: string): { action: QueuedControlAction; queueId: number } | null {
  const match = String(value).match(QUEUED_CONTROL_CALLBACK);
  if (!match) return null;
  const queueId = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(queueId)) return null;
  return { action: match[1] === "x" ? "stop" : "steer", queueId };
}

export function buildTelegramQueuedControlKeyboard(queueId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("停止 Stop", `qctl:x:${queueId}`)
    .text("插入 Steer", `qctl:s:${queueId}`);
}
