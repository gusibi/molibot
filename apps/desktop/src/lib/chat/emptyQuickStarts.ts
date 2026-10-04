import type { EmptyActionIcon } from "./activityIcons";
import type { Translation } from "../i18n";

export interface EmptyQuickStart {
  icon: EmptyActionIcon;
  label: string;
  prompt: string;
}

/**
 * The quick-start actions shared by every empty conversation surface (local Chat
 * and Project Chat). They only fill the composer, so the two surfaces must offer
 * the same starting points instead of drifting into two designs.
 */
export function emptyQuickStarts(copy: Translation): EmptyQuickStart[] {
  return [
    { icon: "list-checks", label: copy.emptyChatPlanLabel, prompt: copy.emptyChatPlanPrompt },
    { icon: "magnifying-glass", label: copy.emptyChatAnalyzeLabel, prompt: copy.emptyChatAnalyzePrompt },
    { icon: "notebook", label: copy.emptyChatOrganizeLabel, prompt: copy.emptyChatOrganizePrompt }
  ];
}
