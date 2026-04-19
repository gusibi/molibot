import type * as lark from "@larksuiteoapi/node-sdk";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import { momWarn } from "../../agent/log.js";
import { markdownToFeishuMarkdown } from "./formatting.js";

const FEISHU_CARD_MARKDOWN_LIMIT = 3500;
const FEISHU_CARD_TITLE_LIMIT = 60;

type CardTone = "blue" | "green" | "yellow" | "orange" | "red" | "grey" | "wathet" | "indigo";

interface FeishuCardActionValue {
  action: "approve" | "deny";
  kind: "acp_permission";
  botId: string;
  chatId: string;
  requestId: string;
  optionId?: string;
}

interface StatusCardOptions {
  title: string;
  body: string;
  tone?: CardTone;
  note?: string;
}

interface PermissionCardOptions {
  botId: string;
  chatId: string;
}

function normalizeText(text: string): string {
  return String(text ?? "").replace(/\r\n?/g, "\n").trim();
}

function stripMarkdown(text: string): string {
  return normalizeText(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveCardTitle(text: string, fallback = "Molibot"): string {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => stripMarkdown(line))
    .filter(Boolean);
  const title = lines[0] || fallback;
  return Array.from(title).slice(0, FEISHU_CARD_TITLE_LIMIT).join("");
}

function chunkMarkdown(text: string, limit = FEISHU_CARD_MARKDOWN_LIMIT): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (Array.from(normalized).length <= limit) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (Array.from(candidate).length <= limit) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (Array.from(paragraph).length <= limit) {
      current = paragraph;
      continue;
    }

    let lineChunk = "";
    for (const line of paragraph.split("\n")) {
      const lineCandidate = lineChunk ? `${lineChunk}\n${line}` : line;
      if (Array.from(lineCandidate).length <= limit) {
        lineChunk = lineCandidate;
        continue;
      }
      if (lineChunk) chunks.push(lineChunk);
      lineChunk = line;
    }
    if (lineChunk) current = lineChunk;
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildReplyCard(text: string, partIndex = 0, totalParts = 1): lark.InteractiveCard {
  const titleBase = deriveCardTitle(text, "Molibot");
  const title = totalParts > 1 ? `${titleBase} (${partIndex + 1}/${totalParts})` : titleBase;
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true
    },
    header: {
      template: "indigo",
      title: {
        tag: "plain_text",
        content: title
      }
    },
    elements: [
      {
        tag: "markdown",
        content: text
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: totalParts > 1 ? "Long reply split into multiple cards." : "Rendered as a Feishu rich card."
          }
        ]
      }
    ]
  };
}

export function buildFeishuStatusCard(options: StatusCardOptions): lark.InteractiveCard {
  const body = normalizeText(options.body);
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true
    },
    header: {
      template: options.tone ?? "blue",
      title: {
        tag: "plain_text",
        content: options.title
      }
    },
    elements: [
      {
        tag: "markdown",
        content: body || "_No details_"
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: options.note ?? `Updated ${new Date().toLocaleString("zh-CN", { hour12: false })}`
          }
        ]
      }
    ]
  };
}

export function buildFeishuAcpPermissionCard(
  permission: AcpPendingPermissionView,
  options: PermissionCardOptions
): lark.InteractiveCard {
  const fields: lark.InteractiveCardField[] = [
    {
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**Request**\n${permission.id}`
      }
    },
    {
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**Kind**\n${permission.kind}`
      }
    }
  ];

  const actionButtons: lark.InteractiveCardActionItem[] = permission.options.slice(0, 3).map((option, index) => ({
    tag: "button",
    type: index === 0 ? "primary" : "default",
    text: {
      tag: "plain_text",
      content: option.name || option.optionId
    },
    value: {
      kind: "acp_permission",
      action: "approve",
      botId: options.botId,
      chatId: options.chatId,
      requestId: permission.id,
      optionId: option.optionId
    } satisfies FeishuCardActionValue
  }));

  actionButtons.push({
    tag: "button",
    type: "danger",
    text: {
      tag: "plain_text",
      content: "Reject"
    },
    value: {
      kind: "acp_permission",
      action: "deny",
      botId: options.botId,
      chatId: options.chatId,
      requestId: permission.id
    } satisfies FeishuCardActionValue
  });

  const optionLines = permission.options
    .map((option) => {
      const pieces = [option.name || option.optionId, option.description].filter(Boolean);
      return `- \`${option.optionId}\` ${pieces.join(" | ")}`.trim();
    })
    .join("\n");

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
      update_multi: true
    },
    header: {
      template: "orange",
      title: {
        tag: "plain_text",
        content: `Approval Needed: ${permission.title}`
      }
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: permission.inputPreview
            ? `**What needs approval**\n${permission.inputPreview}`
            : `**What needs approval**\n${permission.title}`
        },
        fields
      },
      {
        tag: "markdown",
        content: optionLines || "_No approval options returned_"
      },
      {
        tag: "action",
        layout: "flow",
        actions: actionButtons
      }
    ]
  };
}

export function buildFeishuAcpPermissionResultCard(
  permission: AcpPendingPermissionView,
  outcome: string,
  tone: CardTone = "green"
): lark.InteractiveCard {
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
      update_multi: true
    },
    header: {
      template: tone,
      title: {
        tag: "plain_text",
        content: `Approval ${tone === "green" ? "Handled" : "Failed"}`
      }
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${permission.title}**\n${outcome}`
        },
        fields: [
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Request**\n${permission.id}`
            }
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Kind**\n${permission.kind}`
            }
          }
        ]
      }
    ]
  };
}

export function formatFeishuText(text: string): string {
  return markdownToFeishuMarkdown(text);
}

export async function sendFeishuCard(
  client: lark.Client | undefined,
  chatId: string,
  card: lark.InteractiveCard
): Promise<{ message_id: string } | null> {
  if (!client || !chatId.trim()) return null;
  try {
    const res = await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card)
      }
    });
    return { message_id: res.data?.message_id || "" };
  } catch (error) {
    momWarn("feishu", "send_card_failed", { error: String(error) });
    return null;
  }
}

export async function editFeishuCard(
  client: lark.Client | undefined,
  messageId: string,
  card: lark.InteractiveCard
): Promise<string | null> {
  if (!client || !messageId.trim()) return null;
  try {
    await client.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card)
      }
    });
    return messageId;
  } catch (error) {
    momWarn("feishu", "edit_card_failed", { error: String(error) });
    return null;
  }
}

export async function sendFeishuStatusCard(
  client: lark.Client | undefined,
  chatId: string,
  options: StatusCardOptions
): Promise<{ message_id: string } | null> {
  return sendFeishuCard(client, chatId, buildFeishuStatusCard(options));
}

export async function editFeishuStatusCard(
  client: lark.Client | undefined,
  messageId: string,
  options: StatusCardOptions
): Promise<string | null> {
  return editFeishuCard(client, messageId, buildFeishuStatusCard(options));
}

export async function sendFeishuText(
  client: lark.Client | undefined,
  chatId: string,
  text: string
): Promise<{ message_id: string } | null> {
  if (!client || !text.trim()) return null;
  try {
    const formattedText = markdownToFeishuMarkdown(text);
    const chunks = chunkMarkdown(formattedText);
    let firstMessage: { message_id: string } | null = null;

    for (let index = 0; index < chunks.length; index += 1) {
      const card = buildReplyCard(chunks[index], index, chunks.length);
      const sent = await sendFeishuCard(client, chatId, card);
      if (!firstMessage) firstMessage = sent;
    }

    return firstMessage;
  } catch (error) {
    momWarn("feishu", "send_message_failed", { error: String(error) });
    return null;
  }
}

export async function editFeishuText(
  client: lark.Client | undefined,
  messageId: string,
  text: string
): Promise<string | null> {
  if (!client || !text.trim()) return null;
  const formattedText = markdownToFeishuMarkdown(text);
  const firstChunk = chunkMarkdown(formattedText)[0] ?? formattedText;
  return editFeishuCard(client, messageId, buildReplyCard(firstChunk));
}

function detectImageMime(filename: string, bytes: Buffer): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  if (lower.endsWith(".ico")) return "image/x-icon";

  if (bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47) {
    return "image/png";
  }

  if (bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (bytes.length >= 6 &&
    bytes.toString("ascii", 0, 6) === "GIF89a") {
    return "image/gif";
  }

  return null;
}

function detectAudioMime(filename: string, bytes: Buffer): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";

  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "ID3") return "audio/mpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }

  return null;
}

function resolveFeishuFileType(filename: string, bytes: Buffer): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "doc";
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) return "xls";
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) return "ppt";
  if (lower.endsWith(".mp4")) return "mp4";

  const audioMime = detectAudioMime(filename, bytes);
  if (audioMime === "audio/ogg") return "opus";

  return "stream";
}

function isLikelyTextBuffer(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const printable =
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte < 0x7f);
    if (!printable) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) < 0.15;
}

function canSendAsFeishuText(text: string): boolean {
  return text.trim().length > 0 && Array.from(text).length <= 12000;
}

async function sendFeishuMessageByType(
  client: lark.Client,
  chatId: string,
  msgType: string,
  content: Record<string, unknown>
): Promise<{ message_id: string } | null> {
  const res = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: msgType,
      content: JSON.stringify(content)
    }
  });
  return { message_id: res.data?.message_id || "" };
}

export async function sendFeishuFile(
  client: lark.Client | undefined,
  chatId: string,
  bytes: Buffer,
  filename: string
): Promise<{ message_id: string } | null> {
  if (!client || !filename.trim() || bytes.length === 0) return null;

  if (isLikelyTextBuffer(bytes)) {
    const text = bytes.toString("utf8");
    if (canSendAsFeishuText(text)) {
      return sendFeishuText(client, chatId, text);
    }
  }

  const imageMime = detectImageMime(filename, bytes);
  if (imageMime) {
    try {
      const uploaded = await client.im.image.create({
        data: {
          image_type: "message",
          image: bytes
        }
      });
      if (uploaded?.image_key) {
        return await sendFeishuMessageByType(client, chatId, "image", { image_key: uploaded.image_key });
      }
    } catch (error) {
      momWarn("feishu", "send_image_failed_fallback_file", {
        filename,
        imageMime,
        error: String(error)
      });
    }
  }

  try {
    const fileType = resolveFeishuFileType(filename, bytes);
    const uploaded = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: filename,
        file: bytes
      }
    });
    const fileKey = uploaded?.file_key;
    if (!fileKey) return null;

    if (fileType === "opus") {
      try {
        return await sendFeishuMessageByType(client, chatId, "audio", { file_key: fileKey });
      } catch (error) {
        momWarn("feishu", "send_audio_failed_fallback_file", {
          filename,
          error: String(error)
        });
      }
    }

    if (fileType === "mp4") {
      try {
        return await sendFeishuMessageByType(client, chatId, "media", { file_key: fileKey });
      } catch (error) {
        momWarn("feishu", "send_media_failed_fallback_file", {
          filename,
          error: String(error)
        });
      }
    }

    return await sendFeishuMessageByType(client, chatId, "file", { file_key: fileKey });
  } catch (error) {
    momWarn("feishu", "send_file_failed", { filename, error: String(error) });
    return null;
  }
}

export async function deleteFeishuMessage(
  client: lark.Client | undefined,
  messageId: string | null | undefined
): Promise<void> {
  if (!client || !messageId) return;
  try {
    await client.im.message.delete({
      path: { message_id: messageId }
    });
  } catch (error) {
    momWarn("feishu", "delete_message_failed", {
      messageId,
      error: String(error)
    });
  }
}
