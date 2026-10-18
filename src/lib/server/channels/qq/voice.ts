/**
 * QQ 语音消息发送。
 *
 * QQ 富媒体语音接口原生接受 WAV / MP3 / SILK 三种格式；其他格式
 * （ogg/opus/aac/flac/m4a 等）需要转码：ffmpeg 解码为 24kHz 单声道
 * s16le PCM → silk-wasm 编码为 SILK。转码失败时显式降级为文件发送；
 * 语音上传被平台拒绝时由 sendMedia 内置的语音→文件降级兜底。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { encode as encodeSilk, isSilk } from "silk-wasm";
import { transcodeAudio } from "$lib/server/channels/shared/audio.js";
import { sendMedia, type OutboundResult } from "#qqbot/src/outbound.js";
import { MediaFileType } from "#qqbot/src/api.js";
import type { ResolvedQQBotAccount } from "#qqbot/src/types.js";

/** QQ 语音接口无需转码的格式 */
const NATIVE_VOICE_EXTENSIONS = [".wav", ".mp3", ".silk"];

/**
 * 判断音频文件是否可直传为 QQ 语音（扩展名 wav/mp3/silk，或文件头为 SILK 魔数）。
 */
export function isNativeQqVoiceFormat(filePath: string, buffer?: Buffer): boolean {
  const ext = extname(filePath).toLowerCase();
  if (NATIVE_VOICE_EXTENSIONS.includes(ext)) return true;
  if (buffer && buffer.length > 0) {
    try {
      return isSilk(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    } catch {
      return false;
    }
  }
  return false;
}

/** 判断是否应按语音消息发送（MIME 优先，扩展名回退） */
export function isAudioSource(filePath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith("audio/")) return true;
  const ext = extname(filePath).toLowerCase();
  return [
    ".mp3", ".wav", ".silk", ".slk", ".amr", ".opus", ".ogg", ".m4a", ".aac", ".flac", ".wma",
  ].includes(ext);
}

interface QqVoiceParams {
  account: ResolvedQQBotAccount;
  to: string;
  filePath: string;
  replyToId?: string | null;
  text?: string;
}

/**
 * 以 QQ 语音消息发送音频文件；非原生格式先转码为 SILK，转码失败降级为文件发送。
 */
export async function sendQqVoice(params: QqVoiceParams): Promise<OutboundResult> {
  const { account, to, filePath, replyToId, text } = params;

  const sendAsVoice = (mediaUrl: string): Promise<OutboundResult> =>
    sendMedia({
      to,
      text: text ?? "",
      mediaUrl,
      accountId: account.accountId,
      replyToId,
      account,
    });

  const sendAsFile = (): Promise<OutboundResult> =>
    sendMedia({
      to,
      text: text ?? "",
      mediaUrl: filePath,
      accountId: account.accountId,
      replyToId,
      account,
      fileType: MediaFileType.FILE,
    });

  if (isNativeQqVoiceFormat(filePath)) {
    const result = await sendAsVoice(filePath);
    return result.error ? sendAsFile() : result;
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    return sendAsFile();
  }
  if (isNativeQqVoiceFormat(filePath, buffer)) {
    const result = await sendAsVoice(filePath);
    return result.error ? sendAsFile() : result;
  }

  // 转码：ffmpeg → 24kHz 单声道 s16le PCM → silk-wasm 编码
  let tempDir: string | null = null;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "molibot-qq-voice-"));
    const baseName = basename(filePath, extname(filePath));
    const pcmPath = join(tempDir, `${baseName}.pcm`);
    await transcodeAudio(filePath, pcmPath, ["-f", "s16le", "-ar", "24000", "-ac", "1"]);
    const pcm = readFileSync(pcmPath);
    const encoded = await encodeSilk(
      new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
      24000
    );
    const silkBuffer = Buffer.from(encoded.data.buffer, encoded.data.byteOffset, encoded.data.byteLength);
    const silkPath = join(tempDir, `${baseName}.silk`);
    writeFileSync(silkPath, silkBuffer);

    const result = await sendAsVoice(silkPath);
    return result.error ? sendAsFile() : result;
  } catch {
    return sendAsFile();
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
