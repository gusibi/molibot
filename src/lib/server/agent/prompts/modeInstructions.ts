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
        "This Session is in Manual mode: every action that is not a plain read waits for the user's approval before it executes. Do not restate approval requests or claim an action ran before its approved result exists."
      ];
    case "auto":
      return [
        "This Session runs with Full Access: the available tools execute directly on the host machine without approval prompts, and commands are never sandboxed first. Use this to finish the task unattended, and report real outcomes — a failed command is reported as failed, not retried as a permission request."
      ];
    case "accept_edits":
      return [
        "This Session is in Accept Edits mode: project work inside the approved workspace (file edits, sandboxed commands) proceeds automatically, while out-of-bounds or host-level actions ask first."
      ];
  }
}
