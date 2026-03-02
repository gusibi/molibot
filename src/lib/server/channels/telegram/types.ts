import type { RuntimeSettings } from "../../settings/index.js";

export interface StatusSession {
  statusMessageId: number | null;
  threadMessageIds: number[];
  accumulatedText: string;
  isWorking: boolean;
}

export interface ModelOption {
  key: string;
  label: string;
  patch: Partial<RuntimeSettings>;
}

export type ModelRoute = "text" | "vision" | "stt" | "tts";

export interface TranscriptionResult {
  text: string | null;
  errorMessage: string | null;
}

export interface ParsedRelativeReminder {
  delayMs: number;
  reminderText: string;
  sourceText: string;
}
