import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import type {
  MiniAppAiFacade,
  MiniAppBadgeFacade,
  MiniAppHttpRequest,
  MiniAppHttpResult,
  MiniAppLogger,
  MiniAppRuntime,
  MiniAppToolCallContext,
  MiniAppToolResult
} from "$lib/server/miniapps/types.js";

const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const LOAD_TIMEOUT_MS = 15_000;
const DISPOSE_TIMEOUT_MS = 5_000;

interface ProcessRuntimeOptions {
  appId: string;
  moduleUrl: string;
  dataDir: string;
  toolNames: string[];
  ai: MiniAppAiFacade;
  badge: MiniAppBadgeFacade;
  logger: MiniAppLogger;
  callTimeoutMs?: number;
  onFault?: (error: Error) => void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  cleanupAbort?: () => void;
}

function workerPath(): string {
  const appRoot = process.env.MOLIBOT_APP_ROOT?.trim() || process.cwd();
  return path.join(appRoot, "scripts", "runtime", "untrusted-miniapp-worker.mjs");
}

function childError(payload: { name?: string; message?: string; stack?: string } | undefined): Error {
  const error = new Error(payload?.message || "Mini App worker failed.");
  error.name = payload?.name || "Error";
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function killProcessTree(child: ChildProcess): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

class MiniAppProcessRuntime implements MiniAppRuntime {
  readonly tools: MiniAppRuntime["tools"];
  private readonly pending = new Map<number, PendingCall>();
  private readonly hostCallControllers = new Map<number, AbortController>();
  private nextId = 1;
  private terminalError: Error | null = null;
  private disposed = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly options: ProcessRuntimeOptions
  ) {
    this.tools = Object.fromEntries(options.toolNames.map((toolName) => [
      toolName,
      (input: unknown, context: MiniAppToolCallContext) => this.call(
        "invokeTool",
        {
          toolName,
          input,
          toolCallId: context.toolCallId,
          // Host-internal fields (none today) never belong in the payload; the
          // staged file metadata is dataDir-relative and is the one context
          // extension the app is meant to see.
          ...(context.stagedFiles ? { stagedFiles: context.stagedFiles } : {})
        },
        options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
        context.signal
      ) as Promise<MiniAppToolResult>
    ]));
    child.on("message", (message) => this.onMessage(message));
    child.once("error", (error) => this.fail(new Error(`Mini App process error: ${error.message}`)));
    child.once("exit", (code, signal) => this.fail(new Error(
      `Mini App process exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`
    )));
  }

  async initialize(): Promise<this> {
    await this.call("init", {
      appId: this.options.appId,
      moduleUrl: this.options.moduleUrl,
      dataDir: this.options.dataDir,
      toolNames: this.options.toolNames
    }, LOAD_TIMEOUT_MS);
    return this;
  }

  handleHttp(request: MiniAppHttpRequest): Promise<MiniAppHttpResult> {
    const { signal, ...serializable } = request;
    return this.call(
      "handleHttp",
      serializable,
      this.options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      signal
    ) as Promise<MiniAppHttpResult>;
  }

  async dispose(): Promise<void> {
    if (this.terminalError) return;
    this.disposed = true;
    try {
      await this.call("dispose", null, DISPOSE_TIMEOUT_MS);
    } finally {
      try { if (this.child.connected) this.child.disconnect(); } catch { /* already disconnected */ }
      killProcessTree(this.child);
    }
  }

  private call(method: string, input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const failAndTerminate = (error: Error) => {
        killProcessTree(this.child);
        this.fail(error);
      };
      const timer = setTimeout(() => {
        failAndTerminate(new Error(`Mini App ${this.options.appId} ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const pending: PendingCall = { resolve, reject, timer };
      if (signal) {
        const onAbort = () => failAndTerminate(new Error(`Mini App ${this.options.appId} ${method} was aborted.`));
        if (signal.aborted) {
          clearTimeout(timer);
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        pending.cleanupAbort = () => signal.removeEventListener("abort", onAbort);
      }
      this.pending.set(id, pending);
      this.child.send({ kind: "request", id, method, input }, (error) => {
        if (error) failAndTerminate(new Error(`Mini App process IPC failed: ${error.message}`));
        this.child.channel?.unref();
      });
    });
  }

  private onMessage(raw: unknown): void {
    const message = raw as any;
    if (!message || typeof message !== "object") return;
    if (message.kind === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      if (message.ok) pending.resolve(message.value);
      else pending.reject(childError(message.error));
      this.child.channel?.unref();
      return;
    }
    if (message.kind === "badge") {
      this.options.badge.set(message.value ?? null);
      return;
    }
    if (message.kind === "log") {
      const level = message.level === "warn" || message.level === "error" ? message.level : "info";
      this.options.logger[level](String(message.event ?? "event"), message.detail);
      return;
    }
    if (message.kind === "host_cancel") {
      this.hostCallControllers.get(message.id)?.abort();
      return;
    }
    if (message.kind === "host_call") void this.handleHostCall(message);
  }

  private async handleHostCall(message: any): Promise<void> {
    const controller = new AbortController();
    this.hostCallControllers.set(message.id, controller);
    try {
      const input = {
        ...message.input,
        signal: controller.signal,
        ...(message.wantsTextDeltas
          ? { onTextDelta: (delta: string) => this.child.send({ kind: "host_delta", id: message.id, delta }) }
          : {})
      };
      const value = message.method === "ai.generateText"
        ? await this.options.ai.generateText(input)
        : message.method === "ai.chat"
          ? await this.options.ai.chat(input)
          : message.method === "ai.listTextModels"
            ? await this.options.ai.listTextModels()
            : message.method === "ai.transcribe"
              ? await this.options.ai.transcribe(input)
              : (() => { throw new Error(`Unknown Mini App host call: ${message.method}`); })();
      this.child.send({ kind: "host_result", id: message.id, ok: true, value });
    } catch (error) {
      this.child.send({
        kind: "host_result",
        id: message.id,
        ok: false,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          code: typeof (error as { code?: unknown } | null)?.code === "string"
            ? (error as { code: string }).code
            : undefined
        }
      });
    } finally {
      this.hostCallControllers.delete(message.id);
    }
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    if (!this.disposed) this.options.onFault?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanupAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
    for (const controller of this.hostCallControllers.values()) controller.abort();
    this.hostCallControllers.clear();
  }
}

export async function createMiniAppProcessRuntime(options: ProcessRuntimeOptions): Promise<MiniAppRuntime> {
  const child = fork(workerPath(), [], {
    detached: process.platform !== "win32",
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    execArgv: ["--max-old-space-size=256"]
  });
  // The service's HTTP/channel handles own process liveness. An idle App must
  // not prevent a deliberate shutdown; an active IPC request stays alive via
  // its (referenced) deadline timer above.
  child.stderr?.on("data", (chunk) => {
    options.logger.warn("worker_stderr", { message: chunk.toString().slice(0, 4_000) });
  });
  child.stderr?.unref();
  const runtime = new MiniAppProcessRuntime(child, options);
  child.unref();
  child.channel?.unref();
  try {
    return await runtime.initialize();
  } catch (error) {
    killProcessTree(child);
    throw error;
  }
}
