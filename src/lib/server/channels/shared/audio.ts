import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname } from "node:path";

/**
 * Transcode an audio file using ffmpeg.
 * Throws on failure — the caller should catch and handle the fallback.
 */
export function transcodeAudio(
  inputPath: string,
  outputPath: string,
  ffmpegArgs: string[],
  spawnFn: typeof nodeSpawn = nodeSpawn,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = ["-i", inputPath, ...ffmpegArgs, "-y", outputPath];
    const child: ChildProcess = spawnFn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    const onAbort = () => {
      child.kill();
      reject(new Error("Audio transcode aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg transcode failed: ${
              stderr.trim().slice(-300) || `exit ${code}`
            }`
          )
        );
        return;
      }
      resolve();
    });
  });
}

export interface VoiceFallbackOptions {
  /** Path to the audio file on disk. */
  filePath: string;
  /** Display filename (used for the voice/file attachment name). */
  name: string;
  /** Detected audio MIME type (e.g. "audio/ogg", "audio/mpeg"). */
  mimeType: string;
  /** Returns true if the MIME type is natively supported as a voice message by this channel. */
  isVoiceReady: (mimeType: string) => boolean;
  /** ffmpeg args (after the input file) to convert to the channel's voice format. */
  transcodeArgs: string[];
  /** Output file extension for the transcoded file (e.g. ".ogg", ".opus"). */
  outputExt: string;
  /** MIME type after transcoding (informational). */
  outputMime: string;
  /** Send the audio as a voice message. Receives the path and display name. */
  sendVoice: (path: string, name: string) => Promise<void>;
  /** Send the audio as a regular file attachment (fallback when transcode fails). */
  sendFile: (path: string, name: string) => Promise<void>;
}

/**
 * Send an audio file as a voice message with automatic format conversion and fallback.
 *
 * Flow:
 * 1. If the format is already voice-ready → send directly as voice.
 * 2. If not → transcode via ffmpeg, then send as voice.
 * 3. If transcode or voice-send fails → fall back to sending as a regular file.
 *
 * Callers should wrap this in their own try/catch — if even the file fallback
 * fails, the error propagates up so the channel can use its last-resort fallback
 * (e.g. sendDocument on Telegram).
 */
export async function sendVoiceWithFallback(
  opts: VoiceFallbackOptions
): Promise<void> {
  const {
    filePath,
    name,
    mimeType,
    isVoiceReady,
    transcodeArgs,
    outputExt,
    sendVoice,
    sendFile
  } = opts;

  // Case 1: Format is already voice-ready — send directly.
  if (isVoiceReady(mimeType)) {
    try {
      await sendVoice(filePath, name);
      return;
    } catch {
      // Voice send failed even with native format — fall back to file.
      await sendFile(filePath, name);
      return;
    }
  }

  // Case 2: Need to transcode.
  const tempDir = mkdtempSync(`${tmpdir()}/molibot-voice-`);
  const baseName = basename(filePath, extname(filePath));
  const outputPath = `${tempDir}/${baseName}${outputExt}`;

  try {
    await transcodeAudio(filePath, outputPath, transcodeArgs);
    const transcodedName = `${baseName}${outputExt}`;
    await sendVoice(outputPath, transcodedName);
  } catch {
    // Transcode or voice-send failed — fall back to sending the original file.
    await sendFile(filePath, name);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
