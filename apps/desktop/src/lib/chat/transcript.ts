import type { DesktopConversationActivity, DesktopConversationPlan, DesktopConversationStep, DesktopConversationTokenUsage, DesktopFileMediaType, DesktopMessageMemoryTraceMeta, DesktopSessionFile } from "@molibot/desktop-contract";

export type TranscriptAttachment = {
  original: string;
  local?: string;
  mediaType: DesktopFileMediaType;
  mimeType?: string;
  size?: number;
};

export type TranscriptMessage = {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  model?: string;
  thinking?: string;
  stopReason?: string;
  errorMessage?: string;
  attachments?: TranscriptAttachment[];
  activities?: DesktopConversationActivity[];
  steps?: DesktopConversationStep[];
  usage?: DesktopConversationTokenUsage;
  memoryTrace?: DesktopMessageMemoryTraceMeta;
};

export type { TurnFileItem } from "./turnFiles";

export type TranscriptRenderBlock =
  | { id: string; kind: "text"; content: string }
  | { id: string; kind: "thinking"; content: string }
  | { id: string; kind: "plan"; plan: DesktopConversationPlan }
  | { id: string; kind: "activities"; activities: DesktopConversationActivity[] };

export type TranscriptProcessBlock = Exclude<TranscriptRenderBlock, { kind: "plan" }>;

/**
 * A completed assistant turn has one compact process disclosure, followed by
 * the answer. Text emitted before the last reasoning/tool step belongs to that
 * process (models often narrate before calling a tool); text after it is the
 * final response. Plan cards stay outside the disclosure because they require
 * a visible user decision.
 */
export function transcriptCompletedTurnSections(blocks: TranscriptRenderBlock[]): {
  process: TranscriptProcessBlock[];
  response: TranscriptRenderBlock[];
} {
  const proposedPlans = blocks.filter((block) => block.kind === "plan" && block.plan.status === "proposed");
  const orderedBlocks = proposedPlans.length
    ? [...blocks.filter((block) => block.kind !== "plan" || block.plan.status !== "proposed"), ...proposedPlans]
    : blocks;
  const firstPlan = orderedBlocks.findIndex((block) => block.kind === "plan");
  const processLimit = firstPlan < 0 ? orderedBlocks.length : firstPlan;
  let processEnd = -1;
  for (let index = 0; index < processLimit; index += 1) {
    if (orderedBlocks[index].kind === "thinking" || orderedBlocks[index].kind === "activities") processEnd = index;
  }
  if (processEnd < 0) return { process: [], response: orderedBlocks };
  return {
    process: orderedBlocks.slice(0, processEnd + 1) as TranscriptProcessBlock[],
    response: orderedBlocks.slice(processEnd + 1)
  };
}

export function transcriptProcessSummary(blocks: TranscriptProcessBlock[]): {
  toolCount: number;
  fileCount: number;
  durationMs: number;
  hasError: boolean;
  interrupted: boolean;
} {
  const activities = blocks.flatMap((block) => block.kind === "activities" ? block.activities : []);
  const files = new Set(activities.flatMap((activity) => activity.mutates ? (activity.paths ?? []) : []));
  const starts = activities.flatMap((activity) => activity.startedAt ? [Date.parse(activity.startedAt)] : []).filter(Number.isFinite);
  const finishes = activities.flatMap((activity) => activity.finishedAt ? [Date.parse(activity.finishedAt)] : []).filter(Number.isFinite);
  const elapsedMs = starts.length && finishes.length
    ? Math.max(0, Math.max(...finishes) - Math.min(...starts))
    : activities.reduce((total, activity) => total + (activity.durationMs ?? 0), 0);
  return {
    toolCount: activities.filter((activity) => activity.kind === "tool").length,
    fileCount: files.size,
    durationMs: elapsedMs,
    hasError: activities.some((activity) => activity.state === "error"),
    interrupted: activities.some((activity) => activity.state === "running")
  };
}

/** Groups only adjacent activities, preserving every text/thinking boundary. */
export function transcriptRenderBlocks(message: TranscriptMessage): TranscriptRenderBlock[] {
  const steps = message.steps?.length
    ? message.steps
    : [
        ...(message.thinking ? [{ id: `${message.id ?? "message"}-thinking`, kind: "thinking" as const, content: message.thinking }] : []),
        ...((message.activities ?? []).map((activity) => ({ id: `${message.id ?? "message"}-${activity.key}`, kind: "activity" as const, activity }))),
        ...(message.content ? [{ id: `${message.id ?? "message"}-text`, kind: "text" as const, content: message.content }] : [])
      ];
  const blocks: TranscriptRenderBlock[] = [];
  for (const step of steps) {
    if (step.kind !== "activity") {
      blocks.push(step);
      continue;
    }
    const previous = blocks.at(-1);
    if (previous?.kind === "activities") previous.activities.push(step.activity);
    else blocks.push({ id: step.id, kind: "activities", activities: [step.activity] });
  }
  return blocks;
}

export function transcriptTurnSummary(
  message: TranscriptMessage,
  previousUserMessage?: TranscriptMessage | null
): {
  toolCount: number;
  fileCount: number;
  durationMs: number;
  totalTokens: number;
} {
  const activities = message.steps?.flatMap((step) => step.kind === "activity" ? [step.activity] : [])
    ?? message.activities
    ?? [];
  const files = new Set(activities.flatMap((activity) => activity.mutates ? (activity.paths ?? []) : []));

  let durationMs = 0;
  if (previousUserMessage?.createdAt && message.createdAt) {
    const start = Date.parse(previousUserMessage.createdAt);
    const end = Date.parse(message.createdAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      durationMs = end - start;
    }
  }
  if (!durationMs) {
    durationMs = activities.reduce((total, activity) => total + (activity.durationMs ?? 0), 0);
  }

  return {
    toolCount: activities.filter((activity) => activity.kind === "tool").length,
    fileCount: files.size,
    durationMs,
    totalTokens: message.usage?.totalTokens ?? 0
  };
}

export type TranscriptAttachmentActions = {
  filesByLocal: Map<string, DesktopSessionFile>;
  mediaUrls: Map<string, string>;
  mediaLoading: Set<string>;
  mediaFailed: Set<string>;
  loadMedia: (file: DesktopSessionFile) => void;
  canPreview: (file: DesktopSessionFile) => boolean;
  preview: (file: DesktopSessionFile) => void;
  download: (file: DesktopSessionFile) => void;
  contributions?: TranscriptContributionAction[];
  onRunContribution?: (
    action: TranscriptContributionAction,
    message: TranscriptMessage,
    file: DesktopSessionFile
  ) => void;
};

/**
 * Hover actions for a transcript message. `onCopy` is always available; the
 * edit button is only surfaced for the user's own messages, while fork is
 * only surfaced for completed assistant messages on writable chat surfaces.
 * `copiedId` lets the copy button flash a check mark.
 *
 * `onEditUser` rewrites the current Session in place (the original message
 * and everything after it is dropped).
 */
export type TranscriptMessageActions = {
  copiedId: string;
  onCopy: (message: TranscriptMessage) => void;
  onEditUser?: (message: TranscriptMessage) => void;
  editingId?: string;
  onForkAssistant?: (message: TranscriptMessage) => void;
  forkingId?: string;
  onOpenMemoryTrace?: (traceId: string) => void;
  contributions?: TranscriptContributionAction[];
  pendingContributionKey?: string;
  successfulContributionKey?: string;
  onRunContribution?: (
    action: TranscriptContributionAction,
    message: TranscriptMessage,
    selection?: string
  ) => void;
  onResolvePlan?: (
    message: TranscriptMessage,
    plan: DesktopConversationPlan,
    decision: "accept" | "reject" | "modify",
    edits?: { title: string; summary: string; steps: string[]; mode?: "manual" | "accept_edits" }
  ) => void;
};

export type TranscriptContributionAction = {
  id: string;
  label: string;
  icon?: string;
  appId: string;
  tool: string;
  accepts: Array<"text" | "image" | "file">;
};

/**
 * A persisted message's run is over, so a "running" activity can never finish
 * (it was interrupted before its end event, or written by an older build).
 * Close such entries out as errors so the transcript never shows an eternal
 * spinner. Live (in-turn) activity lists must NOT go through this.
 */
export function finalizeTranscriptActivities(
  activities: DesktopConversationActivity[] | undefined
): DesktopConversationActivity[] | undefined {
  if (!activities?.length) return activities;
  if (!activities.some((activity) => activity.state === "running")) return activities;
  return activities.map((activity) =>
    activity.state === "running" ? { ...activity, state: "error" } : activity
  );
}

export function transcriptDisplayContent(message: TranscriptMessage, assistantErrorText = ""): string {
  const content = message.content.trim();
  if (message.attachments?.length && ["(attachment)", "(empty response)"].includes(content.toLowerCase())) {
    return "";
  }
  if (message.role === "assistant" && content === "Sorry, something went wrong." && assistantErrorText) {
    return assistantErrorText;
  }
  return content;
}

/** Returns navigable message ids whose rendered text matches the query. */
export function findTranscriptMatches(
  messages: TranscriptMessage[],
  query: string,
  assistantErrorText = ""
): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages.flatMap((message) => {
    const id = message.id?.trim();
    if (!id) return [];
    const visibleText = transcriptDisplayContent(message, assistantErrorText).toLocaleLowerCase();
    return visibleText.includes(needle) ? [id] : [];
  });
}

/** Keeps the active result valid when the query, transcript, or Session changes. */
export function clampTranscriptSearchIndex(index: number, matchCount: number): number {
  if (matchCount <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), matchCount - 1);
}
