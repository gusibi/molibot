import assert from "node:assert/strict";
import test from "node:test";
import type { PiExtensionTerminalSummary } from "@molibot/shared/piExtensionTerminal";
import { isPiTerminalActionable, piTerminalLauncherLabel } from "./piExtensionTerminalPresentation.js";

const copy = {
  interactionTitle: "Pi extension needs your response",
  reviewLauncher: "Pi task needs review",
  terminalTitle: "Pi Extension Terminal",
};

function terminal(input: Partial<PiExtensionTerminalSummary>): PiExtensionTerminalSummary {
  return {
    id: input.id ?? "terminal",
    sessionId: "session",
    runId: "run",
    extensionIds: ["extension"],
    status: input.status ?? "failed",
    createdAt: 1,
    cleanupStatus: "unknown",
    sharingStatus: "unverified",
    ...input,
  };
}

test("a normally completed native Pi task does not create an attention entry", () => {
  const completed = terminal({ status: "completed" });
  assert.equal(isPiTerminalActionable(completed), false);
});

test("custom terminal interaction and structured dialogs remain actionable", () => {
  const custom = terminal({ status: "running", customInteraction: true });
  const dialog = terminal({ id: "dialog", status: "running", dialog: { id: "dialog-id", kind: "confirm", title: "Continue?" } });
  assert.equal(isPiTerminalActionable(custom), true);
  assert.equal(piTerminalLauncherLabel([custom], copy), copy.terminalTitle);
  assert.equal(isPiTerminalActionable(dialog), true);
  assert.equal(piTerminalLauncherLabel([dialog], copy), copy.interactionTitle);
});

test("an unreviewed failed task uses the review entry and reviewed state clears it", () => {
  const review = terminal({ requiresReview: true });
  assert.equal(isPiTerminalActionable(review), true);
  assert.equal(piTerminalLauncherLabel([review], copy), copy.reviewLauncher);
  const reviewed = terminal({ requiresReview: false, contextReviewed: true });
  assert.equal(isPiTerminalActionable(reviewed), false);
  assert.equal(piTerminalLauncherLabel([reviewed], copy), copy.terminalTitle);
});
