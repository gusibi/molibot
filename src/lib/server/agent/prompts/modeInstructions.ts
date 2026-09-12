/**
 * The sandbox → host-access contract, written for modes where the sandbox and
 * approval machinery actually apply. It lives in per-turn runtime instructions
 * — never in the cache-stable static prompt — because its truth depends on the
 * attempt's effective mode: under Full Access there is no sandbox and no
 * approval, so teaching the model to request host approval there would make it
 * stop and wait for a card that will never come.
 */
const RESTRICTED_HOST_ACCESS_CONTRACT =
  "Shell commands run inside a runtime-managed sandbox. Host-only capabilities (native app control, browser processes, IPC, desktop integration, OAuth callbacks) need controlled access: call bash with hostApproval={ reason, permissions? }, naming the exact fixed command and why host execution is required, then wait for the approved result — never claim a host action ran before it did, and never retry a permission-blocked command hoping it passes.";

/**
 * Per-turn runtime instructions rendering the actual effective policy for the
 * model. Runtime instructions are attempt-scoped: they never persist as
 * conversation content and never enter a cache-stable prompt prefix, so a mode
 * change cannot leak between attempts.
 */
export function permissionModeInstructionsFor(mode: "plan" | "manual" | "accept_edits" | "auto"): string[] {
  switch (mode) {
    case "plan":
      return [
        "This Session is in Plan mode. Investigate with the available read-only tools. For substantial codebase investigation, delegate focused discovery or planning to the read-only subagent roles scout and planner. Then call exitPlan exactly once with a concrete ordered plan. Do not claim to have changed files or executed commands. The plan is a structured product object, so ordinary Markdown alone is not a substitute for exitPlan."
      ];
    case "manual":
      return [
        "This Session is in Manual mode: every action that is not a plain read waits for the user's approval before it executes. Do not restate approval requests or claim an action ran before its approved result exists.",
        RESTRICTED_HOST_ACCESS_CONTRACT
      ];
    case "auto":
      return [
        "This Session runs with Full Access: the available tools execute directly on the host machine without approval prompts, and commands are never sandboxed first. Do not request or wait for approval, and do not describe commands as sandboxed. Use this to finish the task unattended, and report real outcomes — a failed command is reported as failed, not retried as a permission request."
      ];
    case "accept_edits":
      return [
        "This Session is in Accept Edits mode: project work inside the approved workspace (file edits, sandboxed commands) proceeds automatically, while out-of-bounds or host-level actions ask first.",
        RESTRICTED_HOST_ACCESS_CONTRACT
      ];
  }
}
