import type { Model } from "@mariozechner/pi-ai";

export const DEFAULT_AGENT_MAX_RETRY_DELAY_MS = 15_000;

export function resolvePreferredTransport(model: Model<any>): "sse" | "websocket" | "auto" {
  return model.provider === "openai-codex" ? "auto" : "sse";
}
