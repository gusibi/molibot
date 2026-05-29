import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import dotenv from "dotenv";
import { SandboxManager, type SandboxRuntimeConfig as AnthropicSandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { config } from "$lib/server/app/env.js";
import type { ToolSandboxSettings } from "$lib/server/settings/index.js";

const SANDBOX_VENV_DIR = join(config.dataDir, "tooling", "sandbox-venv");

// Decoupled Configuration Types
export interface SandboxNetworkConfig {
  allowedDomains: string[];
  deniedDomains?: string[];
}

export interface SandboxFilesystemConfig {
  denyRead?: string[];
  allowWrite?: string[];
  denyWrite?: string[];
}

export interface SandboxRuntimeConfig {
  network?: SandboxNetworkConfig;
  filesystem?: SandboxFilesystemConfig;
}

// Decoupled Sandbox Provider Interface
export interface SandboxProvider {
  readonly name: string;
  checkDependencies(): boolean;
  initialize(config: SandboxRuntimeConfig, callback?: () => Promise<boolean>): Promise<void>;
  reset(): Promise<void>;
  wrapWithSandbox(command: string, options?: { signal?: AbortSignal }): Promise<string>;
  isInitialized(): boolean;
  getLastError(): string | undefined;
}

// Anthropic Sandbox Runtime SDK Implementation
export class AnthropicSandboxProvider implements SandboxProvider {
  readonly name = "anthropic";
  private initializedConfigKey = "";
  private initializationPromise: Promise<void> | null = null;
  private lastInitializationError = "";

  checkDependencies(): boolean {
    try {
      return SandboxManager.checkDependencies();
    } catch {
      return false;
    }
  }

  async initialize(config: SandboxRuntimeConfig, callback?: () => Promise<boolean>): Promise<void> {
    const nextKey = JSON.stringify(config);
    if (this.initializedConfigKey === nextKey && !this.lastInitializationError) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        if (this.initializedConfigKey && this.initializedConfigKey !== nextKey) {
          await SandboxManager.reset();
        }
        await SandboxManager.initialize(config as AnthropicSandboxRuntimeConfig, callback);
        this.initializedConfigKey = nextKey;
        this.lastInitializationError = "";
      } catch (error) {
        this.initializedConfigKey = "";
        this.lastInitializationError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  async reset(): Promise<void> {
    await SandboxManager.reset();
    this.initializedConfigKey = "";
    this.initializationPromise = null;
    this.lastInitializationError = "";
  }

  async wrapWithSandbox(command: string, options?: { signal?: AbortSignal }): Promise<string> {
    return SandboxManager.wrapWithSandbox(command, undefined, undefined, options?.signal);
  }

  isInitialized(): boolean {
    return !!this.initializedConfigKey && !this.lastInitializationError;
  }

  getLastError(): string | undefined {
    return this.lastInitializationError || undefined;
  }
}

// Provider Registry / Dynamic Binding
let activeSandboxProvider: SandboxProvider = new AnthropicSandboxProvider();

export function getSandboxProvider(): SandboxProvider {
  return activeSandboxProvider;
}

export function setSandboxProvider(provider: SandboxProvider): void {
  activeSandboxProvider = provider;
}

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
  envKeysMissing: string[];
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
  missingKeys: string[];
} {
  const inherited = { ...process.env };
  const source: Record<string, string | undefined> = {
    ...inherited,
    ...envFileValues
  };
  const availableKeys = Object.keys(source).sort();
  const env: NodeJS.ProcessEnv = {};
  const injectedKeys: string[] = [];
  const deniedKeys: string[] = [];
  const missingKeys: string[] = [];
  const requiredAllowKeys = settings.env.inheritMode === "full"
    ? []
    : unique(settings.env.allow);

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

  for (const key of requiredAllowKeys) {
    if (source[key] === undefined) {
      missingKeys.push(key);
    }
  }

  return { env, availableKeys, injectedKeys, deniedKeys, missingKeys };
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
  missingKeys: string[];
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
    deniedKeys: external.deniedKeys,
    missingKeys: external.missingKeys
  };
}

export interface ToolSandboxEnvStartupReport {
  enabled: boolean;
  envFilePath: string;
  envKeysInjected: string[];
  envKeysMissing: string[];
}

export function getToolSandboxEnvStartupReport(
  settings: ToolSandboxSettings,
  workspaceDir: string
): ToolSandboxEnvStartupReport {
  const envDetails = buildToolSandboxEnv(settings, workspaceDir);
  return {
    enabled: settings.enabled,
    envFilePath: envDetails.envFilePath,
    envKeysInjected: envDetails.injectedKeys,
    envKeysMissing: envDetails.missingKeys
  };
}

function isSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  if (activeSandboxProvider.name === "anthropic") {
    return platform === "darwin" || platform === "linux";
  }
  return true;
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
  const provider = getSandboxProvider();

  try {
    if (!provider.checkDependencies()) {
      throw new Error("Sandbox dependencies are missing.");
    }
    const effective = buildEffectiveSandboxConfig(input.settings, input.cwd, input.workspaceDir);
    const allowAll = isAllowAll(input.settings.network.allowedDomains);
    const sandboxAskCallback = allowAll ? async () => true : undefined;

    await provider.initialize(effective, sandboxAskCallback);
    const command = await provider.wrapWithSandbox(input.command, { signal: input.signal });
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
  const provider = getSandboxProvider();
  const dependenciesAvailable = supportedPlatform ? provider.checkDependencies() : false;
  let sandboxInitialized = false;
  let sandboxError: string | undefined;

  if (settings.enabled && supportedPlatform && dependenciesAvailable) {
    try {
      const effective = buildEffectiveSandboxConfig(settings, cwd, workspaceDir);
      const allowAll = isAllowAll(settings.network.allowedDomains);
      const sandboxAskCallback = allowAll ? async () => true : undefined;
      await provider.initialize(effective, sandboxAskCallback);
      sandboxInitialized = true;
    } catch (error) {
      sandboxError = error instanceof Error ? error.message : String(error);
    }
  } else {
    sandboxError = provider.getLastError();
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
    envKeysMissing: envDetails.missingKeys,
    sandboxInitialized,
    sandboxError,
    effectiveNetwork: {
      allowedDomains: effective.network?.allowedDomains ?? [],
      deniedDomains: effective.network?.deniedDomains ?? []
    },
    effectiveFilesystem: {
      denyRead: effective.filesystem?.denyRead ?? [],
      allowWrite: effective.filesystem?.allowWrite ?? [],
      denyWrite: effective.filesystem?.denyWrite ?? []
    }
  };
}
