import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildProviderEnv } from "../../environment.js";
import { spawnManagedProcess, type ManagedProcessHandle } from "../../managedProcess.js";
import { resolveClaudeCode } from "../../resolver.js";
import type {
  ClaudeCodePermissionMode,
  ExternalSubagentProvider,
  ExternalSubagentRequest,
  ExternalSubagentResult,
  ExternalSubagentStopReason,
  ProviderAvailability
} from "../../types.js";
import { ManagedClaudeCodeProcess } from "./processAdapter.js";

function unattendedDiagnostic(
  mode: ClaudeCodePermissionMode,
  request: string,
  decision: string,
  reason: string
): string {
  return `Claude Code unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`;
}

export class ClaudeCodeProvider implements ExternalSubagentProvider {
  readonly id = "claude-code" as const;

  constructor(
    private readonly options?: {
      runtimesDir?: string;
      disposeGraceMs?: number;
    }
  ) {}

  async isAvailable(options?: { customPath?: string }): Promise<ProviderAvailability> {
    return resolveClaudeCode({
      customPath: options?.customPath,
      runtimesDir: this.options?.runtimesDir
    });
  }

  async run(request: ExternalSubagentRequest): Promise<ExternalSubagentResult> {
    const startTime = Date.now();

    if (!request.task || request.task.trim().length === 0) {
      throw new Error("Claude Code subagent: task must be a non-empty string");
    }

    if (!request.cwd || !existsSync(request.cwd) || !statSync(request.cwd).isDirectory()) {
      throw new Error(`Claude Code subagent: cwd must be an existing directory (${request.cwd})`);
    }

    if (request.signal?.aborted) {
      return {
        provider: "claude-code",
        output: "",
        stopReason: "aborted",
        diagnostic: "Claude Code run aborted before startup",
        durationMs: 0
      };
    }

    const availability = await this.isAvailable({ customPath: request.customPath });
    if (!availability.available) {
      return {
        provider: "claude-code",
        output: "",
        stopReason: "not_installed",
        diagnostic: availability.error || "Claude Code SDK/executable not found",
        durationMs: Date.now() - startTime
      };
    }

    const permissionMode: ClaudeCodePermissionMode =
      (request.permissionMode as ClaudeCodePermissionMode) || "dontAsk";

    // Try to load @anthropic-ai/claude-agent-sdk
    let sdkModule: any;
    try {
      const specifier = availability.packagePath
        ? pathToFileURL(availability.packagePath).href
        : "@anthropic-ai/claude-agent-sdk";
      sdkModule = await import(/* @vite-ignore */ specifier);
    } catch {
      // If dynamic import failed, but system CLI is available
      if (availability.source === "system" && availability.executablePath) {
        return this.runViaCli(availability.executablePath, request, permissionMode, startTime);
      }
      return {
        provider: "claude-code",
        output: "",
        stopReason: "not_installed",
        diagnostic: "Failed to load @anthropic-ai/claude-agent-sdk",
        durationMs: Date.now() - startTime
      };
    }

    return this.runViaSdk(sdkModule, request, permissionMode, startTime);
  }

  private async runViaSdk(
    sdk: any,
    request: ExternalSubagentRequest,
    permissionMode: ClaudeCodePermissionMode,
    startTime: number
  ): Promise<ExternalSubagentResult> {
    const env = buildProviderEnv("claude-code", request.env);
    const controller = new AbortController();

    const onParentAbort = (): void => {
      if (!controller.signal.aborted) {
        controller.abort(new Error("Claude Code run cancelled by parent"));
      }
    };
    request.signal?.addEventListener("abort", onParentAbort, { once: true });

    let childHandle: ManagedProcessHandle | undefined;
    let diagnostic: string | undefined;
    const captureDiagnostic = (text: string): void => {
      diagnostic = diagnostic ? `${diagnostic}\n${text}` : text;
    };

    let query: any;
    try {
      const options = {
        abortController: controller,
        cwd: request.cwd,
        env,
        persistSession: false,
        disallowedTools: permissionMode === "plan" ? ["AskUserQuestion", "ExitPlanMode"] : ["AskUserQuestion"],
        permissionMode,
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {
              canUseTool: () => {
                captureDiagnostic(
                  unattendedDiagnostic(
                    permissionMode,
                    "tool permission",
                    "denied",
                    "This unattended Claude Code subagent cannot request human approval."
                  )
                );
                return Promise.resolve({
                  behavior: "deny",
                  message: "This unattended Claude Code subagent cannot request human approval."
                });
              }
            }),
        onElicitation: () => {
          captureDiagnostic(
            unattendedDiagnostic(
              permissionMode,
              "MCP elicitation",
              "declined",
              "the provider does not collect interactive MCP input"
            )
          );
          return Promise.resolve({ action: "decline" });
        },
        onUserDialog: () => {
          captureDiagnostic(
            unattendedDiagnostic(
              permissionMode,
              "user dialog",
              "cancelled",
              "the provider does not render blocking dialogs"
            )
          );
          return Promise.resolve({ behavior: "cancelled" });
        },
        spawnClaudeCodeProcess: (spawnOpts: any) => {
          const child = spawnManagedProcess({
            argv: [spawnOpts.command, ...(spawnOpts.args ?? [])],
            cwd: spawnOpts.cwd || request.cwd,
            env: { ...env, ...(spawnOpts.env ?? {}) },
            graceMs: this.options?.disposeGraceMs,
            signal: spawnOpts.signal
          });
          childHandle = child;
          return new ManagedClaudeCodeProcess(child);
        }
      };

      query = sdk.query({
        prompt: request.task,
        options
      });
    } catch (err: unknown) {
      request.signal?.removeEventListener("abort", onParentAbort);
      return {
        provider: "claude-code",
        output: "",
        stopReason: request.signal?.aborted ? "aborted" : "error",
        diagnostic: `Failed to initialize Claude Agent SDK: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime
      };
    }

    let output = "";
    let stopReason: ExternalSubagentStopReason = "completed";

    try {
      for await (const message of query) {
        if (message.type === "system" && message.subtype === "permission_denied") {
          captureDiagnostic(
            unattendedDiagnostic(
              permissionMode,
              "tool permission",
              "denied",
              "Claude Code denied the request before an interactive prompt"
            )
          );
          continue;
        }
        if (message.type === "result") {
          if (message.subtype === "success" && !message.is_error) {
            output = message.result ?? "";
          } else {
            stopReason = "error";
            const errors = Array.isArray(message.errors) ? message.errors.join("; ") : "";
            captureDiagnostic(`Claude Code ended with error (${message.subtype}): ${errors}`);
          }
        }
      }
      if (!output && stopReason === "completed") {
        stopReason = "error";
        captureDiagnostic("Claude Code query finished without a success result");
      }
    } catch (err: unknown) {
      if (request.signal?.aborted || controller.signal.aborted) {
        stopReason = "aborted";
        captureDiagnostic("Claude Code run was cancelled by user");
      } else {
        stopReason = "error";
        captureDiagnostic(`Claude Code execution error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      request.signal?.removeEventListener("abort", onParentAbort);
      try {
        query?.close();
      } catch {
        // ignore
      }
      if (childHandle) {
        childHandle.terminate();
        try {
          await childHandle.waitForExit();
        } catch {
          // ignore
        }
      }
    }

    return {
      provider: "claude-code",
      output,
      stopReason,
      diagnostic,
      durationMs: Date.now() - startTime
    };
  }

  private async runViaCli(
    cliPath: string,
    request: ExternalSubagentRequest,
    _permissionMode: ClaudeCodePermissionMode,
    startTime: number
  ): Promise<ExternalSubagentResult> {
    const env = buildProviderEnv("claude-code", request.env);
    let child: ManagedProcessHandle;
    try {
      child = spawnManagedProcess({
        argv: [cliPath, "--print", request.task],
        cwd: request.cwd,
        env,
        stdio: { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        graceMs: this.options?.disposeGraceMs,
        signal: request.signal
      });
    } catch (err: unknown) {
      return {
        provider: "claude-code",
        output: "",
        stopReason: request.signal?.aborted ? "aborted" : "error",
        diagnostic: `Failed to spawn Claude CLI: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime
      };
    }

    let stdoutData = "";
    let stderrData = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutData += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString("utf8");
    });

    try {
      const outcome = await child.done;
      if (request.signal?.aborted) {
        return {
          provider: "claude-code",
          output: "",
          stopReason: "aborted",
          diagnostic: "Claude Code CLI run cancelled",
          durationMs: Date.now() - startTime
        };
      }
      if (outcome.exitCode === 0) {
        return {
          provider: "claude-code",
          output: stdoutData.trim(),
          stopReason: "completed",
          durationMs: Date.now() - startTime
        };
      }
      return {
        provider: "claude-code",
        output: stdoutData.trim(),
        stopReason: "error",
        diagnostic: `Claude CLI exited with code ${outcome.exitCode}: ${stderrData.slice(0, 300)}`,
        durationMs: Date.now() - startTime
      };
    } finally {
      child.terminate();
      try {
        await child.waitForExit();
      } catch {
        // ignore
      }
    }
  }
}
