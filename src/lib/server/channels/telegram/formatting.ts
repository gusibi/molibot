import type { Bot } from "grammy";
import { momWarn } from "../../agent/log.js";

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
  try {
    const sendOptions = payload.parseMode
      ? { ...(options ?? {}), parse_mode: payload.parseMode }
      : { ...(options ?? {}) };
    return (await bot.api.sendMessage(chatId, payload.text, sendOptions as never)) as { message_id: number };
  } catch (error) {
    if (payload.parseMode) {
      momWarn("telegram", "send_message_parse_fallback_plain", {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return (await bot.api.sendMessage(chatId, text, (options ?? {}) as never)) as { message_id: number };
    }
    throw error;
  }
}

export async function editTelegramText(bot: Bot, chatId: string, messageId: number, text: string): Promise<void> {
  const payload = formatTelegramText(text);
  try {
    if (payload.parseMode) {
      await bot.api.editMessageText(chatId, messageId, payload.text, { parse_mode: payload.parseMode } as never);
      return;
    }
    await bot.api.editMessageText(chatId, messageId, payload.text);
  } catch (error) {
    if (payload.parseMode) {
      momWarn("telegram", "edit_message_parse_fallback_plain", {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      await bot.api.editMessageText(chatId, messageId, text);
      return;
    }
    throw error;
  }
}
