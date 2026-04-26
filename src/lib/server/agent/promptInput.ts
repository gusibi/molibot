import { formatIsoInTimeZone, localDateKeyInTimeZone, normalizeTimeZone } from "../time.js";

interface PromptInputEnvelopeOptions {
  messageText: string;
  attachmentPaths?: string[];
  messageTimestamp?: string | number | Date;
  timezone: string;
}

function resolveMessageTimestamp(value: PromptInputEnvelopeOptions["messageTimestamp"]): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const ms = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
        return new Date(ms);
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function appendAttachmentBlock(baseText: string, attachmentPaths: string[]): string {
  if (attachmentPaths.length === 0) return baseText;
  return `${baseText}\n\n<channel_attachments>\n${attachmentPaths.join("\n")}\n</channel_attachments>`;
}

export function buildPromptInputEnvelope(options: PromptInputEnvelopeOptions): {
  modelMessage: string;
  persistedMessage: string;
} {
  const timeZone = normalizeTimeZone(options.timezone);
  const messageDate = resolveMessageTimestamp(options.messageTimestamp);
  const attachmentPaths = [...(options.attachmentPaths ?? [])].filter(Boolean);
  const receivedAt = formatIsoInTimeZone(messageDate, timeZone);
  const today = localDateKeyInTimeZone(messageDate, timeZone);
  const persistedMessage = appendAttachmentBlock(options.messageText, attachmentPaths);
  const modelMessage = appendAttachmentBlock(
    [
      "<env>",
      `message_received_at: ${receivedAt}`,
      `timezone: ${timeZone}`,
      `today: ${today}`,
      "</env>",
      "",
      "<user_message>",
      options.messageText,
      "</user_message>"
    ].join("\n"),
    attachmentPaths
  );

  return {
    modelMessage,
    persistedMessage
  };
}
