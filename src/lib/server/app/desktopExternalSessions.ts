import type {
  Channel,
  Conversation,
  ConversationMessage,
  ExternalChatType
} from "$lib/shared/types/message";
import type {
  DesktopExternalChannelGroup,
  DesktopExternalSession,
  DesktopExternalSessionsSummary,
  DesktopExternalTranscript,
  DesktopExternalTranscriptMessage
} from "$lib/shared/desktop";

// Only the four external channels in plan §7.2 are aggregated. `cli` and `web`
// are local and surfaced elsewhere.
const KNOWN_EXTERNAL_CHANNELS: readonly Channel[] = ["telegram", "feishu", "qq", "weixin"];

// Stable fallback when an old record has no sender display name: surface a
// short, non-identifying prefix of the external user id rather than the full id.
const SENDER_ID_PREVIEW = 8;

/**
 * Reduces a raw external user id to a short display preview. Full platform ids
 * are not display-meaningful and are not needed for the read-only list, so they
 * are truncated rather than passed through to the WebView.
 */
export function maskExternalUserId(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= SENDER_ID_PREVIEW) return trimmed;
  return `${trimmed.slice(0, SENDER_ID_PREVIEW)}…`;
}

/**
 * Projects a single external conversation into a credential-safe Desktop view.
 * Message content is never loaded for the list; only display metadata survives.
 * Missing `external` metadata (old records) falls back to stable defaults per
 * plan §7.2 rather than back-filling from the platform.
 */
export function buildDesktopExternalSession(conversation: Conversation): DesktopExternalSession {
  const ext = conversation.external;
  const senderName = (ext?.senderName ?? "").trim() || maskExternalUserId(conversation.externalUserId);
  const chatType: ExternalChatType = ext?.chatType ?? "private";
  const session: DesktopExternalSession = {
    id: conversation.id,
    title: conversation.title || "New Session",
    updatedAt: conversation.updatedAt,
    chatType,
    senderName,
    platform: ext?.platform ?? conversation.channel
  };
  if (ext?.senderAvatarUrl) session.senderAvatarUrl = ext.senderAvatarUrl;
  if (ext?.threadTitle) session.threadTitle = ext.threadTitle;
  if (ext?.botInstanceName) session.botInstanceName = ext.botInstanceName;
  return session;
}

export interface ExternalSessionEntry {
  conversation: Conversation;
  channel: Channel;
  externalUserId: string;
}

/**
 * Groups external sessions by channel in the plan's known order and projects
 * each through `buildDesktopExternalSession`. Channels with no sessions are
 * omitted; non-aggregated channels (cli/web) are filtered out.
 */
export function buildDesktopExternalSessionsSummary(
  sessions: readonly ExternalSessionEntry[]
): DesktopExternalSessionsSummary {
  const byChannel = new Map<Channel, Conversation[]>();
  for (const entry of sessions) {
    if (!KNOWN_EXTERNAL_CHANNELS.includes(entry.channel)) continue;
    const list = byChannel.get(entry.channel) ?? [];
    list.push(entry.conversation);
    byChannel.set(entry.channel, list);
  }

  const groups: DesktopExternalChannelGroup[] = [];
  let totalSessions = 0;
  for (const channel of KNOWN_EXTERNAL_CHANNELS) {
    const convs = byChannel.get(channel);
    if (!convs || convs.length === 0) continue;
    const items = convs.map(buildDesktopExternalSession);
    totalSessions += items.length;
    groups.push({ channel, total: items.length, sessions: items });
  }

  return { groups, counts: { totalSessions } };
}

/**
 * Projects a transcript message into a credential/path-safe Desktop view. The
 * on-disk `local` path is dropped — external attachments cannot be previewed
 * through the Web file endpoint, so only the display-safe fields survive.
 * `system` role messages are internal control directives and are filtered out.
 */
export function buildDesktopExternalTranscriptMessage(
  message: ConversationMessage
): DesktopExternalTranscriptMessage | null {
  if (message.role === "system") return null;
  const role: "user" | "assistant" = message.role === "assistant" ? "assistant" : "user";
  const projected: DesktopExternalTranscriptMessage = {
    id: message.id,
    role,
    content: message.content,
    createdAt: message.createdAt
  };
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    projected.attachments = message.attachments.map((attachment) => ({
      original: attachment.original,
      mediaType: attachment.mediaType,
      mimeType: attachment.mimeType,
      size: attachment.size
    }));
  }
  return projected;
}

/**
 * Builds a read-only external-channel transcript (plan §7.2). Combines the
 * session's display metadata (reusing the same projection as the list) with
 * its messages projected through `buildDesktopExternalTranscriptMessage`.
 * The transcript is read-only: callers must not expose write affordances.
 */
export function buildDesktopExternalTranscript(
  conversation: Conversation,
  messages: ConversationMessage[]
): DesktopExternalTranscript {
  const ext = conversation.external;
  const session = buildDesktopExternalSession(conversation);
  const transcript: DesktopExternalTranscript = {
    id: session.id,
    channel: session.platform,
    title: session.title,
    updatedAt: session.updatedAt,
    chatType: session.chatType,
    senderName: session.senderName,
    messages: messages
      .map(buildDesktopExternalTranscriptMessage)
      .filter((message): message is DesktopExternalTranscriptMessage => message !== null)
  };
  return transcript;
}
