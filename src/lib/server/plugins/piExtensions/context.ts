import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";

export interface HeadlessContextOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Extension id, used to make "unsupported capability" messages actionable. */
  extensionId: string;
  systemPrompt?: () => string;
}

/**
 * Anything an extension reaches for that has no Molibot equivalent resolves to
 * this proxy: touching it throws a message naming the extension and the missing
 * capability, instead of failing later as `undefined is not a function`.
 */
function unsupported(extensionId: string, capability: string): any {
  return new Proxy({}, {
    get(_target, property) {
      if (property === Symbol.toPrimitive || property === "toString") {
        return () => `[unsupported:${capability}]`;
      }
      throw new Error(
        `pi extension "${extensionId}" used ${capability}.${String(property)}, which Molibot does not provide. ` +
        `This capability is terminal-only in pi and has no server-side equivalent.`
      );
    }
  });
}

/**
 * A pi `ExtensionContext` for a headless, multi-session server.
 *
 * Molibot has no TUI, no pi SessionManager and no pi ModelRegistry, so dialog
 * methods degrade to "user did not answer" and the two pi registries are
 * throwing proxies. Everything an extension can legitimately use on a server —
 * cwd, abort signal, notifications — is real.
 */
export function createHeadlessExtensionContext(options: HeadlessContextOptions): ExtensionContext {
  const { extensionId } = options;

  const ui = {
    // No interactive surface: report "no answer" rather than blocking a turn.
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: (message: string, type: "info" | "warning" | "error" = "info") => {
      const log = type === "info" ? momLog : momWarn;
      log("plugins", "pi_extension_notify", { extensionId, type, message });
    },
    onTerminalInput: () => () => undefined,
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined
  };

  return {
    ui,
    mode: "print",
    hasUI: false,
    cwd: options.cwd,
    sessionManager: unsupported(extensionId, "ctx.sessionManager"),
    modelRegistry: unsupported(extensionId, "ctx.modelRegistry"),
    model: undefined,
    isIdle: () => false,
    // Extensions are installed by the owner into the owner's own data dir.
    isProjectTrusted: () => true,
    signal: options.signal,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => {
      momWarn("plugins", "pi_extension_shutdown_ignored", { extensionId });
    },
    getContextUsage: () => undefined,
    compact: () => {
      momWarn("plugins", "pi_extension_compact_ignored", { extensionId });
    },
    getSystemPrompt: () => options.systemPrompt?.() ?? ""
  } as unknown as ExtensionContext;
}
