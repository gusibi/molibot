/**
 * Shared postMessage bridge protocol for custom-mode Molibot plugin settings (issue #34).
 *
 * Used between the host settings page / desktop panel and the sandboxed iframe.
 */

export const PLUGIN_BRIDGE_VERSION = 1;
const MAX_BRIDGE_MESSAGE_BYTES = 256 * 1024;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;
const ACTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type PluginToHostMessage =
  | { type: "molibot:plugin:ready"; correlationId: string }
  | { type: "molibot:plugin:resize"; correlationId: string; height: number }
  | { type: "molibot:plugin:get_settings"; correlationId: string }
  | { type: "molibot:plugin:save_settings"; correlationId: string; values: Record<string, unknown> }
  | { type: "molibot:plugin:get_secrets_presence"; correlationId: string }
  | { type: "molibot:plugin:save_secrets"; correlationId: string; replace?: Record<string, string>; clear?: string[] }
  | { type: "molibot:plugin:invoke_action"; correlationId: string; action: string; input?: unknown };

export type HostToPluginMessage =
  | {
      type: "molibot:host:bootstrap";
      version: number;
      pluginId: string;
      pluginVersion: string;
      locale: "zh-CN" | "en-US";
      theme: "light" | "dark";
      themeTokens?: Record<string, string>;
      enabled: boolean;
    }
  | { type: "molibot:host:settings_data"; correlationId: string; values: Record<string, unknown> }
  | { type: "molibot:host:secrets_presence"; correlationId: string; presence: Record<string, { present: boolean }> }
  | { type: "molibot:host:action_progress"; correlationId: string; progress: unknown }
  | { type: "molibot:host:action_result"; correlationId: string; result: unknown }
  | { type: "molibot:host:saved"; correlationId: string }
  | { type: "molibot:host:error"; correlationId: string; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject malformed or oversized iframe messages before they reach host APIs. */
export function parsePluginToHostMessage(value: unknown): PluginToHostMessage | null {
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.startsWith("molibot:plugin:")) return null;
  if (typeof value.correlationId !== "string" || !CORRELATION_ID_PATTERN.test(value.correlationId)) return null;
  try {
    if (JSON.stringify(value).length > MAX_BRIDGE_MESSAGE_BYTES) return null;
  } catch {
    return null;
  }

  switch (value.type) {
    case "molibot:plugin:ready":
    case "molibot:plugin:get_settings":
    case "molibot:plugin:get_secrets_presence":
      return value as PluginToHostMessage;
    case "molibot:plugin:resize":
      return Number.isInteger(value.height) && Number(value.height) >= 80 && Number(value.height) <= 20_000
        ? value as PluginToHostMessage
        : null;
    case "molibot:plugin:save_settings":
      return isRecord(value.values) ? value as PluginToHostMessage : null;
    case "molibot:plugin:save_secrets": {
      const replaceValid = value.replace === undefined || (isRecord(value.replace) && Object.values(value.replace).every((item) => typeof item === "string"));
      const clearValid = value.clear === undefined || (Array.isArray(value.clear) && value.clear.every((item) => typeof item === "string"));
      return replaceValid && clearValid ? value as PluginToHostMessage : null;
    }
    case "molibot:plugin:invoke_action":
      return typeof value.action === "string" && ACTION_NAME_PATTERN.test(value.action) ? value as PluginToHostMessage : null;
    default:
      return null;
  }
}
