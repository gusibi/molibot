import { isAbsolute, relative, resolve } from "node:path";
import {
  decidePermission,
  type Containment,
  type PermissionMode,
  type PermissionDecision
} from "$lib/server/agent/permissions/decidePermission.js";
import {
  getRuntimeToolClassification,
  type ThirdPartyHint,
  type ToolEffect
} from "$lib/server/agent/tools/toolClassification.js";

/**
 * Turns a tool call into the two inputs the gate needs.
 *
 * Extracted from the closure in `tools/index.ts` so it can be tested: the
 * previous decider was an anonymous function capturing runtime state, and the
 * only way to exercise it was to stand up a whole tool runtime (PRD §108).
 */

export interface ToolCallFacts {
  toolId: string;
  input: unknown;
  /** Carried on the definition when known; classified by id otherwise. */
  effect?: ToolEffect;
  thirdPartyHint?: ThirdPartyHint;
}

export interface ContainmentFacts {
  sandboxEnabled: boolean;
  /** An approved owner-scoped Host Bash grant already covers this command. */
  hasApprovedHostGrant?: boolean;
  /** Roots a write may land in without asking. Absolute paths. */
  allowedWriteRoots?: string[];
  /** Where a relative tool path resolves from. */
  cwd?: string;
}

function isInsideAnyRoot(target: string, roots: string[]): boolean {
  const resolved = resolve(target);
  return roots.some((root) => {
    const rel = relative(resolve(root), resolved);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/**
 * Reads the target path out of a file tool's input. `write`/`edit` both use
 * `path`; the approval builder also accepts `file_path`, so both are honoured
 * to keep one meaning per path string across the two surfaces (pitfall 6).
 */
export function readToolTargetPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const params = input as Record<string, unknown>;
  const value = typeof params.path === "string"
    ? params.path
    : typeof params.file_path === "string" ? params.file_path : undefined;
  return value?.trim() || undefined;
}

/**
 * Containment for one call.
 *
 * `write` is judged by where the file lands; `execute` by whether the sandbox
 * engaged or a grant covers it. Everything else has no containment axis, and
 * says so rather than borrowing a value that would read as meaningful.
 *
 * A write whose target cannot be determined is `outside_allowed_root`, not
 * `in_allowed_root`: an unknown target is not evidence of safety, and the
 * difference is exactly "auto-approve" versus "ask".
 */
export function resolveContainment(call: ToolCallFacts, facts: ContainmentFacts): Containment {
  const effect = call.effect ?? getRuntimeToolClassification(call.toolId).effect;

  if (effect === "execute") {
    if (facts.hasApprovedHostGrant) return "host_granted";
    return facts.sandboxEnabled ? "sandboxed" : "host";
  }

  if (effect === "write") {
    const roots = facts.allowedWriteRoots ?? [];
    if (roots.length === 0) return "outside_allowed_root";
    const target = readToolTargetPath(call.input);
    if (!target) return "outside_allowed_root";
    const absolute = isAbsolute(target) ? target : resolve(facts.cwd ?? ".", target);
    return isInsideAnyRoot(absolute, roots) ? "in_allowed_root" : "outside_allowed_root";
  }

  return "not_applicable";
}

export interface ToolGateResult {
  decision: PermissionDecision;
  effect: ToolEffect;
  containment: Containment;
}

/**
 * The whole gate for one call: classify, place, decide.
 *
 * The classification comes off the tool definition when it is there, and is
 * derived from the id only as a fallback — a tool that declares its own effect
 * must not have it second-guessed here, or a Mini App's manifest hint would be
 * silently overridden by a name-based guess (the failure mode
 * `getRuntimeToolClassification` was written to avoid).
 */
export function decideToolPermission(
  mode: PermissionMode,
  call: ToolCallFacts,
  facts: ContainmentFacts
): ToolGateResult {
  const classified = getRuntimeToolClassification(call.toolId);
  const effect = call.effect ?? classified.effect;
  const thirdPartyHint = call.thirdPartyHint ?? classified.thirdPartyHint;
  const containment = resolveContainment({ ...call, effect }, facts);

  return {
    decision: decidePermission({ mode, effect, containment, thirdPartyHint }),
    effect,
    containment
  };
}
