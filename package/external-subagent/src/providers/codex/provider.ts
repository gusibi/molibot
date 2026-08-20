import { existsSync, statSync } from "node:fs";
import { buildProviderEnv } from "../../environment.js";
import { spawnManagedProcess, type ManagedProcessHandle } from "../../managedProcess.js";
import { resolveCodex } from "../../resolver.js";
import type {
  CodexPermissionMode,
  ExternalSubagentProvider,
  ExternalSubagentRequest,
  ExternalSubagentResult,
  ExternalSubagentStopReason,
  ProviderAvailability
} from "../../types.js";
import { CodexAppServerWire, type CodexWireFailureFacts } from "./wire.js";

function failureDiagnostic(facts: { stage: string; category: string; httpStatus?: number }): string {
  const fields = ["product: Codex", `stage: ${facts.stage}`, `category: ${facts.category}`];
  if (facts.httpStatus !== undefined) {
    fields.push(`HTTP status: ${facts.httpStatus}`);
  }
  return `Codex subagent failure (${fields.join("; ")})`;
}

export class CodexProvider implements ExternalSubagentProvider {
  readonly id = "codex" as const;

  constructor(
    private readonly options?: {
      runtimesDir?: string;
      disposeGraceMs?: number;
    }
  ) {}

  async isAvailable(options?: { customPath?: string }): Promise<ProviderAvailability> {
    return resolveCodex({
      customPath: options?.customPath,
      runtimesDir: this.options?.runtimesDir
    });
  }

  async run(request: ExternalSubagentRequest): Promise<ExternalSubagentResult> {
    const startTime = Date.now();

    if (!request.task || request.task.trim().length === 0) {
      throw new Error("Codex subagent: task must be a non-empty string");
    }

    if (!request.cwd || !existsSync(request.cwd) || !statSync(request.cwd).isDirectory()) {
      throw new Error(`Codex subagent: cwd must be an existing directory (${request.cwd})`);
    }

    if (request.signal?.aborted) {
      return {
        provider: "codex",
        output: "",
        stopReason: "aborted",
        diagnostic: "Codex run aborted before startup",
        durationMs: 0
      };
    }

    const availability = await this.isAvailable({ customPath: request.customPath });
    if (!availability.available || !availability.executablePath) {
      return {
        provider: "codex",
        output: "",
        stopReason: "not_installed",
        diagnostic: availability.error || "Codex executable not found",
        durationMs: Date.now() - startTime
      };
    }

    const permissionMode: CodexPermissionMode =
      (request.permissionMode as CodexPermissionMode) || "never";

    // Determine argv: if executable is a JS file, execute with node; otherwise run directly
    const argv = availability.executablePath.endsWith(".js") || availability.executablePath.endsWith(".mjs") || availability.executablePath.endsWith(".cjs")
      ? [process.execPath, availability.executablePath, "app-server", "--stdio"]
      : [availability.executablePath, "app-server", "--stdio"];

    const env = buildProviderEnv("codex", request.env);
    let child: ManagedProcessHandle;
    try {
      child = spawnManagedProcess({
        argv,
        cwd: request.cwd,
        env,
        stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
        graceMs: this.options?.disposeGraceMs,
        signal: request.signal
      });
    } catch (err: unknown) {
      return {
        provider: "codex",
        output: "",
        stopReason: request.signal?.aborted ? "aborted" : "error",
        diagnostic: `Failed to spawn Codex process: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startTime
      };
    }

    const wire = new CodexAppServerWire(child.stdout!, child.stdin!, permissionMode);
    child.stderr?.on("data", (chunk: Buffer) => {
      wire.observeStderr(chunk.toString("utf8"));
    });

    const dispose = async (): Promise<void> => {
      wire.close();
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      child.terminate();
      try {
        await child.waitForExit();
      } catch {
        // ignore
      }
    };

    let stopReason: ExternalSubagentStopReason = "completed";
    let output = "";
    let diagnostic: string | undefined;

    try {
      wire.start();
      await wire.initialize(request.signal!);
      await wire.startThread(request.cwd, request.signal!);

      const result = await wire.runTurn([request.task], request.signal!);
      output = result.output;
      stopReason = result.stopReason;
    } catch (err: unknown) {
      if (request.signal?.aborted) {
        stopReason = "aborted";
        diagnostic = "Codex run was cancelled by user";
      } else {
        stopReason = "error";
        const facts = wire.collectFailure();
        diagnostic = failureDiagnostic(facts);
      }
    } finally {
      await dispose();
    }

    const permissionDiag = wire.collectDiagnostic();
    if (permissionDiag) {
      diagnostic = diagnostic ? `${diagnostic}\n${permissionDiag}` : permissionDiag;
    }

    return {
      provider: "codex",
      output,
      stopReason,
      diagnostic,
      durationMs: Date.now() - startTime
    };
  }
}
