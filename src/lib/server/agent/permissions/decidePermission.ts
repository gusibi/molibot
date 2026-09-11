import type { ThirdPartyHint, ToolEffect } from "$lib/server/agent/tools/toolClassification.js";

/**
 * The one set of execution permission modes, shared by the settings default and
 * the conversation-window override. Strictly monotone: Plan ⊂ Manual ⊂ Accept
 * edits ⊂ Auto.
 *
 * Auto means **full access**: every Molibot execution-approval gate is removed
 * for the active task and commands run directly on the host — no sandbox first,
 * no approval card, no `waiting_for_approval` for a newly dispatched operation.
 * It covers exactly what Molibot itself can gate; it does not grant OS
 * privileges, third-party account authorization, or disabled capabilities.
 */
export type PermissionMode = "plan" | "manual" | "accept_edits" | "auto";

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "plan",
  "manual",
  "accept_edits",
  "auto"
] as const;

export const DEFAULT_PERMISSION_MODE: PermissionMode = "accept_edits";

/**
 * Where the call's side effects are fenced. Supplied by the call site, because
 * only it knows whether the sandbox actually engaged and whether the target
 * path is inside a writable root.
 */
export type Containment =
  /** Runs inside the tool sandbox. */
  | "sandboxed"
  /** Escapes to the host, covered by an approved owner-scoped grant. */
  | "host_granted"
  /** Would run on the host with no grant, or the sandbox could not start. */
  | "host"
  /** Target path is inside a root the operator allows writing to. */
  | "in_allowed_root"
  /** Target path is outside every allowed root. */
  | "outside_allowed_root"
  /** Containment is not meaningful for this effect (read, network, manage). */
  | "not_applicable";

export type PermissionDecision = "allow" | "ask" | "deny";

export interface DecidePermissionInput {
  mode: PermissionMode;
  effect: ToolEffect;
  containment: Containment;
  /** Only consulted for `third_party`. Defaults to the safe `undeclared`. */
  thirdPartyHint?: ThirdPartyHint;
}

/**
 * The single gate. A pure function so the whole matrix is testable without
 * standing up a runtime — the previous gate was an anonymous closure inside
 * `tools/index.ts` and could not be tested at all.
 *
 * Rules that hold across every row and are asserted individually in the tests,
 * because each one is a place a future edit would plausibly get wrong:
 *
 * 1. **`deny` only ever appears in Plan.** Everywhere else "not allowed" is
 *    expressed as `ask`, so the user always has a way through.
 * 2. **Auto never asks and never denies.** Full access is the product promise:
 *    a mode that still produced permission cards would be the old partial
 *    automation under a new name. Tool availability, schema validation and
 *    correctness checks are orthogonal and keep working.
 * 3. **An unavailable sandbox never downgrades a restricted mode to `allow`.**
 *    The call site reports `host` containment when the sandbox could not
 *    start, and restricted modes gate host execution (CLAUDE.md pitfall 15 —
 *    enabled sandbox must fail closed). Auto does not consult the sandbox at
 *    all, so the failure mode cannot arise there.
 */
export function decidePermission(input: DecidePermissionInput): PermissionDecision {
  const { mode, effect, containment } = input;
  const hint = input.thirdPartyHint ?? "undeclared";

  // Plan is a read-only planning state. The tool list handed to the provider is
  // narrowed to read-effect tools before the model ever sees it, so this branch
  // is the backstop, not the mechanism (PRD §134 / pitfall 14a: a guard winds a
  // turn down, it does not kill it by making the model bounce off denials).
  if (mode === "plan") {
    return effect === "read" ? "allow" : "deny";
  }

  // Reading local state is never gated: it is the one effect every mode allows,
  // and gating it would make Plan useless as a planning state.
  if (effect === "read") return "allow";

  // Manual asks before every effect that is not a plain local read.
  if (mode === "manual") return "ask";

  // Auto is full access: host commands, file operations, MCP, installations and
  // third-party calls all run without a Molibot approval card (rule 2).
  if (mode === "auto") return "allow";

  switch (effect) {
    case "manage":
      // Downloads and executes third-party code. Restricted modes ask: "install
      // this plugin" can arrive in content the agent read rather than from the
      // owner (CLAUDE.md pitfall 21d).
      return "ask";

    case "write":
      // Accept edits is exactly this line: writes inside a root the operator
      // allows are automatic. Outside, it still asks.
      return containment === "in_allowed_root" ? "allow" : "ask";

    case "execute":
      // Sandboxed or already granted is routine; a bare host escape is not.
      // `host` also covers "the sandbox failed to start" (rule 3).
      return containment === "sandboxed" || containment === "host_granted" ? "allow" : "ask";

    case "network":
      return "allow";

    case "installed_app":
      // The owner installed this code deliberately, and that install was itself
      // gated by `manage`. A destructive call is still asked about:
      // `destructiveHint` is the app saying "this one deletes things", and an
      // install grant does not cover that.
      return hint === "destructive" ? "ask" : "allow";

    case "third_party":
      // The one axis Accept edits is conservative about: a server-declared
      // read-only call is still an external integration the owner has not
      // blessed for unattended effects. `destructive` and `undeclared` ask all
      // the more: a missing annotation is not evidence of anything.
      return "ask";

    default: {
      // Exhaustiveness: a new effect must be classified here deliberately
      // rather than inheriting whatever the last branch happened to return.
      const exhaustive: never = effect;
      void exhaustive;
      return "ask";
    }
  }
}
