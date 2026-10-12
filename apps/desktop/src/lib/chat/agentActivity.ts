import type { DesktopAgentActivityItem } from "@molibot/desktop-contract";
import type { Translation } from "../i18n";

/**
 * Human-facing activity status for an agent row. Idle (and not-yet-loaded)
 * agents return "" on purpose: a standing-by agent is the normal picture, so
 * labelling every row with it is noise. Only states that need attention
 * (working / completed / failed / disabled) produce text.
 */
export function agentActivityLabel(enabled: boolean, activity: DesktopAgentActivityItem | undefined, ready: boolean, copy: Translation): string {
  if (!enabled) return copy.agentStudioOffDuty;
  if (!ready) return "";
  if (activity?.status === "working") return copy.agentStudioWorking;
  if (activity?.status === "error") return copy.agentStudioFailed;
  if (activity?.status === "completed") return copy.agentStudioCompleted;
  return "";
}
