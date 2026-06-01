import type * as lark from "@larksuiteoapi/node-sdk";

export interface FeishuWsCardAction {
  chatId: string;
  messageId: string;
  event: lark.InteractiveCardActionEvent;
}

function normalizeActionValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function normalizeFeishuWsCardActionEvent(raw: unknown): FeishuWsCardAction | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, any>;
  const context = event.context && typeof event.context === "object" ? event.context as Record<string, any> : {};
  const operator = event.operator && typeof event.operator === "object" ? event.operator as Record<string, any> : {};
  const action = event.action && typeof event.action === "object" ? event.action as Record<string, any> : {};

  const chatId = String(context.open_chat_id ?? event.open_chat_id ?? "").trim();
  const messageId = String(context.open_message_id ?? event.open_message_id ?? "").trim();
  const openId = String(operator.open_id ?? event.open_id ?? "").trim();
  if (!chatId || !messageId || !openId) return null;

  return {
    chatId,
    messageId,
    event: {
      open_id: openId,
      user_id: operator.user_id ? String(operator.user_id) : undefined,
      tenant_key: String(event.tenant_key ?? operator.tenant_key ?? ""),
      open_message_id: messageId,
      token: String(event.token ?? ""),
      action: {
        value: normalizeActionValue(action.value),
        tag: String(action.tag ?? "button"),
        option: action.option === undefined ? undefined : String(action.option),
        timezone: action.timezone === undefined ? undefined : String(action.timezone)
      }
    }
  };
}
