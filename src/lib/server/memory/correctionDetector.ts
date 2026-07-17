import { scoreLexical } from "#mory";
import type { MemoryTurnTrace } from "$lib/server/memory/traceStore.js";

const EXPLICIT_CORRECTION = /(?:不对|不是这样|纠正一下|你说错了|我说错了|我不喜欢|我不偏好|别再|不要再|that's\s+wrong|not\s+correct|i\s+do\s+not\s+(?:like|prefer)|don't\s+(?:like|prefer))/i;

export function detectImmediateMemoryCorrections(message: string, trace: MemoryTurnTrace | null, threshold = 0.12): string[] {
  const text = message.replace(/\s+/g, " ").trim();
  if (!trace || !EXPLICIT_CORRECTION.test(text)) return [];
  return trace.injectedItems
    .filter((item) => scoreLexical(text, item.snapshot.content) >= threshold)
    .map((item) => item.memoryId);
}
