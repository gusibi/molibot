import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import dotenv from "dotenv";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { config } from "../../app/env.js";
import type { ToolSandboxSettings } from "../../settings/index.js";

const SANDBOX_VENV_DIR = join(config.dataDir, "tooling", "sandbox-venv");

export interface ToolSandboxPrepareInput {
  settings: ToolSandboxSettings;
  cwd: string;
  workspaceDir: string;
  command: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ToolSandboxPrepareResult {
  command: string;
  env: NodeJS.ProcessEnv;
  inheritProcessEnv: boolean;
  sandboxApplied: boolean;
  warning?: string;
}

export interface ToolSandboxDiagnostics {
  enabled: boolean;
  platform: NodeJS.Platform;
  supportedPlatform: boolean;
  dependenciesAvailable: boolean;
  envFilePath: string;
  envFileExists: boolean;
  envFileReadable: boolean;
  envFileError?: string;
  envKeysAvailable: string[];
  envKeysInjected: string[];
  envKeysDenied: string[];
  sandboxInitialized: boolean;
  sandboxError?: string;
  effectiveNetwork: ToolSandboxSettings["network"];
  effectiveFilesystem: ToolSandboxSettings["filesystem"];
}

const INTERNAL_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "SHELL"
]);
let initializedConfigKey = "";
let initializationPromise: Promise<void> | null = null;
let lastInitializationError = "";

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pattern === value || patternToRegex(pattern).test(value));
}

function resolveEnvFilePath(settings: ToolSandboxSettings): string {
  const rawPath = settings.envFilePath.trim() || ".env.sandbox.local";
  return isAbsolute(rawPath) ? rawPath : resolve(config.dataDir, rawPath);
}

function readEnvFile(filePath: string): { values: Record<string, string>; error?: string } {
  if (!existsSync(filePath)) return { values: {} };
  try {
    return { values: dotenv.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return {
      values: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function minimalHostEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of INTERNAL_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function buildExternalEnv(settings: ToolSandboxSettings, envFileValues: Record<string, string>): {
  env: NodeJS.ProcessEnv;
  availableKeys: string[];
  injectedKeys: string[];
  deniedKeys: string[];
} {
  const inherited = settings.env.inheritMode === "full"
    ? { ...process.env }
    : settings.env.inheritMode === "allowlist"
      ? { ...process.env }
      : {};
  const source: Record<string, string | undefined> = {
    ...inherited,
    ...envFileValues
  };
  const availableKeys = Object.keys(source).sort();
  const env: NodeJS.ProcessEnv = {};
  const injectedKeys: string[] = [];
  const deniedKeys: string[] = [];

  for (const key of availableKeys) {
    const denied = matchesPattern(key, settings.env.deny);
    const allowed = settings.env.inheritMode === "full" || matchesPattern(key, settings.env.allow);
    if (denied) {
      deniedKeys.push(key);
      continue;
    }
    if (!allowed) continue;
    const value = source[key];
    if (value === undefined) continue;
    env[key] = value;
    injectedKeys.push(key);
  }

  return { env, availableKeys, injectedKeys, deniedKeys };
}

export function buildToolSandboxEnv(settings: ToolSandboxSettings, workspaceDir: string, internalEnv: NodeJS.ProcessEnv = {}): {
  env: NodeJS.ProcessEnv;
  envFilePath: string;
  envFileExists: boolean;
  envFileReadable: boolean;
  envFileError?: string;
  availableKeys: string[];
  injectedKeys: string[];
  deniedKeys: string[];
} {
  const envFilePath = resolveEnvFilePath(settings);
  const envFileExists = existsSync(envFilePath);
  const envFile = readEnvFile(envFilePath);
  const external = buildExternalEnv(settings, envFile.values);

  return {
    env: {
      ...minimalHostEnv(),
      ...external.env,
      ...internalEnv
    },
    envFilePath,
    envFileExists,
    envFileReadable: envFileExists && !envFile.error,
    envFileError: envFile.error,
    availableKeys: external.availableKeys,
    injectedKeys: external.injectedKeys,
    deniedKeys: external.deniedKeys
  };
}

function isSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "linux";
}

function checkSandboxDependencies(): boolean {
  try {
    return SandboxManager.checkDependencies();
  } catch {
    return false;
  }
}

function isAllowAll(domains: string[]): boolean {
  return domains.length === 1 && domains[0] === "*";
}

function buildEffectiveSandboxConfig(settings: ToolSandboxSettings, cwd: string, workspaceDir: string): SandboxRuntimeConfig {
  const envFilePath = resolveEnvFilePath(settings);
  return {
    network: {
      allowedDomains: isAllowAll(settings.network.allowedDomains)
        ? ["*"]
        : settings.network.allowedDomains,
      deniedDomains: settings.network.deniedDomains
    },
    filesystem: {
      denyRead: unique([...settings.filesystem.denyRead, envFilePath]),
      allowWrite: unique([...settings.filesystem.allowWrite, ".", cwd, "/tmp", SANDBOX_VENV_DIR]),
      denyWrite: unique([...settings.filesystem.denyWrite, envFilePath])
    }
  };
}

function configKey(configValue: SandboxRuntimeConfig): string {
  return JSON.stringify(configValue);
}

async function ensureSandboxInitialized(settings: ToolSandboxSettings, cwd: string, workspaceDir: string): Promise<void> {
  const effective = buildEffectiveSandboxConfig(settings, cwd, workspaceDir);
  const nextKey = configKey(effective);
  if (initializedConfigKey === nextKey && !lastInitializationError) return;
  if (initializationPromise) return initializationPromise;

  const allowAll = isAllowAll(settings.network.allowedDomains);
  const sandboxAskCallback = allowAll
    ? async () => true
    : undefined;

  initializationPromise = (async () => {
    try {
      if (initializedConfigKey && initializedConfigKey !== nextKey) {
        await SandboxManager.reset();
      }
      await SandboxManager.initialize(effective, sandboxAskCallback);
      initializedConfigKey = nextKey;
      lastInitializationError = "";
    } catch (error) {
      initializedConfigKey = "";
      lastInitializationError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

export async function prepareToolSandboxExecution(input: ToolSandboxPrepareInput): Promise<ToolSandboxPrepareResult> {
  if (!input.settings.enabled) {
    return {
      command: input.command,
      env: input.env,
      inheritProcessEnv: true,
      sandboxApplied: false
    };
  }

  if (!isSupportedPlatform()) {
    return {
      command: input.command,
      env: input.env,
      inheritProcessEnv: true,
      sandboxApplied: false,
      warning: `Sandbox is not supported on ${process.platform}.`
    };
  }

  const envDetails = buildToolSandboxEnv(input.settings, input.workspaceDir, input.env);

  try {
    if (!checkSandboxDependencies()) {
      throw new Error("Sandbox dependencies are missing.");
    }
    await ensureSandboxInitialized(input.settings, input.cwd, input.workspaceDir);
    const command = await SandboxManager.wrapWithSandbox(input.command, undefined, undefined, input.signal);
    return {
      command,
      env: envDetails.env,
      inheritProcessEnv: false,
      sandboxApplied: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.settings.initFailureMode === "block") {
      throw new Error(`Sandbox initialization failed: ${message}`);
    }
    return {
      command: input.command,
      env: input.env,
      inheritProcessEnv: true,
      sandboxApplied: false,
      warning: `Sandbox disabled after initialization failure: ${message}`
    };
  }
}

export async function getToolSandboxDiagnostics(
  settings: ToolSandboxSettings,
  workspaceDir: string,
  cwd = workspaceDir
): Promise<ToolSandboxDiagnostics> {
  const envDetails = buildToolSandboxEnv(settings, workspaceDir);
  const supportedPlatform = isSupportedPlatform();
  const dependenciesAvailable = supportedPlatform ? checkSandboxDependencies() : false;
  let sandboxInitialized = false;
  let sandboxError: string | undefined;

  if (settings.enabled && supportedPlatform && dependenciesAvailable) {
    try {
      await ensureSandboxInitialized(settings, cwd, workspaceDir);
      sandboxInitialized = true;
    } catch (error) {
      sandboxError = error instanceof Error ? error.message : String(error);
    }
  } else if (lastInitializationError) {
    sandboxError = lastInitializationError;
  }

  const effective = buildEffectiveSandboxConfig(settings, cwd, workspaceDir);
  return {
    enabled: settings.enabled,
    platform: process.platform,
    supportedPlatform,
    dependenciesAvailable,
    envFilePath: envDetails.envFilePath,
    envFileExists: envDetails.envFileExists,
    envFileReadable: envDetails.envFileReadable,
    envFileError: envDetails.envFileError,
    envKeysAvailable: envDetails.availableKeys,
    envKeysInjected: envDetails.injectedKeys,
    envKeysDenied: envDetails.deniedKeys,
    sandboxInitialized,
    sandboxError,
    effectiveNetwork: effective.network,
    effectiveFilesystem: effective.filesystem
  };
}
