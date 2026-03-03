import type { ModelOption as SharedModelOption, ModelRoute as SharedModelRoute } from "../../settings/modelSwitch.js";

export interface StatusSession {
  statusMessageId: number | null;
  threadMessageIds: number[];
  accumulatedText: string;
  isWorking: boolean;
}

export type ModelOption = SharedModelOption;
export type ModelRoute = SharedModelRoute;

export interface TranscriptionResult {
  text: string | null;
  errorMessage: string | null;
}

export interface ParsedRelativeReminder {
  delayMs: number;
  reminderText: string;
  sourceText: string;
}
