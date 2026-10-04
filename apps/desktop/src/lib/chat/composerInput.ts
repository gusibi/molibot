import { clampDesktopThinkingLevel, type DesktopThinkingSelection, type DesktopThinkingLevel } from "@molibot/desktop-contract";
import type { Translation } from "../i18n";

/** Shared keyboard guard for ordinary and Room composers, including WebKit IME. */
export function shouldSubmitComposer(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.isComposing && event.keyCode !== 229;
}

export function resolveComposerThinking(value: DesktopThinkingSelection, options: readonly DesktopThinkingLevel[]): DesktopThinkingSelection {
  return value === "auto" ? "auto" : clampDesktopThinkingLevel(value, options);
}

export function thinkingSelectionLabel(copy: Translation, value: DesktopThinkingSelection): string {
  if (value === "auto") return copy.providerThinkingAuto;
  return { off: copy.thinkingOff, minimal: copy.thinkingMinimal, low: copy.thinkingLow, medium: copy.thinkingMedium, high: copy.thinkingHigh, xhigh: copy.thinkingXHigh, max: copy.thinkingMax }[value];
}
