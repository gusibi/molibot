import { execCommand, wrapCommandWithVenv } from "$lib/server/agent/tools/helpers.js";
import {
  buildSandboxEnvFileInjection,
  getSandboxProvider,
  prepareToolSandboxExecution
} from "$lib/server/agent/tools/sandbox.js";
import type { ToolSandboxSettings } from "$lib/server/settings/index.js";

/**
 * The shared execution boundary.
 *
 * One entry owns running a command for an Agent attempt: which backend runs
 * it, the streamed output, the final status, cancellation and the
 * execution-environment lifecycle. Conversation logic, tool dispatch and
 * channels never wrap commands themselves — a future sandbox backend plugs in
 * here without touching any of them.
 *
 * A backend is bound to an attempt together with its workspace (`bindExecutionEnvironment`),
 * so changing the configured backend or mode governs the next attempt and can
 * never relocate a command that is already running, and two concurrent
 * attempts cannot exchange configuration.
 */

export const HOST_BACKEND_ID = "host";
export const SANDBOX_BACKEND_ID = "anthropic-local-sandbox";

export interface ExecutionBackendCapabilities {
  id: string;
  /** Provider name shown in the Execution-environment settings; UI translates around it. */
  displayName: string;
  executionTarget: "sandbox" | "host" | "none";
  /** Declared restriction support: unsupported restrictions cannot be configured as if enforced. */
  supportsNetworkDomainRestrictions: boolean;
  supportsFilesystemRestrictions: boolean;
  supportsEnvInjection: boolean;
}

export interface CommandExecutionRequest {
  /** Raw shell command; tooling-env wrapping happens inside the backend. */
  command: string;
  cwd: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  /** Extra internal env entries (e.g. the scratch artifact dir). */
  env?: NodeJS.ProcessEnv;
}

export interface CommandExecutionResult {
  code: number;
  stdout: string;
  stderr: string;
  sandboxApplied: boolean;
  warning?: string;
}

export interface ExecutionAvailability {
  supportedPlatform: boolean;
  dependenciesAvailable: boolean;
  error?: string;
}

export interface BoundExecutionEnvironment {
  readonly backend: ExecutionBackendCapabilities;
  /** Workspace identity the whole attempt's commands and file operations share. */
  readonly workspaceDir: string;
  execute(request: CommandExecutionRequest): Promise<CommandExecutionResult>;
}

export interface ExecutionBackend {
  readonly capabilities: ExecutionBackendCapabilities;
  /** Declared availability for diagnostics; execution still fails closed. */
  checkAvailability(): ExecutionAvailability;
  bindEnvironment(bind: { workspaceDir: string; sandboxSettings: ToolSandboxSettings }): BoundExecutionEnvironment;
}

/**
 * Direct host execution. Full access (Auto) and the approved Host Bash paths
 * land here: the process's own environment plus the configured env-file keys,
 * so credentials injected through Execution-environment settings keep working
 * without the sandbox.
 */
export class HostExecutionBackend implements ExecutionBackend {
  readonly capabilities: ExecutionBackendCapabilities = {
    id: HOST_BACKEND_ID,
    displayName: "Host",
    executionTarget: "host",
    supportsNetworkDomainRestrictions: false,
    supportsFilesystemRestrictions: false,
    supportsEnvInjection: true
  };

  checkAvailability(): ExecutionAvailability {
    return { supportedPlatform: true, dependenciesAvailable: true };
  }

  bindEnvironment(bind: { workspaceDir: string; sandboxSettings: ToolSandboxSettings }): BoundExecutionEnvironment {
    return {
      backend: this.capabilities,
      workspaceDir: bind.workspaceDir,
      execute: async (request) => {
        const envFileKeys = buildSandboxEnvFileInjection(bind.sandboxSettings);
        const result = await execCommand(wrapCommandWithVenv(request.command), {
          cwd: request.cwd,
          timeoutSeconds: request.timeoutSeconds,
          signal: request.signal,
          env: { ...envFileKeys, ...(request.env ?? {}) },
          inheritProcessEnv: true
        });
        return { code: result.code, stdout: result.stdout, stderr: result.stderr, sandboxApplied: false };
      }
    };
  }
}

/**
 * The Anthropic local sandbox adapter. Provider-specific command wrapping and
 * local OS dependency checks live inside this adapter; the rest of the system
 * only sees the shared boundary. Fail-closed semantics are preserved: an
 * unavailable platform or missing dependencies throw before any command runs.
 */
export class AnthropicLocalSandboxBackend implements ExecutionBackend {
  readonly capabilities: ExecutionBackendCapabilities = {
    id: SANDBOX_BACKEND_ID,
    displayName: "Anthropic Local Sandbox",
    executionTarget: "sandbox",
    supportsNetworkDomainRestrictions: true,
    supportsFilesystemRestrictions: true,
    supportsEnvInjection: true
  };

  checkAvailability(): ExecutionAvailability {
    const supportedPlatform = process.platform === "darwin" || process.platform === "linux";
    if (!supportedPlatform) {
      return {
        supportedPlatform: false,
        dependenciesAvailable: false,
        error: `Sandbox is not supported on ${process.platform}.`
      };
    }
    const provider = getSandboxProvider();
    let dependenciesAvailable = false;
    try {
      dependenciesAvailable = provider.checkDependencies();
    } catch (error) {
      return {
        supportedPlatform,
        dependenciesAvailable: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      supportedPlatform,
      dependenciesAvailable,
      error: dependenciesAvailable ? undefined : "Sandbox dependencies are missing."
    };
  }

  bindEnvironment(bind: { workspaceDir: string; sandboxSettings: ToolSandboxSettings }): BoundExecutionEnvironment {
    return {
      backend: this.capabilities,
      workspaceDir: bind.workspaceDir,
      execute: async (request) => {
        const prepared = await prepareToolSandboxExecution({
          settings: bind.sandboxSettings,
          workspaceDir: bind.workspaceDir,
          cwd: request.cwd,
          command: wrapCommandWithVenv(request.command),
          env: request.env,
          signal: request.signal
        });
        const result = await execCommand(prepared.command, {
          cwd: request.cwd,
          timeoutSeconds: request.timeoutSeconds,
          signal: request.signal,
          env: prepared.env,
          inheritProcessEnv: prepared.inheritProcessEnv
        });
        return {
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          sandboxApplied: prepared.sandboxApplied,
          warning: prepared.warning
        };
      }
    };
  }
}

const activeBackends: Record<"sandbox" | "host", ExecutionBackend> = {
  sandbox: new AnthropicLocalSandboxBackend(),
  host: new HostExecutionBackend()
};

export function getExecutionBackend(target: "sandbox" | "host"): ExecutionBackend {
  return activeBackends[target];
}

/** Test injection point: swap in a scripted backend, restore the previous one afterwards. */
export function setExecutionBackend(target: "sandbox" | "host", backend: ExecutionBackend): ExecutionBackend {
  const previous = activeBackends[target];
  activeBackends[target] = backend;
  return previous;
}

/**
 * Binds one attempt's execution environment: backend chosen by the effective
 * policy's execution target, workspace identity fixed for the attempt's whole
 * lifetime. Plan mode binds an explicit no-execution environment — an honest
 * refusal, not a silent host fallback.
 */
export function bindExecutionEnvironment(options: {
  executionTarget: "sandbox" | "host" | "none";
  workspaceDir: string;
  sandboxSettings: ToolSandboxSettings;
}): BoundExecutionEnvironment {
  if (options.executionTarget === "none") {
    const noneBackend: ExecutionBackendCapabilities = {
      id: "none",
      displayName: "None",
      executionTarget: "none",
      supportsNetworkDomainRestrictions: false,
      supportsFilesystemRestrictions: false,
      supportsEnvInjection: false
    };
    return {
      backend: noneBackend,
      workspaceDir: options.workspaceDir,
      execute: async () => {
        throw new Error("Plan mode is read-only: shell execution is unavailable.");
      }
    };
  }
  return getExecutionBackend(options.executionTarget).bindEnvironment({
    workspaceDir: options.workspaceDir,
    sandboxSettings: options.sandboxSettings
  });
}
