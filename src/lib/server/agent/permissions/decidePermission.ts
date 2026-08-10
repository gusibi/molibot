import type { ThirdPartyHint, ToolEffect } from "$lib/server/agent/tools/toolClassification.js";

/**
 * Session-scoped permission modes: whether to ask the user, decoupled from the
 * sandbox, which governs what a call can touch.
 *
 * Strictly monotone: Plan ⊂ Manual ⊂ Accept edits ⊂ Auto. There is deliberately
 * no Bypass — the "stop asking me" need is served by Auto plus an owner-scoped
 * persistent grant, which consents to a *specific command* rather than
 * abandoning the gate for a whole session (Permission Modes PRD §70).
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
 * Three rules hold across every row and are asserted individually in the tests,
 * because each one is a place a future edit would plausibly get wrong:
 *
 * 1. **`manage` always asks, including in Auto.** It downloads and executes
 *    third-party code, and "install this plugin" can arrive in content the
 *    agent read rather than from the owner (CLAUDE.md pitfall 21d).
 * 2. **`deny` only ever appears in Plan.** Everywhere else "not allowed" is
 *    expressed as `ask`, so the user always has a way through.
 * 3. **An unavailable sandbox never downgrades to `allow`.** The call site
 *    reports `host` containment when the sandbox could not start, and `host`
 *    is gated (CLAUDE.md pitfall 15 — enabled sandbox must fail closed).
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

  if (effect === "manage") return "ask"; // rule 1, in both remaining modes

  switch (effect) {
    case "write":
      // Accept edits is exactly this line: writes inside a root the operator
      // allows are automatic. Outside, both modes still ask — Auto is not
      // "write anywhere".
      return containment === "in_allowed_root" ? "allow" : "ask";

    case "execute":
      // Sandboxed or already granted is routine; a bare host escape is not, in
      // either mode. `host` also covers "the sandbox failed to start" (rule 3).
      return containment === "sandboxed" || containment === "host_granted" ? "allow" : "ask";

    case "network":
      return "allow";

    case "installed_app":
      // The owner installed this code deliberately, and that install was itself
      // gated by `manage` (which asks in every mode). A destructive call is
      // still asked about: `destructiveHint` is the app saying "this one
      // deletes things", and an install grant does not cover that.
      return hint === "destructive" ? "ask" : "allow";

    case "third_party":
      // The one difference between Accept edits and Auto (PRD §79), so both
      // modes have a reason to exist rather than differing by feel.
      //
      // Auto may auto-allow a call the server itself declared read-only
      // (decision 3, 2026-08-10). `destructive` and `undeclared` still ask: a
      // missing annotation is not evidence of anything, and a contradictory
      // pair was already resolved to `destructive` upstream.
      if (mode === "auto" && hint === "read_only") return "allow";
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
