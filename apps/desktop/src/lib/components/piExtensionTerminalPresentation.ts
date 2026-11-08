import type { PiExtensionTerminalSummary } from "@molibot/shared/piExtensionTerminal";

interface PiTerminalActionCopy {
  interactionTitle: string;
  reviewLauncher: string;
  terminalTitle: string;
}

export function isPiTerminalActionable(terminal: PiExtensionTerminalSummary): boolean {
  return (
    (terminal.status === "running" && Boolean(terminal.customInteraction || terminal.dialog)) ||
    (Boolean(terminal.requiresReview) && !terminal.contextReviewed)
  );
}

export function piTerminalLauncherLabel(
  terminals: PiExtensionTerminalSummary[],
  copy: PiTerminalActionCopy,
): string {
  if (terminals.some(terminal => terminal.status === "running" && terminal.dialog)) return copy.interactionTitle;
  if (terminals.some(terminal => terminal.requiresReview && !terminal.contextReviewed)) return copy.reviewLauncher;
  return copy.terminalTitle;
}
