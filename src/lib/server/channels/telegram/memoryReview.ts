import { InlineKeyboard } from "grammy";
import type { MemoryReviewAction } from "$lib/server/memory/review.js";

const MEMORY_REVIEW_CALLBACK = /^mrv:([ki]):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function parseTelegramMemoryReviewCallback(value: string): { action: MemoryReviewAction; candidateId: string } | null {
  const match = String(value).match(MEMORY_REVIEW_CALLBACK);
  if (!match) return null;
  return { action: match[1].toLowerCase() === "k" ? "keep" : "ignore", candidateId: match[2].toLowerCase() };
}

export function buildTelegramMemoryReviewKeyboard(candidateId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("保留", `mrv:k:${candidateId}`)
    .text("不保留", `mrv:i:${candidateId}`);
}
