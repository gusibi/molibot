import { getPluginConfigStore } from "$lib/server/plugins/contract/configStore.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

// External providers receive the session's effective execution policy through
// `policyTranslation.ts`; enablement, executable paths and connection settings
// are the only provider-owned configuration left here.
export interface ResolvedExternalSubagentConfig {
  enabled: boolean;
  codexEnabled: boolean;
  codexPath?: string;
  claudeCodeEnabled: boolean;
  claudeCodePath?: string;
}

export type ExternalSubagentProviderId = "claude-code" | "codex";

export function isExternalSubagentProviderEnabled(
  config: ResolvedExternalSubagentConfig,
  provider: ExternalSubagentProviderId
): boolean {
  return config.enabled && (provider === "claude-code" ? config.claudeCodeEnabled : config.codexEnabled);
}

export function assertExternalSubagentProviderEnabled(
  config: ResolvedExternalSubagentConfig,
  provider: ExternalSubagentProviderId
): void {
  if (!isExternalSubagentProviderEnabled(config, provider)) {
    throw new Error(`External subagent '${provider}' is disabled.`);
  }
}

/**
 * Resolves External Subagent configuration from the plugin-owned config store.
 * The master enabled switch comes from RuntimeSettings.plugins.entries["external-subagent"].
 */
export function resolveExternalSubagentConfig(settings?: RuntimeSettings): ResolvedExternalSubagentConfig {
  const isHostEnabled = Boolean(settings?.plugins?.entries?.["external-subagent"]?.enabled);
  if (!isHostEnabled) {
    return {
      enabled: false,
      codexEnabled: false,
      claudeCodeEnabled: false
    };
  }

  const configStore = getPluginConfigStore();
  const readRes = configStore.readConfig("external-subagent", 1);
  const values = readRes.status === "ok" ? readRes.values : {};

  return {
    enabled: true,
    codexEnabled: values.codexEnabled === true,
    codexPath: typeof values.codexPath === "string" && values.codexPath.trim() ? values.codexPath.trim() : undefined,
    claudeCodeEnabled: values.claudeCodeEnabled === true,
    claudeCodePath: typeof values.claudeCodePath === "string" && values.claudeCodePath.trim() ? values.claudeCodePath.trim() : undefined
  };
}
