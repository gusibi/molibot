import { Socket } from "node:net";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { momWarn } from "$lib/server/agent/common/log.js";
import type {
  PiExtensionHostRequestHandler,
  PiExtensionProcessClient,
  PiExtensionProcessDescriptor
} from "$lib/server/plugins/piExtensions/types.js";

const LOAD_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;
/** One serialized stream event may not exceed this; a larger one fails the stream. */
const MAX_STREAM_EVENT_BYTES = 256 * 1024;

function errorPayload(error: unknown): { name: string; message: string; stack?: string } {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };
}

function scriptPath(): string {
  return path.join(process.env.MOLIBOT_APP_ROOT?.trim() || process.cwd(), "scripts", "runtime", "untrusted-pi-extension-worker.mjs");
}

function killTree(child: ChildProcess): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

class ProcessClient implements PiExtensionProcessClient {
  private readonly pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout; cleanup?: () => void }>();
  /** Per-invocation host sessions, keyed by the token the worker echoes back. */
  private readonly hostSessions = new Map<string, PiExtensionHostRequestHandler>();
  private nextId = 1;
  private terminalError: Error | null = null;
  private faultListener: ((error: Error) => void) | null = null;
  private disposed = false;

  constructor(private readonly child: ChildProcess) {
    child.on("message", (raw: any) => {
      if (raw?.kind === "hostRequest") {
        void this.handleHostRequest(raw);
        return;
      }
      if (raw?.kind !== "response") return;
      const pending = this.pending.get(raw.id);
      if (!pending) return;
      this.pending.delete(raw.id);
      clearTimeout(pending.timer);
      pending.cleanup?.();
      if (raw.ok) pending.resolve(raw.value);
      else {
        const error = new Error(raw.error?.message ?? "Pi extension process failed.");
        if (raw.error?.stack) error.stack = raw.error.stack;
        pending.reject(error);
      }
      this.child.channel?.unref();
    });
    child.once("error", (error) => this.fail(new Error(`Pi extension process error: ${error.message}`)));
    child.once("exit", (code, signal) => this.fail(new Error(
      `Pi extension process exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`
    )));
  }

  request(method: string, input: unknown, signal?: AbortSignal, timeoutMs = CALL_TIMEOUT_MS): Promise<any> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const terminate = (error: Error) => { killTree(this.child); this.fail(error); };
      const timer = setTimeout(() => terminate(new Error(`Pi extension ${method} timed out after ${timeoutMs}ms.`)), timeoutMs);
      const pending: { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout; cleanup?: () => void } = { resolve, reject, timer };
      if (signal) {
        const abort = () => terminate(new Error(`Pi extension ${method} was aborted.`));
        if (signal.aborted) { clearTimeout(timer); abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        pending.cleanup = () => signal.removeEventListener("abort", abort);
      }
      this.pending.set(id, pending);
      this.child.send({ kind: "request", id, method, input }, (error) => {
        if (error) terminate(new Error(`Pi extension IPC failed: ${error.message}`));
        this.child.channel?.unref();
      });
    });
  }

  registerHostSession(token: string, handler: PiExtensionHostRequestHandler): void {
    this.hostSessions.set(token, handler);
  }

  releaseHostSession(token: string): void {
    this.hostSessions.delete(token);
  }

  private async handleHostRequest(raw: { id: number; token?: string; method?: string; input?: unknown; stream?: boolean }): Promise<void> {
    const reply = (message: Record<string, unknown>): void => {
      try { this.child.send(message, () => undefined); } catch { /* channel already closed */ }
    };
    const handler = raw.token ? this.hostSessions.get(raw.token) : undefined;
    if (!handler) {
      reply({ kind: "hostResponse", id: raw.id, ok: false, error: { name: "Error", message: "The extension invocation that started this request has ended." } });
      return;
    }
    // Streaming responses push events; once the stream is closed (terminal sent or
    // an oversized event failed it) further emits are ignored.
    let closed = false;
    const emit = (event: unknown): void => {
      if (closed) return;
      let bytes: number;
      try { bytes = Buffer.byteLength(JSON.stringify(event) ?? ""); } catch { bytes = Infinity; }
      if (bytes > MAX_STREAM_EVENT_BYTES) {
        closed = true;
        reply({ kind: "hostResponse", id: raw.id, ok: false, error: { name: "Error", message: `Stream event exceeded ${MAX_STREAM_EVENT_BYTES} bytes.` } });
        return;
      }
      reply({ kind: "hostEvent", id: raw.id, event });
    };
    try {
      const value = await handler(String(raw.method ?? ""), raw.input, emit);
      if (!closed) reply({ kind: "hostResponse", id: raw.id, ok: true, value });
    } catch (error) {
      if (!closed) reply({ kind: "hostResponse", id: raw.id, ok: false, error: errorPayload(error) });
    }
  }

  setFlags(flags: Record<string, unknown>): void {
    void this.request("setFlags", { flags }).catch(() => undefined);
  }

  onFault(listener: (error: Error) => void): void {
    this.faultListener = listener;
    if (this.terminalError && !this.disposed) listener(this.terminalError);
  }

  dispose(): void {
    this.disposed = true;
    try { if (this.child.connected) this.child.disconnect(); } catch { /* already disconnected */ }
    killTree(this.child);
  }

  private fail(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    if (!this.disposed) this.faultListener?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function loadPiExtensionsInProcess(input: { cwd: string; agentDir: string }): Promise<{
  client: PiExtensionProcessClient;
  extensions: PiExtensionProcessDescriptor[];
  errors: Array<{ id: string; entryPath: string; error: string }>;
}> {
  const child = fork(scriptPath(), [], {
    detached: process.platform !== "win32",
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    execArgv: ["--max-old-space-size=256"]
  });
  const client = new ProcessClient(child);
  child.stderr?.on("data", (chunk) => {
    momWarn("plugins", "pi_extension_worker_stderr", { message: chunk.toString().slice(0, 4_000) });
  });
  if (child.stderr instanceof Socket) child.stderr.unref();
  child.unref();
  child.channel?.unref();
  try {
    const loaded = await client.request("load", input, undefined, LOAD_TIMEOUT_MS);
    return { client, extensions: loaded.extensions, errors: loaded.errors };
  } catch (error) {
    client.dispose();
    throw error;
  }
}
