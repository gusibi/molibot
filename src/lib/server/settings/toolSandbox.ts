import type {
  ToolSandboxEnvInheritMode,
  ToolSandboxSettings
} from "$lib/server/settings/schema.js";

const DEFAULT_DENY_READ = [
  "~/.ssh",
  "~/.aws",
  "~/.gnupg",
  ".env",
  ".env.*"
];

const DEFAULT_DENY_WRITE = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key"
];

/**
 * Advanced sandbox restrictions only. The sandbox participates when the
 * effective permission mode is manual/accept_edits; full access (auto) runs on
 * the host and never consults these fields. The default network posture is
 * unrestricted so ordinary package downloads and API calls need no domain list;
 * explicit restrictions remain available as advanced settings.
 */
export const defaultToolSandboxSettings: ToolSandboxSettings = {
  envFilePath: ".env",
  env: {
    inheritMode: "minimal",
    allow: [],
    deny: []
  },
  network: {
    allowedDomains: ["*"],
    deniedDomains: []
  },
  filesystem: {
    denyRead: DEFAULT_DENY_READ,
    allowWrite: [],
    denyWrite: DEFAULT_DENY_WRITE
  }
};

function sanitizeStringList(input: unknown, fallback: string[] = []): string[] {
  const rows = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/\r?\n|,/)
      : fallback;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = String(row ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sanitizeEnvInheritMode(input: unknown, fallback: ToolSandboxEnvInheritMode): ToolSandboxEnvInheritMode {
  const value = String(input ?? "").trim();
  if (value === "minimal" || value === "allowlist" || value === "full") return value;
  return fallback;
}

/**
 * Unknown persisted fields (the removed `enabled`/`initFailureMode` controls)
 * are dropped here: sanitizing on both save and load means an old payload
 * simply loses them, and sandbox participation is decided by the permission
 * mode at run time.
 */
export function sanitizeToolSandboxSettings(input: unknown, fallback: ToolSandboxSettings = defaultToolSandboxSettings): ToolSandboxSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const env = source.env && typeof source.env === "object" ? source.env as Record<string, unknown> : {};
  const network = source.network && typeof source.network === "object" ? source.network as Record<string, unknown> : {};
  const filesystem = source.filesystem && typeof source.filesystem === "object"
    ? source.filesystem as Record<string, unknown>
    : {};

  const fallbackEnv = fallback.env ?? defaultToolSandboxSettings.env;
  const fallbackNetwork = fallback.network ?? defaultToolSandboxSettings.network;
  const fallbackFilesystem = fallback.filesystem ?? defaultToolSandboxSettings.filesystem;

  return {
    envFilePath: String(source.envFilePath ?? fallback.envFilePath ?? defaultToolSandboxSettings.envFilePath).trim()
      || defaultToolSandboxSettings.envFilePath,
    env: {
      inheritMode: sanitizeEnvInheritMode(env.inheritMode, fallbackEnv.inheritMode),
      allow: sanitizeStringList(env.allow, fallbackEnv.allow),
      deny: sanitizeStringList(env.deny, fallbackEnv.deny)
    },
    network: {
      allowedDomains: sanitizeStringList(network.allowedDomains, fallbackNetwork.allowedDomains),
      deniedDomains: sanitizeStringList(network.deniedDomains, fallbackNetwork.deniedDomains)
    },
    filesystem: {
      denyRead: sanitizeStringList(filesystem.denyRead, fallbackFilesystem.denyRead),
      allowWrite: sanitizeStringList(filesystem.allowWrite, fallbackFilesystem.allowWrite),
      denyWrite: sanitizeStringList(filesystem.denyWrite, fallbackFilesystem.denyWrite)
    }
  };
}
