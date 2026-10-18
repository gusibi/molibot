/**
 * QQ 入站消息文本构造（含平台自带语音转写）。
 */

interface InboundAttachmentLike {
  content_type: string;
  url: string;
  filename?: string;
  voice_wav_url?: string;
  asr_refer_text?: string;
}

/**
 * 入站消息文本：优先用户输入的文字；为空时使用 QQ 平台自带的语音转写
 * （asr_refer_text）；仍为空时按附件类型给出占位说明。
 */
export function buildInboundText(
  content: string | undefined,
  attachments: Array<InboundAttachmentLike>
): string {
  const trimmed = String(content ?? "").trim();
  if (trimmed) return trimmed;

  const transcriptions = attachments
    .map((attachment) => attachment.asr_refer_text?.trim())
    .filter((text): text is string => Boolean(text));
  if (transcriptions.length > 0) {
    return transcriptions.join("\n");
  }

  return fallbackTextForAttachments(attachments);
}

function fallbackTextForAttachments(attachments: Array<InboundAttachmentLike>): string {
  if (attachments.length === 0) return "";
  if (attachments.some((attachment) => attachment.content_type?.startsWith("audio/"))) {
    return "(voice message)";
  }
  if (attachments.some((attachment) => attachment.content_type?.startsWith("image/"))) {
    return "(image attachment)";
  }
  return "(attachment)";
}
