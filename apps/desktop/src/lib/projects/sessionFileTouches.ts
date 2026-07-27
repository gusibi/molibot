import type { DesktopConversationActivity } from "@molibot/desktop-contract";

/**
 * Files a Project session touched, derived from the tool activities recorded on
 * its transcript (`ConversationActivity.paths`, set from the tool's own
 * arguments — see `src/lib/server/app/toolFilePaths.ts`).
 *
 * This is what makes "changes from THIS session" answerable without snapshotting
 * the working tree: the transcript is already persisted, so the set survives a
 * restart and stays correct after switching sessions, which a `git status`
 * baseline captured at session start would not.
 */
export interface SessionFileTouches {
  /** Paths the session wrote to (`write`/`edit`). */
  written: Set<string>;
  /** Every path the session touched, including reads. */
  all: Set<string>;
}

export const EMPTY_SESSION_FILE_TOUCHES: SessionFileTouches = { written: new Set(), all: new Set() };

interface ActivityCarrier {
  activities?: DesktopConversationActivity[];
}

/**
 * Collects touches across a session's persisted messages plus the activities of
 * the turn currently running (which are not in the transcript yet), so a file
 * lights up in the panel the moment the agent writes it.
 */
export function collectSessionFileTouches(
  messages: readonly ActivityCarrier[],
  liveActivities: readonly DesktopConversationActivity[] = []
): SessionFileTouches {
  const written = new Set<string>();
  const all = new Set<string>();

  const absorb = (activity: DesktopConversationActivity) => {
    if (!activity.paths?.length) return;
    for (const path of activity.paths) {
      if (!path) continue;
      all.add(path);
      if (activity.mutates) written.add(path);
    }
  };

  for (const message of messages) {
    for (const activity of message.activities ?? []) absorb(activity);
  }
  for (const activity of liveActivities) absorb(activity);

  return { written, all };
}
