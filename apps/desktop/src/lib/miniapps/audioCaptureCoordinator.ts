import { invoke } from "@tauri-apps/api/core";
import { postDesktopMiniAppAudio } from "../api";
import { session } from "../stores/session.svelte";

interface NativeCaptureStarted {
  captureId: string;
  sampleRate: number;
  channels: number;
}

interface NativeCaptureStatus {
  captureId: string;
  appId: string;
  meetingId: string;
  trackId: string;
  state: "recording" | "paused" | "stopped";
  pendingChunks: number;
  expectedLastSeq: number | null;
  durationMs: number;
  error: string | null;
}

interface NativeCaptureChunk {
  captureId: string;
  seq: number;
  startMs: number;
  endMs: number;
  mimeType: string;
  audioBase64: string;
}

export type AudioCaptureView = NativeCaptureStatus & { uploadError: string };

let current: NativeCaptureStatus | null = null;
let uploadError = "";
let polling: ReturnType<typeof setInterval> | null = null;
let pumping = false;

async function nativeStatus(): Promise<NativeCaptureStatus | null> {
  current = await invoke<NativeCaptureStatus | null>("meeting_capture_status");
  return current;
}

async function pumpOne(): Promise<boolean> {
  if (!current || !session.endpoint) return false;
  const chunk = await invoke<NativeCaptureChunk | null>("next_meeting_capture_chunk", { captureId: current.captureId });
  if (!chunk) return false;
  await postDesktopMiniAppAudio(session.endpoint, {
    action: "chunk",
    appId: current.appId,
    meetingId: current.meetingId,
    trackId: current.trackId,
    seq: chunk.seq,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
    mimeType: chunk.mimeType,
    audioBase64: chunk.audioBase64
  });
  await invoke("acknowledge_meeting_capture_chunk", { captureId: current.captureId, seq: chunk.seq });
  uploadError = "";
  return true;
}

async function pumpAvailable(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (await pumpOne()) {
      // Drain in order. Native acknowledgement gives uploads at-least-once;
      // the Mini App's `(trackId, seq)` key makes a replay idempotent.
    }
    await nativeStatus();
  } catch (cause) {
    uploadError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    pumping = false;
  }
}

function ensurePolling(): void {
  if (polling) return;
  polling = setInterval(() => void pumpAvailable(), 1_000);
}

function stopPolling(): void {
  if (polling) clearInterval(polling);
  polling = null;
}

export async function startMiniAppAudioCapture(appId: string, meetingId: string, trackId: string): Promise<AudioCaptureView> {
  const existing = await nativeStatus();
  if (existing) throw new Error("Another meeting is already using the microphone.");
  const started = await invoke<NativeCaptureStarted>("start_meeting_capture", { appId, meetingId, trackId });
  current = {
    captureId: started.captureId,
    appId,
    meetingId,
    trackId,
    state: "recording",
    pendingChunks: 0,
    expectedLastSeq: null,
    durationMs: 0,
    error: null
  };
  uploadError = "";
  ensurePolling();
  return { ...current, uploadError };
}

export async function pauseMiniAppAudioCapture(appId: string): Promise<AudioCaptureView> {
  const status = await nativeStatus();
  if (!status || status.appId !== appId) throw new Error("This Mini App has no active audio capture.");
  if (status.state === "stopped") throw new Error("This audio capture has already stopped.");
  current = status.state === "paused"
    ? status
    : await invoke<NativeCaptureStatus>("pause_meeting_capture", { captureId: status.captureId });
  await pumpAvailable();
  return { ...current, uploadError };
}

export async function resumeMiniAppAudioCapture(appId: string): Promise<AudioCaptureView> {
  const status = await nativeStatus();
  if (!status || status.appId !== appId) throw new Error("This Mini App has no active audio capture.");
  if (status.state === "stopped") throw new Error("This audio capture has already stopped.");
  current = status.state === "recording"
    ? status
    : await invoke<NativeCaptureStatus>("resume_meeting_capture", { captureId: status.captureId });
  return { ...current, uploadError };
}

export async function miniAppAudioCaptureStatus(appId: string): Promise<AudioCaptureView | null> {
  const status = await nativeStatus();
  if (!status || status.appId !== appId) return null;
  ensurePolling();
  return { ...status, uploadError };
}

export async function stopMiniAppAudioCapture(appId: string): Promise<AudioCaptureView> {
  let status = await nativeStatus();
  if (!status || status.appId !== appId) throw new Error("This Mini App has no active audio capture.");
  if (status.state !== "stopped") {
    status = await invoke<NativeCaptureStatus>("stop_meeting_capture", { captureId: status.captureId });
    current = status;
  }
  await pumpAvailable();
  status = await nativeStatus();
  if (!status) throw new Error("Audio capture ended unexpectedly.");
  if (status.pendingChunks > 0 || uploadError) {
    throw new Error(uploadError || "Audio chunks are still waiting to upload.");
  }
  if (status.expectedLastSeq === null) throw new Error("No audio was captured.");
  if (!session.endpoint) throw new Error("Molibot service is unavailable.");
  await postDesktopMiniAppAudio(session.endpoint, {
    action: "finish",
    appId: status.appId,
    meetingId: status.meetingId,
    trackId: status.trackId,
    expectedLastSeq: status.expectedLastSeq,
    endMs: status.durationMs,
    captureError: status.error || ""
  });
  await invoke("close_meeting_capture", { captureId: status.captureId });
  current = null;
  stopPolling();
  return { ...status, state: "stopped", pendingChunks: 0, uploadError: "" };
}
