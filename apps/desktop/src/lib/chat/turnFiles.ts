import type { DesktopConversationActivity } from "@molibot/desktop-contract";

export interface TurnFileItem {
  key: string;
  name: string;
  path: string;
  action: "created" | "modified";
  source: "project" | "session";
  fileId?: string;
}

interface TurnFileMessage {
  activities?: DesktopConversationActivity[];
  steps?: Array<{ kind: string; activity?: DesktopConversationActivity }>;
  attachments?: Array<{ original: string; local?: string }>;
}

interface SessionFileLocator {
  id: string;
  local: string;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function matchesSessionOutputPath(local: string, outputPath: string): boolean {
  const normalizedLocal = local.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const normalizedOutput = outputPath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return Boolean(normalizedOutput) && (
    normalizedLocal === normalizedOutput ||
    normalizedLocal === `scratch/${normalizedOutput}` ||
    normalizedLocal.endsWith(`/scratch/${normalizedOutput}`)
  );
}

/** Builds the flat completed-turn file list from file receipts and generated attachments. */
export function collectTurnFiles(
  message: TurnFileMessage,
  sessionFilesByLocal: ReadonlyMap<string, SessionFileLocator> = new Map()
): TurnFileItem[] {
  const files = new Map<string, TurnFileItem>();
  const stepActivities = message.steps?.flatMap((step) => step.kind === "activity" && step.activity ? [step.activity] : []) ?? [];
  const activities = stepActivities.some((activity) => activity.fileOutput) ? stepActivities : (message.activities ?? []);

  for (const activity of activities) {
    if (activity.state !== "success" || !activity.fileOutput?.path) continue;
    const output = activity.fileOutput;
    if (output.rootKind !== "project" && output.rootKind !== "scratch") continue;
    const outputPath = output.path;
    const sessionFile = output.rootKind === "scratch"
      ? [...sessionFilesByLocal.values()].find((candidate) => matchesSessionOutputPath(candidate.local, outputPath))
      : undefined;
    const source = output.rootKind === "scratch" ? "session" : "project";
    const path = sessionFile?.local ?? outputPath;
    const key = source === "session" ? `session:${sessionFile?.id ?? `scratch:${outputPath}`}` : `project:${outputPath}`;
    const existing = files.get(key);
    files.set(key, {
      key,
      name: outputPath,
      path,
      action: existing?.action === "created" || output.action === "created" ? "created" : "modified",
      source,
      ...(sessionFile ? { fileId: sessionFile.id } : {})
    });
  }

  const outputNames = new Set([...files.values()].map((file) => baseName(file.name)));
  for (const attachment of message.attachments ?? []) {
    const local = attachment.local?.trim() ?? "";
    const name = attachment.original.trim() || baseName(local);
    if (!local || !name || outputNames.has(name)) continue;
    const located = sessionFilesByLocal.get(local);
    const key = `session:${located?.id ?? local}`;
    files.set(key, {
      key,
      name,
      path: local,
      action: "created",
      source: "session",
      fileId: located?.id
    });
  }

  return [...files.values()];
}
