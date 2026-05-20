export interface TelegramMessageEntityLike {
  type?: string;
  offset?: number;
  length?: number;
  user?: {
    is_bot?: boolean;
    username?: string;
  };
}

function normalizeBotUsername(botUsername: string): string {
  return botUsername.replace(/^@/, "").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionPattern(botUsername: string): RegExp | null {
  const normalized = normalizeBotUsername(botUsername);
  if (!normalized) return null;
  return new RegExp(`@${escapeRegExp(normalized)}(?=$|[^a-zA-Z0-9_])`, "ig");
}

function validEntitySpan(text: string, entity: TelegramMessageEntityLike): entity is TelegramMessageEntityLike & { offset: number; length: number } {
  return (
    Number.isInteger(entity.offset) &&
    Number.isInteger(entity.length) &&
    Number(entity.offset) >= 0 &&
    Number(entity.length) > 0 &&
    Number(entity.offset) + Number(entity.length) <= text.length
  );
}

function botMentionSpans(text: string, entities: TelegramMessageEntityLike[], botUsername: string): Array<{ offset: number; length: number }> {
  const normalized = normalizeBotUsername(botUsername);
  if (!normalized) return [];

  const spans: Array<{ offset: number; length: number }> = [];
  for (const entity of entities) {
    if (!validEntitySpan(text, entity)) continue;

    if (entity.type === "mention") {
      const mentioned = text.slice(entity.offset, entity.offset + entity.length).replace(/^@/, "").toLowerCase();
      if (mentioned === normalized) {
        spans.push({ offset: entity.offset, length: entity.length });
      }
      continue;
    }

    if (entity.type === "text_mention") {
      const username = entity.user?.username?.toLowerCase();
      if (entity.user?.is_bot && username === normalized) {
        spans.push({ offset: entity.offset, length: entity.length });
      }
    }
  }

  return spans;
}

export function isTelegramBotMention(text: string, entities: TelegramMessageEntityLike[], botUsername: string): boolean {
  if (botMentionSpans(text, entities, botUsername).length > 0) return true;
  return mentionPattern(botUsername)?.test(text) ?? false;
}

export function stripTelegramBotMention(text: string, entities: TelegramMessageEntityLike[], botUsername: string): string {
  const spans = botMentionSpans(text, entities, botUsername).sort((a, b) => b.offset - a.offset);
  let cleaned = text;

  for (const span of spans) {
    cleaned = `${cleaned.slice(0, span.offset)}${cleaned.slice(span.offset + span.length)}`;
  }

  const pattern = mentionPattern(botUsername);
  if (pattern) cleaned = cleaned.replace(pattern, "");

  return cleaned.trim();
}
