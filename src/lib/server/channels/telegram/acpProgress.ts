import type { AcpProgressEvent } from "../../acp/types.js";

const HISTORY_LIMIT = 20;
const TEXT_LIMIT = 3600;

export interface TelegramAcpProgressState {
  title: string;
  subtitle: string;
  current: string;
  settled: string[];
}

function summarizeLine(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function render(state: TelegramAcpProgressState): string {
  const lines = [state.title];
  if (state.subtitle) {
    lines.push(state.subtitle);
  }
  lines.push("", `Current: ${state.current || "running"}`);
  if (state.settled.length > 0) {
    lines.push("", ...state.settled);
  }

  let text = lines.join("\n");
  if (text.length <= TEXT_LIMIT) return text;

  const trimmedHistory = [...state.settled];
  while (trimmedHistory.length > 0) {
    trimmedHistory.shift();
    const nextLines = [state.title];
    if (state.subtitle) nextLines.push(state.subtitle);
    nextLines.push("", `Current: ${state.current || "running"}`);
    if (trimmedHistory.length > 0) {
      nextLines.push("", ...trimmedHistory);
    }
    text = nextLines.join("\n");
    if (text.length <= TEXT_LIMIT) return text;
  }

  return text.slice(0, TEXT_LIMIT - 1).trimEnd() + "…";
}

function appendSettled(state: TelegramAcpProgressState, line: string): void {
  const normalized = summarizeLine(line, 180);
  if (!normalized) return;
  if (state.settled[state.settled.length - 1] === normalized) return;
  state.settled.push(normalized);
  if (state.settled.length > HISTORY_LIMIT) {
    state.settled = state.settled.slice(-HISTORY_LIMIT);
  }
}

export function createTelegramAcpProgressState(startText: string): TelegramAcpProgressState {
  const [first = "ACP task started", ...rest] = startText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    title: summarizeLine(first, 120) || "ACP task started",
    subtitle: summarizeLine(rest.join(" "), 180),
    current: summarizeLine(first, 180) || "starting",
    settled: []
  };
}

export function applyTelegramAcpProgressEvent(
  state: TelegramAcpProgressState,
  event: AcpProgressEvent
): string {
  switch (event.type) {
    case "status_current":
      state.current = summarizeLine(event.text, 180) || state.current;
      break;
    case "step_completed":
    case "step_failed":
      state.current = summarizeLine(event.text, 180) || state.current;
      appendSettled(state, event.text);
      break;
    case "result":
      state.current = summarizeLine(event.text, 180) || state.current;
      break;
    default:
      break;
  }

  return render(state);
}
