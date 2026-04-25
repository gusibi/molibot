import type { ModelOption as SharedModelOption, ModelRoute as SharedModelRoute } from "../../settings/modelSwitch.js";

export interface StatusSession {
  statusMessageId: number | null;
  answerMessageId?: number | null;
  detailsMessageId?: number | null;
  threadMessageIds: number[];
  accumulatedText: string;
  progressText?: string;
  detailsText?: string;
  toolProgressEntries?: Array<{
    toolName: string;
    label: string;
    summary?: string;
    isError?: boolean;
  }>;
  isWorking: boolean;
}

export type ModelOption = SharedModelOption;
export type ModelRoute = SharedModelRoute;

export interface ParsedRelativeReminder {
  delayMs: number;
  reminderText: string;
  sourceText: string;
}
