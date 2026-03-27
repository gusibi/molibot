import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname } from "node:path";
import { momWarn } from "../../agent/log.js";
import { loadCredentials } from "./sdk/auth.js";
import { CHANNEL_VERSION, apiFetch, sendMessage } from "./sdk/api.js";
import { MessageItemType, MessageState, MessageType, type MessageItem } from "./sdk/types.js";

const WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const execFileAsync = promisify(execFile);

const EXTENSION_TO_MIME: Record<string, string> = {
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
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

function splitForLog(value: string, chunkSize = 320): string[] {
  const text = String(value ?? "");
  if (!text) return [];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
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

function encodeMessageAesKey(aesKeyHex: string): string {
  return Buffer.from(aesKeyHex, "utf8").toString("base64");
}

interface PreparedAudioPayload {
  filePath: string;
  plaintext: Buffer;
  mimeType: string;
  cleanup: () => void;
}

function inferWechatAudioAttachmentStrategy(filePath: string, mimeType: string): {
  needsTranscode: boolean;
  targetMimeType: string;
  outputName: string;
  ffmpegArgs?: string[];
} {
  const lowerExt = extname(filePath).toLowerCase();
  if (lowerExt === ".mp3" || mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return { needsTranscode: false, targetMimeType: "audio/mpeg", outputName: basename(filePath) };
  }
  if (mimeType.startsWith("audio/")) {
    return {
      needsTranscode: true,
      targetMimeType: "audio/mpeg",
      outputName: `${basename(filePath, extname(filePath)) || "audio"}.mp3`,
      ffmpegArgs: [
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "48k"
      ]
    };
  }
  return { needsTranscode: false, targetMimeType: mimeType, outputName: basename(filePath) };
}

async function prepareWechatAudioAttachment(filePath: string, plaintext: Buffer, mimeType: string): Promise<PreparedAudioPayload> {
  const strategy = inferWechatAudioAttachmentStrategy(filePath, mimeType);
  if (!strategy.needsTranscode) {
    return {
      filePath,
      plaintext,
      mimeType,
      cleanup: () => {}
    };
  }

  const tempDir = mkdtempSync(`${tmpdir()}/molibot-weixin-audio-`);
  const outputPath = `${tempDir}/${strategy.outputName}`;

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      filePath,
      ...(strategy.ffmpegArgs ?? []),
      outputPath
    ], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024
    });

    const transcoded = readFileSync(outputPath);
    return {
      filePath: outputPath,
      plaintext: transcoded,
      mimeType: strategy.targetMimeType,
      cleanup: () => {
        rmSync(tempDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    try {
      const marker = `${tempDir}/ffmpeg-error.txt`;
      writeFileSync(marker, error instanceof Error ? error.message : String(error));
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`wechat_audio_transcode_failed:${error instanceof Error ? error.message : String(error)}`);
  }
}

async function uploadBufferToCdn(params: {
  plaintext: Buffer;
  uploadParam: string;
  fileKey: string;
  cdnBaseUrl: string;
  aesKey: Buffer;
  mediaType: UploadMediaType;
  sourceName: string;
}): Promise<string> {
  const ciphertext = encryptAesEcb(params.plaintext, params.aesKey);
  const url = new URL(
    `upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.fileKey)}`,
    ensureTrailingSlash(params.cdnBaseUrl)
  );
  const wechatUin = randomWechatUin();
  momWarn("weixin", "cdn_upload_request", {
    source: params.sourceName,
    mediaType: params.mediaType,
    cdnUrl: url.toString(),
    cdnHost: url.origin,
    cdnPath: url.pathname,
    fileKey: params.fileKey,
    uploadParamChunks: splitForLog(params.uploadParam),
    plaintextSize: params.plaintext.length,
    ciphertextSize: ciphertext.length,
    headers: {
      contentType: "application/octet-stream",
      contentLength: String(ciphertext.length),
      xWechatUin: wechatUin
    }
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(ciphertext.length),
      "X-WECHAT-UIN": wechatUin
    },
    body: new Uint8Array(ciphertext)
  });

  const raw = await response.text();
  const encryptedParamHeader = response.headers.get("x-encrypted-param")?.trim() || "";
  momWarn("weixin", "cdn_upload_response", {
    source: params.sourceName,
    mediaType: params.mediaType,
    status: response.status,
    statusText: response.statusText,
    responseBodyChunks: splitForLog(raw),
    responseHeaders: {
      xEncryptedParam: encryptedParamHeader
    }
  });
  if (!response.ok) {
    throw new Error(
      [
        `Weixin CDN upload failed ${response.status}: ${raw || "(empty body)"}`,
        `source=${params.sourceName}`,
        `mediaType=${params.mediaType}`,
        `cdnHost=${url.origin}`,
        `cdnPath=${url.pathname}`,
        `uploadParamLength=${params.uploadParam.length}`,
        `fileKey=${params.fileKey}`,
        `plaintextSize=${params.plaintext.length}`,
        `ciphertextSize=${ciphertext.length}`
      ].join(" | ")
    );
  }

  if (encryptedParamHeader) {
    return encryptedParamHeader;
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
    throw new Error(`Weixin CDN upload succeeded without x-encrypted-param/download param: ${raw}`);
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
  const requestBody = {
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
  };
  momWarn("weixin", "getuploadurl_request", {
    source: basename(params.filePath),
    mediaType: params.mediaType,
    baseUrl: params.baseUrl,
    requestBody
  });

  const uploadUrl = await apiFetch<UploadUrlResponse>(
    params.baseUrl,
    "/ilink/bot/getuploadurl",
    requestBody,
    params.token,
    15_000
  );
  momWarn("weixin", "getuploadurl_response", {
    source: basename(params.filePath),
    mediaType: params.mediaType,
    response: {
      upload_param: uploadUrl.upload_param,
      thumb_upload_param: uploadUrl.thumb_upload_param,
      ret: uploadUrl.ret,
      errcode: uploadUrl.errcode,
      errmsg: uploadUrl.errmsg,
      uploadParamChunks: splitForLog(uploadUrl.upload_param ?? ""),
      thumbUploadParamChunks: splitForLog(uploadUrl.thumb_upload_param ?? "")
    }
  });

  if (!uploadUrl.upload_param) {
    throw new Error(uploadUrl.errmsg || "Weixin getuploadurl returned no upload_param");
  }

  const downloadEncryptedQueryParam = await uploadBufferToCdn({
    plaintext: params.plaintext,
    uploadParam: uploadUrl.upload_param,
    fileKey,
    cdnBaseUrl: params.cdnBaseUrl,
    aesKey,
    mediaType: params.mediaType,
    sourceName: basename(params.filePath)
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
  sendCaptionAsText?: boolean;
  mediaItem: MessageItem;
}): Promise<void> {
  const items: MessageItem[] = [];
  const caption = String(params.caption ?? "").trim();
  if (caption && params.sendCaptionAsText !== false) {
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
  text?: string;
  baseUrlOverride?: string;
  cdnBaseUrl?: string;
}): Promise<"text" | "image" | "file"> {
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
  const text = params.text?.trim() || "";

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
          aeskey: uploaded.aesKeyHex,
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: encodeMessageAesKey(uploaded.aesKeyHex),
            encrypt_type: 1
          },
          mid_size: uploaded.fileSizeCiphertext
        }
      }
    });
    return "image";
  }

  const audioPayload = await prepareWechatAudioAttachment(params.filePath, plaintext, mimeType);
  try {
    const visibleText = text || caption;
    if (visibleText) {
      await sendMessage(baseUrl, credentials.token, {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: randomUUID(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: params.contextToken,
        item_list: [
          {
            type: MessageItemType.TEXT,
            text_item: { text: visibleText }
          }
        ]
      });
    }
    const uploaded = await uploadMedia({
      filePath: audioPayload.filePath,
      plaintext: audioPayload.plaintext,
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
      caption: "",
      sendCaptionAsText: false,
      mediaItem: {
        type: MessageItemType.FILE,
        file_item: {
          aeskey: uploaded.aesKeyHex,
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: encodeMessageAesKey(uploaded.aesKeyHex),
            encrypt_type: 1
          },
          file_name: basename(audioPayload.filePath),
          len: String(uploaded.fileSize)
        }
      }
    });
    momWarn("weixin", "upload_file_sent", {
      toUserId: params.toUserId,
      filePath: params.filePath,
      mode: "audio_file"
    });
    audioPayload.cleanup();
    return "file";
  } catch (error) {
    audioPayload.cleanup();
    throw error;
  }
}
