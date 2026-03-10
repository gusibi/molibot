import type { Bot } from "grammy";
import { momWarn } from "../../agent/log.js";

const SEND_RETRY_DELAYS_MS = [0, 500, 1500] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function markdownToTelegramHtml(input: string): string {
  const normalized = input.replace(/\r\n?/g, "\n");
  const tokens: string[] = [];
  const saveToken = (content: string): string => {
    const idx = tokens.push(content) - 1;
    return `\u0000${idx}\u0000`;
  };

  let out = normalized;

  out = out.replace(/```(?:[^\n`]*)\n([\s\S]*?)```/g, (_m, code: string) =>
    saveToken(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`)
  );

  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    saveToken(`<code>${escapeHtml(code)}</code>`)
  );

  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
    saveToken(`<a href="${escapeHtmlAttr(url)}">${escapeHtml(label)}</a>`)
  );

  out = escapeHtml(out);

  out = out.replace(/^\s*#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  out = out.replace(/^\s*[-*]\s+/gm, "• ");
  out = out.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<b>$1</b>");
  out = out.replace(/(^|[^\w])_([^_\n][^_\n]*?)_/g, "$1<i>$2</i>");
  out = out.replace(/(^|[^\*])\*([^*\n][^*\n]*?)\*/g, "$1<i>$2</i>");
  out = out.replace(/~~([^~\n][^~\n]*?)~~/g, "<s>$1</s>");

  out = out.replace(/\u0000(\d+)\u0000/g, (_m, rawIdx: string) => tokens[Number(rawIdx)] ?? "");
  return out;
}

export function formatTelegramText(text: string): { text: string; parseMode?: "HTML" } {
  const normalized = text.replace(/\r\n?/g, "\n");
  const looksLikeMarkdown =
    /```|`|\*\*|~~|\[[^\]]+\]\(https?:\/\/|^\s*#{1,6}\s+/m.test(normalized) ||
    /(^|[^\*])\*[^*\n][^*\n]*\*/.test(normalized) ||
    /(^|[^\w])_[^_\n][^_\n]*_/.test(normalized);

  if (!looksLikeMarkdown) {
    return { text: normalized };
  }

  return { text: markdownToTelegramHtml(normalized), parseMode: "HTML" };
}

export async function sendTelegramText(
  bot: Bot,
  chatId: string,
  text: string,
  options?: Record<string, unknown>
): Promise<{ message_id: number }> {
  const payload = formatTelegramText(text);
  const sendOptions = payload.parseMode
    ? { ...(options ?? {}), parse_mode: payload.parseMode }
    : { ...(options ?? {}) };

  try {
    return await sendTelegramWithRetry(bot, chatId, payload.text, sendOptions, "formatted");
  } catch (error) {
    if (payload.parseMode) {
      momWarn("telegram", "send_message_parse_fallback_plain", {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return await sendTelegramWithRetry(bot, chatId, text, options ?? {}, "plain");
    }
    throw error;
  }
}

async function sendTelegramWithRetry(
  bot: Bot,
  chatId: string,
  text: string,
  options: Record<string, unknown>,
  mode: "formatted" | "plain"
): Promise<{ message_id: number }> {
  return retryTelegramApiCall(
    "send_message_retry_scheduled",
    { chatId, mode },
    async () => (await bot.api.sendMessage(chatId, text, options as never)) as { message_id: number }
  );
}

function isRetryableTelegramSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Network request for") ||
    message.includes("fetch failed") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTelegramErrorDetails(error: unknown): Record<string, unknown> {
  const base = error instanceof Error
    ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
    : {
      message: String(error ?? "")
    };

  const withFields = error && typeof error === "object"
    ? error as Record<string, unknown>
    : undefined;
  const nested = withFields?.error;
  const nestedFields = nested && typeof nested === "object"
    ? nested as Record<string, unknown>
    : undefined;
  const cause = (error instanceof Error ? error.cause : undefined) ?? nestedFields?.cause;
  const causeFields = cause && typeof cause === "object"
    ? cause as Record<string, unknown>
    : undefined;

  return {
    ...base,
    code: withFields?.code ?? nestedFields?.code ?? causeFields?.code ?? null,
    errno: withFields?.errno ?? nestedFields?.errno ?? causeFields?.errno ?? null,
    type: withFields?.type ?? nestedFields?.type ?? causeFields?.type ?? null,
    method: withFields?.method ?? nestedFields?.method ?? null,
    status: withFields?.status ?? nestedFields?.status ?? null,
    statusText: withFields?.statusText ?? nestedFields?.statusText ?? null,
    address: withFields?.address ?? nestedFields?.address ?? causeFields?.address ?? null,
    port: withFields?.port ?? nestedFields?.port ?? causeFields?.port ?? null,
    syscall: withFields?.syscall ?? nestedFields?.syscall ?? causeFields?.syscall ?? null,
    causeMessage: cause instanceof Error ? cause.message : (cause != null ? String(cause) : null),
    nestedErrorMessage: nested instanceof Error ? nested.message : (nestedFields?.message ?? null)
  };
}

export function describeTelegramError(error: unknown): Record<string, unknown> {
  return extractTelegramErrorDetails(error);
}

async function retryTelegramApiCall<T>(
  logEvent: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SEND_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = SEND_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableTelegramSendError(error) || attempt === SEND_RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
      momWarn("telegram", logEvent, {
        ...metadata,
        attempt: attempt + 1,
        nextDelayMs: SEND_RETRY_DELAYS_MS[attempt + 1],
        error: error instanceof Error ? error.message : String(error),
        errorDetails: extractTelegramErrorDetails(error)
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Telegram API call failed"));
}

export async function editTelegramText(bot: Bot, chatId: string, messageId: number, text: string): Promise<void> {
  const payload = formatTelegramText(text);
  try {
    if (payload.parseMode) {
      await retryTelegramApiCall(
        "edit_message_retry_scheduled",
        { chatId, messageId, mode: "formatted" },
        async () => {
          await bot.api.editMessageText(chatId, messageId, payload.text, { parse_mode: payload.parseMode } as never);
        }
      );
      return;
    }
    await retryTelegramApiCall(
      "edit_message_retry_scheduled",
      { chatId, messageId, mode: "plain" },
      async () => {
        await bot.api.editMessageText(chatId, messageId, payload.text);
      }
    );
  } catch (error) {
    if (payload.parseMode) {
      momWarn("telegram", "edit_message_parse_fallback_plain", {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      await retryTelegramApiCall(
        "edit_message_retry_scheduled",
        { chatId, messageId, mode: "plain_fallback" },
        async () => {
          await bot.api.editMessageText(chatId, messageId, text);
        }
      );
      return;
    }
    throw error;
  }
}

export async function sendTelegramChatAction(
  bot: Bot,
  chatId: string,
  action: "typing" | "upload_photo" | "record_voice"
): Promise<void> {
  await retryTelegramApiCall(
    "send_chat_action_retry_scheduled",
    { chatId, action },
    async () => {
      await bot.api.sendChatAction(chatId, action);
    }
  );
}
