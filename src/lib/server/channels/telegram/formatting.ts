import type { Bot } from "grammy";
import { momWarn } from "../../agent/log.js";

const SEND_RETRY_DELAYS_MS = [0, 500, 1500, 3000, 5000, 8000, 12000] as const;
const TELEGRAM_TEXT_SOFT_LIMIT = 3500;
const TELEGRAM_API_ATTEMPT_TIMEOUT_MS = 12000;

interface TelegramRetryPolicy {
  failOnRateLimit?: boolean;
  maxRetryAfterMs?: number | null;
  requestTimeoutMs?: number | null;
}

function chunkTelegramText(text: string, chunkSize = TELEGRAM_TEXT_SOFT_LIMIT): string[] {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > chunkSize) {
    let splitAt = remaining.lastIndexOf("\n", chunkSize);
    if (splitAt < Math.floor(chunkSize / 2)) splitAt = chunkSize;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

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
  const rawChunks = chunkTelegramText(text);
  const chunks = rawChunks.length > 0 ? rawChunks : [String(text ?? "").trim()];
  let lastMessageId = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const payload = formatTelegramText(chunk);
    const chunkOptions =
      i === 0 ? { ...(options ?? {}) } : {};
    const sendOptions = payload.parseMode
      ? { ...chunkOptions, parse_mode: payload.parseMode }
      : chunkOptions;

    try {
      const sent = await sendTelegramWithRetry(bot, chatId, payload.text, sendOptions, "formatted");
      lastMessageId = sent.message_id;
    } catch (error) {
      if (!payload.parseMode) throw error;
      momWarn("telegram", "send_message_parse_fallback_plain", {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      const sent = await sendTelegramWithRetry(bot, chatId, chunk, chunkOptions, "plain");
      lastMessageId = sent.message_id;
    }
  }

  return { message_id: lastMessageId };
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
  const name = error instanceof Error ? error.name : "";
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const errorCode = Number(fields?.error_code ?? fields?.status ?? 0);
  if (errorCode === 429 || message.includes("Too Many Requests")) {
    return true;
  }
  return (
    message.includes("Network request for") ||
    message.includes("fetch failed") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("socket hang up") ||
    message.toLowerCase().includes("timeout") ||
    name === "AbortError" ||
    name === "TimeoutError" ||
    message.includes("network")
  );
}

function isTelegramRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const errorCode = Number(fields?.error_code ?? fields?.status ?? 0);
  return errorCode === 429 || message.includes("Too Many Requests");
}

function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const fields = error as Record<string, unknown>;
  const parameters = fields.parameters && typeof fields.parameters === "object"
    ? fields.parameters as Record<string, unknown>
    : undefined;
  const retryAfterRaw = Number(parameters?.retry_after ?? 0);
  if (Number.isFinite(retryAfterRaw) && retryAfterRaw > 0) {
    return retryAfterRaw * 1000;
  }
  const description = String(fields.description ?? fields.message ?? "");
  const match = description.match(/retry after\s+(\d+)/i);
  if (!match) return null;
  const retryAfter = Number.parseInt(match[1], 10);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
}

function isIgnorableTelegramEditError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("message is not modified");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Telegram API call timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  (error as Error & { code?: string }).code = "ETIMEDOUT";
  return error;
}

async function withAttemptTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await fn();
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      fn(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  fn: () => Promise<T>,
  policy?: TelegramRetryPolicy
): Promise<T> {
  let lastError: unknown;
  const timeoutMs =
    Number.isFinite(policy?.requestTimeoutMs) && Number(policy?.requestTimeoutMs) > 0
      ? Number(policy?.requestTimeoutMs)
      : TELEGRAM_API_ATTEMPT_TIMEOUT_MS;

  for (let attempt = 0; attempt < SEND_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = attempt === 0 ? 0 : SEND_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      return await withAttemptTimeout(fn, timeoutMs);
    } catch (error) {
      lastError = error;
      if (isIgnorableTelegramEditError(error)) {
        return undefined as T;
      }
      if (!isRetryableTelegramSendError(error) || attempt === SEND_RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
      const retryAfterMs = getRetryAfterMs(error);
      if (
        isTelegramRateLimitError(error) &&
        (
          policy?.failOnRateLimit ||
          (
            Number.isFinite(policy?.maxRetryAfterMs) &&
            retryAfterMs != null &&
            retryAfterMs > Number(policy?.maxRetryAfterMs)
          )
        )
      ) {
        throw error;
      }
      momWarn("telegram", logEvent, {
        ...metadata,
        attempt: attempt + 1,
        requestTimeoutMs: timeoutMs,
        nextDelayMs: retryAfterMs ?? SEND_RETRY_DELAYS_MS[attempt + 1],
        error: error instanceof Error ? error.message : String(error),
        errorDetails: extractTelegramErrorDetails(error)
      });
      if (retryAfterMs && retryAfterMs > 0) {
        await wait(retryAfterMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Telegram API call failed"));
}

export async function editTelegramText(
  bot: Bot,
  chatId: string,
  messageId: number,
  text: string,
  retryPolicy?: TelegramRetryPolicy
): Promise<void> {
  const payload = formatTelegramText(text);
  try {
    if (payload.parseMode) {
      await retryTelegramApiCall(
        "edit_message_retry_scheduled",
        { chatId, messageId, mode: "formatted" },
        async () => {
          await bot.api.editMessageText(chatId, messageId, payload.text, { parse_mode: payload.parseMode } as never);
        },
        retryPolicy
      );
      return;
    }
    await retryTelegramApiCall(
      "edit_message_retry_scheduled",
      { chatId, messageId, mode: "plain" },
      async () => {
        await bot.api.editMessageText(chatId, messageId, payload.text);
      },
      retryPolicy
    );
  } catch (error) {
    if (isTelegramRateLimitError(error) && (retryPolicy?.failOnRateLimit || Number.isFinite(retryPolicy?.maxRetryAfterMs))) {
      throw error;
    }
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

export async function editTelegramMessage(
  bot: Bot,
  chatId: string,
  messageId: number,
  text: string,
  options?: Record<string, unknown>
): Promise<void> {
  const payload = formatTelegramText(text);
  const editOptions = payload.parseMode
    ? { ...(options ?? {}), parse_mode: payload.parseMode }
    : { ...(options ?? {}) };

  try {
    await retryTelegramApiCall(
      "edit_message_retry_scheduled",
      { chatId, messageId, mode: payload.parseMode ? "formatted" : "plain" },
      async () => {
        await bot.api.editMessageText(chatId, messageId, payload.text, editOptions as never);
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
          await bot.api.editMessageText(chatId, messageId, text, options as never);
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
  action: "typing" | "upload_photo" | "record_voice",
  options?: Record<string, unknown>
): Promise<void> {
  await retryTelegramApiCall(
    "send_chat_action_retry_scheduled",
    { chatId, action },
    async () => {
      await bot.api.sendChatAction(chatId, action, options as never);
    }
  );
}
