import type { DesktopConversationActivity, DesktopConversationPlan, DesktopConversationStep, DesktopConversationTokenUsage, DesktopFileMediaType, DesktopMessageMemoryTraceMeta, DesktopSessionFile } from "@molibot/desktop-contract";

export type TranscriptAttachment = {
  original: string;
  local?: string;
  mediaType: DesktopFileMediaType;
  mimeType?: string;
  size?: number;
};

export type TranscriptMessage = {
  authorName?: string;
  authorAgentId?: string;
  traceRunIds?: string[];
  /** Execution duration, excluding time spent waiting before this run started. */
  durationMs?: number;
  id?: string;
  role: string;
  content: string;
  /** Answer semantics of `content`; absent/legacy = recorded tail, possibly incomplete. */
  resultKind?: "final" | "partial" | "none" | "legacy";
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
  | { id: string; kind: "result"; content: string }
  | { id: string; kind: "thinking"; content: string }
  | { id: string; kind: "plan"; plan: DesktopConversationPlan }
  | { id: string; kind: "activities"; activities: DesktopConversationActivity[] };

/**
 * Process disclosure input: thinking, tool runs, and the narration the model
 * emits around them. Result text never folds into this view.
 */
export type TranscriptProcessBlock = Exclude<TranscriptRenderBlock, { kind: "plan" } | { kind: "result" }>;

export type TranscriptAnswerBlock = Extract<TranscriptRenderBlock, { kind: "result" } | { kind: "plan" }>;

/**
 * A turn is one unified process disclosure plus one independent answer: the
 * process group (thinking, tools, narration — collapsed, expandable) sits
 * above the result area, which carries the runtime-marked deliverable (and
 * the proposed Plan decision). Exactly one process entry per turn; no tool
 * card ever wedges into the answer (conversation answer visibility spec).
 */
export function transcriptTurnSections(blocks: TranscriptRenderBlock[]): {
  process: TranscriptProcessBlock[];
  response: TranscriptAnswerBlock[];
} {
  const proposedPlans = blocks.filter((block) => block.kind === "plan" && block.plan.status === "proposed");
  const orderedBlocks = proposedPlans.length
    ? [...blocks.filter((block) => block.kind !== "plan" || block.plan.status !== "proposed"), ...proposedPlans]
    : blocks;
  return {
    process: orderedBlocks.filter((block): block is TranscriptProcessBlock => block.kind === "thinking" || block.kind === "activities" || block.kind === "text"),
    response: orderedBlocks.filter((block): block is TranscriptAnswerBlock => block.kind === "result" || block.kind === "plan")
  };
}

/** True when a legacy turn kept only its tail segment: the answer may be incomplete. */
export function transcriptResultUnrecorded(message: TranscriptMessage, processBlocks: TranscriptProcessBlock[]): boolean {
  if (message.role !== "assistant") return false;
  if (message.resultKind && message.resultKind !== "legacy") return false;
  // A turn whose only recorded step is the tail text could not have lost
  // anything in front of it; the notice is for turns that actually ran a
  // process (tools, thinking, narration) before the recorded tail.
  return processBlocks.length > 0;
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
      ];
  // `content` is the committed reply, also for messages without an execution
  // transcript. Live callers pass no committed content until the result arrives.
  const displaySteps = message.content.trim()
    ? [...steps.filter(step => step.kind !== "result"), { id: `${message.id ?? "message"}-result`, kind: "result" as const, content: message.content }]
    : steps;
  const blocks: TranscriptRenderBlock[] = [];
  for (const step of displaySteps) {
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
  onReply?: (message: TranscriptMessage) => void;
  replyLabel?: string;
  onExecute?: (message: TranscriptMessage) => void;
  executeLabel?: string;
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
  /** Opens the Mini App named by a persisted `@app-id` invocation. */
  onOpenMiniApp?: (appId: string) => void;
  onRunContribution?: (
    action: TranscriptContributionAction,
    message: TranscriptMessage,
    selection?: string
  ) => void;
  onResolvePlan?: (
    message: TranscriptMessage,
    plan: DesktopConversationPlan,
    decision: "accept" | "reject" | "modify" | "complete",
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
