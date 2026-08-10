import type { ToolRiskLevel, ToolSource } from "$lib/server/agent/tools/toolTypes.js";

/**
 * What this call does to the world, which is the axis a permission mode is
 * written against.
 *
 * `risk` cannot express the gate: `write`(medium) sits beside `webSearch`
 * (medium) and `bash`(high) beside `miniapp__x.delete`(high), so "auto-approve
 * file writes but keep asking before running commands" is unsayable on the risk
 * axis (Permission Modes PRD §32). `risk` keeps its display and audit duty; the
 * gate reads `effect`.
 */
export type ToolEffect =
  /** Reads local state only. */
  | "read"
  /** Creates or modifies files. */
  | "write"
  /** Runs a command. */
  | "execute"
  /** Leaves the machine. */
  | "network"
  /**
   * Runs code the owner explicitly installed (Mini App, pi extension). The
   * install itself already went through `manage`, which asks in every mode, so
   * charging again for each call would bill the same decision twice.
   */
  | "installed_app"
  /**
   * Calls an external service the owner configured a *connection* to (MCP).
   * The server's contents can change at any time and its annotations are
   * self-reported, so this is trusted strictly less than `installed_app`.
   */
  | "third_party"
  /** Downloads and installs third-party code. Never auto-allowed, in any mode. */
  | "manage";

/**
 * What the third party said about its own call, for `third_party` effects.
 *
 * `undeclared` is a distinct value on purpose: a missing annotation must never
 * collapse into `read_only`. The relaxation this enables is deliberately narrow
 * — see the decision recorded in the Permission Modes PRD (2026-08-10): a
 * declared `readOnlyHint` may auto-allow in **Auto only**, `destructiveHint`
 * always wins, and none of it touches the sandbox axis.
 */
export type ThirdPartyHint = "read_only" | "destructive" | "undeclared";

const LOCAL_READ_TOOLS = new Set([
  "read",
  "ls",
  "grep",
  "glob",
  "docExtract",
  "imageAnalyze",
  "conversationSearch",
  "toolSearch",
  "skillSearch"
]);

const NETWORK_TOOLS = new Set(["webSearch", "webFetch"]);

/**
 * Maps a declared hint pair to a single value. Shared by Mini App manifests and
 * MCP annotations so the two cannot drift: both are a third party describing
 * its own blast radius, and both are trusted exactly as far.
 */
function resolveThirdPartyHint(
  hints: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined
): ThirdPartyHint {
  if (!hints) return "undeclared";
  // Destructive always wins. A server declaring both is contradicting itself,
  // and the safe reading of a contradiction is the stricter one.
  if (hints.destructiveHint) return "destructive";
  if (hints.readOnlyHint) return "read_only";
  return "undeclared";
}

export interface RuntimeToolClassificationOptions {
  /**
   * Tool comes from a third-party pi extension. Such tools are never "builtin":
   * classifying them honestly keeps approval capability strings and audit logs
   * from attributing extension behaviour to Molibot itself.
   */
  isExtensionTool?: boolean;
  /**
   * Manifest risk hints for a Mini App tool. Risk is derived from declared
   * semantics, never guessed from the tool name — a Mini App called
   * `todo.delete` and one called `todo.archive` can have the same blast radius,
   * and only the manifest knows which.
   */
  miniApp?: { readOnlyHint: boolean; destructiveHint: boolean };
  /**
   * MCP tool annotations as declared by the server (`readOnlyHint` /
   * `destructiveHint`). Optional at every level: a server may omit them, and an
   * omission is `undeclared`, never `read_only`.
   */
  mcp?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/**
 * Pure helper: maps a tool name to its runtime risk classification and source.
 * Extracted for testability and used by wrapWithToolRuntime.
 */
export function getRuntimeToolClassification(
  toolName: string,
  options: RuntimeToolClassificationOptions = {}
): {
  risk: ToolRiskLevel;
  source: ToolSource;
  effect: ToolEffect;
  /** Only meaningful when `effect === "third_party"`. */
  thirdPartyHint: ThirdPartyHint;
} {
  if (toolName === "bash") {
    return { risk: "high", source: "host", effect: "execute", thirdPartyHint: "undeclared" };
  }
  // Installing an extension downloads and executes third-party code. "Install
  // this plugin" can appear in content the agent read rather than coming from
  // the owner, so this always reaches the approval broker.
  if (toolName === "extensionManage" || toolName === "miniAppManage") {
    return { risk: "critical", source: "builtin", effect: "manage", thirdPartyHint: "undeclared" };
  }
  // Mini App tools are owner-installed plugin code. They are classified from
  // the manifest and must never fall through to the builtin/low default below,
  // which would attribute app behaviour to Molibot itself.
  if (toolName.startsWith("miniapp__")) {
    const thirdPartyHint = resolveThirdPartyHint(options.miniApp);
    const risk: ToolRiskLevel = thirdPartyHint === "destructive"
      ? "high"
      : thirdPartyHint === "read_only" ? "low" : "medium";
    return { risk, source: "plugin", effect: "installed_app", thirdPartyHint };
  }
  if (options.isExtensionTool) {
    return { risk: "medium", source: "plugin", effect: "installed_app", thirdPartyHint: "undeclared" };
  }
  if (["write", "edit"].includes(toolName)) {
    return { risk: "medium", source: "builtin", effect: "write", thirdPartyHint: "undeclared" };
  }
  if (NETWORK_TOOLS.has(toolName)) {
    return { risk: "medium", source: "builtin", effect: "network", thirdPartyHint: "undeclared" };
  }
  if (toolName === "docExtract" || toolName === "imageAnalyze") {
    return { risk: "medium", source: "builtin", effect: "read", thirdPartyHint: "undeclared" };
  }
  // Producing a deliverable writes a file, so it is gated like a write rather
  // than like the read-only extractors it sits next to.
  if (toolName === "documentExport") {
    return { risk: "medium", source: "builtin", effect: "write", thirdPartyHint: "undeclared" };
  }
  if (toolName.startsWith("mcp__")) {
    return {
      risk: "medium",
      source: "mcp",
      effect: "third_party",
      thirdPartyHint: resolveThirdPartyHint(options.mcp)
    };
  }
  if (LOCAL_READ_TOOLS.has(toolName)) {
    return { risk: "low", source: "builtin", effect: "read", thirdPartyHint: "undeclared" };
  }
  // Unknown builtins default to `read`: they are the low-risk tail (status
  // helpers, formatters). Anything that touches the world is named above.
  return { risk: "low", source: "builtin", effect: "read", thirdPartyHint: "undeclared" };
}
