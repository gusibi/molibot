import type { AcpAdapterKind, AcpTargetConfig } from "../../settings/schema.js";
import { claudeCodeAcpProvider } from "./claude-code.js";
import { codexAcpProvider } from "./codex.js";
import type { AcpProviderProfile } from "./types.js";

const ACP_PROVIDER_PROFILES: AcpProviderProfile[] = [codexAcpProvider, claudeCodeAcpProvider];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function inferAcpAdapterKind(input: {
  id?: string;
  name?: string;
  command?: string;
  args?: string[];
}): AcpAdapterKind {
  const normalized = {
    id: normalizeText(String(input.id ?? "")),
    name: normalizeText(String(input.name ?? "")),
    command: normalizeText(String(input.command ?? "")),
    args: Array.isArray(input.args) ? input.args.map((value) => normalizeText(String(value ?? ""))) : []
  };

  for (const profile of ACP_PROVIDER_PROFILES) {
    if (profile.matchesTarget(normalized)) {
      return profile.id;
    }
  }
  return "custom";
}

export function resolveAcpProviderProfile(
  target: Pick<AcpTargetConfig, "adapter" | "id" | "name" | "command" | "args">
): AcpProviderProfile | null {
  const adapter = target.adapter
    ? target.adapter
    : inferAcpAdapterKind(target);
  return ACP_PROVIDER_PROFILES.find((profile) => profile.id === adapter) ?? null;
}

export function createAcpTargetPreset(adapter: Exclude<AcpAdapterKind, "custom">): AcpTargetConfig {
  const profile = ACP_PROVIDER_PROFILES.find((item) => item.id === adapter);
  if (!profile) {
    throw new Error(`Unknown ACP adapter preset: ${adapter}`);
  }
  return {
    id: profile.defaultTargetId,
    name: profile.defaultTargetName,
    adapter: profile.id,
    enabled: true,
    command: profile.defaultCommand,
    args: [...profile.defaultArgs],
    env: {},
    cwd: ""
  };
}

export function formatAcpAdapterLabel(
  target: Pick<AcpTargetConfig, "adapter" | "id" | "name" | "command" | "args">
): string {
  const profile = resolveAcpProviderProfile(target);
  return profile?.label ?? "Custom ACP";
}

export function formatProviderScopedCommands(
  target: Pick<AcpTargetConfig, "adapter" | "id" | "name" | "command" | "args">,
  commands: string[]
): string[] {
  const profile = resolveAcpProviderProfile(target);
  if (!profile) return [...commands];
  return commands.map((command) => `${profile.commandNamespace}:${command}`);
}

export function buildAcpAuthHint(target: AcpTargetConfig): string {
  const profile = resolveAcpProviderProfile(target);
  if (!profile || profile.hasAuthAvailable(target)) return "";
  return profile.buildAuthHint(target);
}
