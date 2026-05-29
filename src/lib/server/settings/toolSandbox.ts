import type {
  ToolSandboxEnvInheritMode,
  ToolSandboxInitFailureMode,
  ToolSandboxSettings
} from "$lib/server/settings/schema.js";

const DEFAULT_DENY_READ = [
  "~/.ssh",
  "~/.aws",
  "~/.gnupg",
  ".env",
  ".env.*",
  ".env.sandbox.local"
];

const DEFAULT_DENY_WRITE = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key"
];

export const defaultToolSandboxSettings: ToolSandboxSettings = {
  enabled: true,
  initFailureMode: "warn-disable",
  envFilePath: ".env.sandbox.local",
  env: {
    inheritMode: "full",
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

function sanitizeInitFailureMode(input: unknown, fallback: ToolSandboxInitFailureMode): ToolSandboxInitFailureMode {
  const value = String(input ?? "").trim();
  if (value === "warn-disable" || value === "block") return value;
  return fallback;
}

function sanitizeEnvInheritMode(input: unknown, fallback: ToolSandboxEnvInheritMode): ToolSandboxEnvInheritMode {
  const value = String(input ?? "").trim();
  if (value === "minimal" || value === "allowlist" || value === "full") return value;
  return fallback;
}

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
    enabled: source.enabled === undefined ? fallback.enabled : Boolean(source.enabled),
    initFailureMode: sanitizeInitFailureMode(source.initFailureMode, fallback.initFailureMode),
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
