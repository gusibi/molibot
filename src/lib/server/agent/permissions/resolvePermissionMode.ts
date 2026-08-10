import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "$lib/server/agent/permissions/decidePermission.js";
import { resolveSessionScopedOverride } from "$lib/server/agent/permissions/overrideResolver.js";

/**
 * The effective permission mode for a run, resolved through the same five-level
 * chain as the sandbox flag: session → project → bot instance → agent → global.
 *
 * Deliberately the same shape as `resolveEffectiveSandboxSettings`, and sharing
 * its resolver rather than restating the precedence (Permission Modes PRD §102,
 * CLAUDE.md pitfall 7). The two are the orthogonal halves of one decision —
 * what may this call touch, and do we ask first — so they must agree on *whose*
 * setting wins.
 */
export function resolveEffectivePermissionMode(options: {
  getSettings: () => RuntimeSettings;
  chatId?: string;
  sessionId?: string;
  store?: MomRuntimeStore;
  channel?: string;
  botId?: string;
  agentId?: string;
  projectOverride?: PermissionMode;
}): PermissionMode {
  const settings = options.getSettings();

  return resolveSessionScopedOverride<PermissionMode>(
    settings,
    {
      chatId: options.chatId,
      sessionId: options.sessionId,
      channel: options.channel,
      botId: options.botId,
      agentId: options.agentId
    },
    {
      session: () =>
        options.store && options.chatId && options.sessionId
          ? options.store.getSessionPermissionModeOverride(options.chatId, options.sessionId)
          : null,
      project: options.projectOverride,
      instance: (instance) => instance.permissionMode as PermissionMode | undefined,
      agent: (agent) => agent.permissionMode as PermissionMode | undefined,
      global: () => settings.permissionMode ?? DEFAULT_PERMISSION_MODE
    }
  );
}

/**
 * Plan and Manual have no interaction surface outside the desktop app: Plan
 * needs an ExitPlan confirmation card, and Manual would send an approval card
 * for every single file write (product decision, 2026-08-10).
 *
 * Channels therefore see the nearest mode they can actually honour. Clamping
 * up rather than down is the safe direction only because the two clamped modes
 * are *stricter* than the result — a channel user who set Plan elsewhere gets
 * Accept edits, which still asks before host commands and third-party calls.
 */
export function clampModeForChannel(mode: PermissionMode, channel: string): PermissionMode {
  const isDesktopSurface = channel === "web" || channel === "cli";
  if (isDesktopSurface) return mode;
  return mode === "plan" || mode === "manual" ? "accept_edits" : mode;
}
