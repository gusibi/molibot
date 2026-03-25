import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadCredentials } from "../../../../../node_modules/@pinixai/weixin-bot/src/auth.ts";
import { CHANNEL_VERSION, apiFetch, sendMessage } from "../../../../../node_modules/@pinixai/weixin-bot/src/api.ts";
import { MessageItemType, MessageState, MessageType } from "../../../../../node_modules/@pinixai/weixin-bot/src/types.ts";

const WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

const EXTENSION_TO_MIME: Record<string, string> = {
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".md": "text/markdown",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".silk": "audio/silk",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webp": "image/webp"
};

type UploadMediaType = 1 | 2 | 3 | 4;

interface UploadUrlResponse {
  upload_param?: string;
  thumb_upload_param?: string;
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

interface UploadBufferResponse {
  downloadParam?: string;
  download_param?: string;
  encrypt_query_param?: string;
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function paddedSize(size: number): number {
  const remainder = size % 16;
  return remainder === 0 ? size + 16 : size + (16 - remainder);
}

function encryptAesEcb(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function detectImageMimeType(data: Buffer): string | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (data.length >= 4 && data.subarray(0, 4).toString("utf8") === "<svg") {
    return "image/svg+xml";
  }
  return null;
}

function inferMimeType(filePath: string, data: Buffer): string {
  const imageMime = detectImageMimeType(data);
  if (imageMime) return imageMime;
  return EXTENSION_TO_MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function inferVoiceEncodeType(filePath: string, mimeType: string): number | null {
  const lowerExt = extname(filePath).toLowerCase();
  if (lowerExt === ".wav" || mimeType.includes("wav")) return 1;
  if (lowerExt === ".amr" || mimeType.includes("amr")) return 5;
  if (lowerExt === ".silk" || mimeType.includes("silk")) return 6;
  if (lowerExt === ".mp3" || mimeType.includes("mpeg") || mimeType.includes("mp3")) return 7;
  return null;
}

function normalizeInlineText(filePath: string, data: Buffer): string | null {
  const ext = extname(filePath).toLowerCase();
  if (![".txt", ".md", ".json", ".csv", ".log"].includes(ext)) return null;
  try {
    const text = data.toString("utf8").trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

async function uploadBufferToCdn(params: {
  plaintext: Buffer;
  uploadParam: string;
  fileKey: string;
  cdnBaseUrl: string;
  aesKey: Buffer;
}): Promise<string> {
  const ciphertext = encryptAesEcb(params.plaintext, params.aesKey);
  const url = new URL(
    `upload?filekey=${encodeURIComponent(params.fileKey)}&upload_param=${encodeURIComponent(params.uploadParam)}`,
    ensureTrailingSlash(params.cdnBaseUrl)
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(ciphertext.length),
      "X-WECHAT-UIN": randomWechatUin(),
      "X-WECHAT-FILEKEY": params.fileKey
    },
    body: new Uint8Array(ciphertext)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Weixin CDN upload failed ${response.status}: ${raw}`);
  }

  const payload = (raw ? JSON.parse(raw) : {}) as UploadBufferResponse;
  if (typeof payload.ret === "number" && payload.ret !== 0) {
    throw new Error(payload.errmsg || `Weixin CDN upload failed ret=${payload.ret}`);
  }

  const downloadParam =
    payload.downloadParam ??
    payload.download_param ??
    payload.encrypt_query_param;
  if (!downloadParam) {
    throw new Error(`Weixin CDN upload succeeded without download param: ${raw}`);
  }
  return String(downloadParam);
}

async function uploadMedia(params: {
  filePath: string;
  plaintext: Buffer;
  toUserId: string;
  token: string;
  baseUrl: string;
  cdnBaseUrl: string;
  mediaType: UploadMediaType;
}): Promise<{ downloadEncryptedQueryParam: string; aesKeyHex: string; fileSize: number; fileSizeCiphertext: number }> {
  const aesKey = randomBytes(16);
  const aesKeyHex = aesKey.toString("hex");
  const rawSize = params.plaintext.length;
  const rawFileMd5 = createHash("md5").update(params.plaintext).digest("hex");
  const fileSizeCiphertext = paddedSize(rawSize);
  const fileKey = randomBytes(16).toString("hex");

  const uploadUrl = await apiFetch<UploadUrlResponse>(
    params.baseUrl,
    "/ilink/bot/getuploadurl",
    {
      filekey: fileKey,
      media_type: params.mediaType,
      to_user_id: params.toUserId,
      rawsize: rawSize,
      rawfilemd5: rawFileMd5,
      filesize: fileSizeCiphertext,
      no_need_thumb: true,
      aeskey: aesKeyHex,
      base_info: {
        channel_version: CHANNEL_VERSION
      }
    },
    params.token,
    15_000
  );

  if (!uploadUrl.upload_param) {
    throw new Error(uploadUrl.errmsg || "Weixin getuploadurl returned no upload_param");
  }

  const downloadEncryptedQueryParam = await uploadBufferToCdn({
    plaintext: params.plaintext,
    uploadParam: uploadUrl.upload_param,
    fileKey,
    cdnBaseUrl: params.cdnBaseUrl,
    aesKey
  });

  return {
    downloadEncryptedQueryParam,
    aesKeyHex,
    fileSize: rawSize,
    fileSizeCiphertext
  };
}

async function sendMediaMessage(params: {
  toUserId: string;
  contextToken: string;
  token: string;
  baseUrl: string;
  caption?: string;
  mediaItem: Record<string, unknown>;
}): Promise<void> {
  const items: Array<Record<string, unknown>> = [];
  const caption = String(params.caption ?? "").trim();
  if (caption) {
    items.push({
      type: MessageItemType.TEXT,
      text_item: { text: caption }
    });
  }
  items.push(params.mediaItem);

  for (const item of items) {
    await sendMessage(params.baseUrl, params.token, {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: randomUUID(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: params.contextToken,
      item_list: [item]
    });
  }
}

export async function sendWeixinFile(params: {
  filePath: string;
  credentialsPath: string;
  toUserId: string;
  contextToken: string;
  caption?: string;
  baseUrlOverride?: string;
  cdnBaseUrl?: string;
}): Promise<"text" | "image" | "voice" | "file"> {
  const credentials = await loadCredentials(params.credentialsPath);
  if (!credentials?.token) {
    throw new Error(`Weixin credentials not found at ${params.credentialsPath}`);
  }

  const plaintext = readFileSync(params.filePath);
  const inlineText = normalizeInlineText(params.filePath, plaintext);
  if (inlineText) {
    await sendMessage(
      params.baseUrlOverride || credentials.baseUrl,
      credentials.token,
      {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: randomUUID(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: params.contextToken,
        item_list: [
          {
            type: MessageItemType.TEXT,
            text_item: { text: inlineText }
          }
        ]
      }
    );
    return "text";
  }

  const baseUrl = params.baseUrlOverride || credentials.baseUrl;
  const cdnBaseUrl = params.cdnBaseUrl || WEIXIN_CDN_BASE_URL;
  const mimeType = inferMimeType(params.filePath, plaintext);
  const caption = params.caption?.trim() || "";

  if (mimeType.startsWith("image/")) {
    const uploaded = await uploadMedia({
      filePath: params.filePath,
      plaintext,
      toUserId: params.toUserId,
      token: credentials.token,
      baseUrl,
      cdnBaseUrl,
      mediaType: 1
    });
    await sendMediaMessage({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      token: credentials.token,
      baseUrl,
      caption,
      mediaItem: {
        type: MessageItemType.IMAGE,
        image_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aesKeyHex, "hex").toString("base64"),
            encrypt_type: 1
          },
          mid_size: uploaded.fileSizeCiphertext
        }
      }
    });
    return "image";
  }

  const voiceEncodeType = inferVoiceEncodeType(params.filePath, mimeType);
  let voiceFailure: string | null = null;
  if (voiceEncodeType != null) {
    try {
      const uploaded = await uploadMedia({
        filePath: params.filePath,
        plaintext,
        toUserId: params.toUserId,
        token: credentials.token,
        baseUrl,
        cdnBaseUrl,
        mediaType: 4
      });
      await sendMediaMessage({
        toUserId: params.toUserId,
        contextToken: params.contextToken,
        token: credentials.token,
        baseUrl,
        caption,
        mediaItem: {
          type: MessageItemType.VOICE,
          voice_item: {
            media: {
              encrypt_query_param: uploaded.downloadEncryptedQueryParam,
              aes_key: Buffer.from(uploaded.aesKeyHex, "hex").toString("base64"),
              encrypt_type: 1
            },
            encode_type: voiceEncodeType
          }
        }
      });
      return "voice";
    } catch (error) {
      voiceFailure = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const uploaded = await uploadMedia({
      filePath: params.filePath,
      plaintext,
      toUserId: params.toUserId,
      token: credentials.token,
      baseUrl,
      cdnBaseUrl,
      mediaType: 3
    });
    await sendMediaMessage({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      token: credentials.token,
      baseUrl,
      caption,
      mediaItem: {
        type: MessageItemType.FILE,
        file_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aesKeyHex, "hex").toString("base64"),
            encrypt_type: 1
          },
          file_name: basename(params.filePath),
          len: String(uploaded.fileSize)
        }
      }
    });
    return "file";
  } catch (error) {
    const fileFailure = error instanceof Error ? error.message : String(error);
    if (voiceFailure) {
      throw new Error(`voice_send_failed=${voiceFailure}; file_send_failed=${fileFailure}`);
    }
    throw error;
  }
}
