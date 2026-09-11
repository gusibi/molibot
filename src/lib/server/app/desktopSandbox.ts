import type { ToolSandboxDiagnostics } from "$lib/server/agent/tools/sandbox";
import { getExecutionBackend } from "$lib/server/agent/exec/executionBackend";
import type { ToolSandboxSettings, RuntimeSettings } from "$lib/server/settings";
import { isAbsolute } from "node:path";
import { sanitizeToolSandboxSettings } from "$lib/server/settings/toolSandbox";
import type { DesktopSandboxSummary, DesktopSandboxUpdateRequest } from "$lib/shared/desktop";

function isSafeRelativeEnvPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isAbsolute(trimmed) || trimmed.startsWith("~")) return false;
  return !trimmed.split(/[\\/]+/).includes("..");
}

/**
 * Maps the sandbox backend declaration + advanced restrictions into a
 * credential-safe Desktop summary. Environment values and resolved absolute
 * paths are never returned. Configured env key names are editable because the
 * settings page exposes the same policy surface; they do not contain the
 * corresponding values.
 *
 * There is no enabled switch and no preset here: sandbox participation follows
 * the effective permission mode, so the summary declares the backend (its
 * identity, restriction capabilities and diagnostics) and the advanced
 * restrictions that apply to sandboxed commands only.
 */
export function buildDesktopSandboxSummary(
  settings: ToolSandboxSettings,
  diagnostics: ToolSandboxDiagnostics
): DesktopSandboxSummary {
  const envPathIsSafe = isSafeRelativeEnvPath(settings.envFilePath);
  // One declaration: the summary reads the live backend's capabilities rather
  // than restating them, so the UI can never drift from the adapter.
  const capabilities = getExecutionBackend("sandbox").capabilities;
  return {
    backend: {
      id: capabilities.id,
      name: capabilities.displayName,
      supportedPlatform: diagnostics.supportedPlatform,
      dependenciesAvailable: diagnostics.dependenciesAvailable,
      supportsNetworkDomainRestrictions: capabilities.supportsNetworkDomainRestrictions,
      supportsFilesystemRestrictions: capabilities.supportsFilesystemRestrictions,
      supportsEnvInjection: capabilities.supportsEnvInjection
    },
    envFilePath: envPathIsSafe ? settings.envFilePath : null,
    envFilePathConfiguredExternally: !envPathIsSafe,
    env: {
      inheritMode: settings.env.inheritMode,
      allow: [...settings.env.allow],
      deny: [...settings.env.deny]
    },
    network: {
      allowedDomains: [...settings.network.allowedDomains],
      deniedDomains: [...settings.network.deniedDomains]
    },
    filesystem: {
      denyRead: [...settings.filesystem.denyRead],
      allowWrite: [...settings.filesystem.allowWrite],
      denyWrite: [...settings.filesystem.denyWrite]
    },
    diagnostics: {
      platform: diagnostics.platform,
      envFileExists: diagnostics.envFileExists,
      envFileReadable: diagnostics.envFileReadable,
      sandboxInitialized: diagnostics.sandboxInitialized,
      sandboxError: diagnostics.sandboxError ?? null,
      envKeysAvailable: diagnostics.envKeysAvailable.length,
      envKeysInjected: diagnostics.envKeysInjected.length,
      envKeysDenied: diagnostics.envKeysDenied.length,
      envKeysMissing: diagnostics.envKeysMissing.length
    }
  };
}

export function buildDesktopSandboxUpdate(
  current: ToolSandboxSettings,
  request: DesktopSandboxUpdateRequest
): ToolSandboxSettings {
  let envFilePath = current.envFilePath;
  if (request.envFilePath !== undefined) {
    const candidate = String(request.envFilePath).trim();
    if (!isSafeRelativeEnvPath(candidate)) {
      throw new Error("envFilePath must be a non-empty project-relative path without '..'");
    }
    envFilePath = candidate;
  }

  return sanitizeToolSandboxSettings({
    envFilePath,
    env: {
      inheritMode: request.env?.inheritMode ?? current.env.inheritMode,
      allow: request.env?.allow ?? current.env.allow,
      deny: request.env?.deny ?? current.env.deny
    },
    network: {
      allowedDomains: request.network?.allowedDomains ?? current.network.allowedDomains,
      deniedDomains: request.network?.deniedDomains ?? current.network.deniedDomains
    },
    filesystem: {
      denyRead: request.filesystem?.denyRead ?? current.filesystem.denyRead,
      allowWrite: request.filesystem?.allowWrite ?? current.filesystem.allowWrite,
      denyWrite: request.filesystem?.denyWrite ?? current.filesystem.denyWrite
    }
  }, current);
}

/** Reads the sandbox advanced-restriction settings from a RuntimeSettings snapshot. */
export function readDesktopSandboxSettings(settings: RuntimeSettings): ToolSandboxSettings {
  return settings.toolSandbox;
}
