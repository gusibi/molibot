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

/** Builds the flat completed-turn file list from Project receipts and generated attachments. */
export function collectTurnFiles(
  message: TurnFileMessage,
  sessionFilesByLocal: ReadonlyMap<string, SessionFileLocator> = new Map()
): TurnFileItem[] {
  const files = new Map<string, TurnFileItem>();
  const stepActivities = message.steps?.flatMap((step) => step.kind === "activity" && step.activity ? [step.activity] : []) ?? [];
  const activities = stepActivities.some((activity) => activity.fileOutput) ? stepActivities : (message.activities ?? []);

  for (const activity of activities) {
    if (activity.state !== "success" || !activity.fileOutput?.path) continue;
    const path = activity.fileOutput.path;
    const key = `project:${path}`;
    const existing = files.get(key);
    files.set(key, {
      key,
      name: path,
      path,
      action: existing?.action === "created" || activity.fileOutput.action === "created" ? "created" : "modified",
      source: "project"
    });
  }

  const projectNames = new Set([...files.values()].map((file) => baseName(file.path)));
  for (const attachment of message.attachments ?? []) {
    const local = attachment.local?.trim() ?? "";
    const name = attachment.original.trim() || baseName(local);
    if (!local || !name || projectNames.has(name)) continue;
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
