import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  JsonRpcErrorPayload,
  JsonRpcFailure,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess
} from "./types.js";

interface JsonRpcHandlers {
  onRequest: (request: JsonRpcRequest) => Promise<unknown>;
  onNotification?: (notification: JsonRpcNotification) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error ?? "Unknown ACP error"));
}

function toJsonRpcError(error: unknown, fallbackCode = -32000): JsonRpcErrorPayload {
  if (error && typeof error === "object") {
    const payload = error as { code?: unknown; message?: unknown; data?: unknown };
    return {
      code: typeof payload.code === "number" ? payload.code : fallbackCode,
      message: typeof payload.message === "string" ? payload.message : normalizeError(error).message,
      data: payload.data
    };
  }
  return {
    code: fallbackCode,
    message: normalizeError(error).message
  };
}

export class JsonRpcStdioConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string | number, PendingRequest>();
  private readonly handlers: JsonRpcHandlers;
  private nextId = 1;
  private buffer = "";
  private closed = false;

  constructor(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> },
    handlers: JsonRpcHandlers
  ) {
    this.handlers = handlers;
    this.child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      this.parseBuffer();
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.handlers.onStderr?.(chunk.toString("utf8"));
    });

    this.child.on("error", (error) => {
      this.failAllPending(error);
    });

    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.failAllPending(new Error(`ACP process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
      this.handlers.onExit?.(code, signal);
    });
  }

  async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject });
    });
    this.write(payload);
    return promise;
  }

  sendNotification(method: string, params?: unknown): void {
    const payload: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params
    };
    this.write(payload);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill();
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed) {
      throw new Error("ACP connection is closed");
    }
    const body = JSON.stringify(message);
    this.child.stdin.write(`${body}\n`, "utf8");
  }

  private parseBuffer(): void {
    while (true) {
      if (this.buffer.startsWith("Content-Length:")) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }

        const length = Number.parseInt(match[1], 10);
        const totalLength = headerEnd + 4 + length;
        if (this.buffer.length < totalLength) return;

        const body = this.buffer.slice(headerEnd + 4, totalLength);
        this.buffer = this.buffer.slice(totalLength);

        try {
          const parsed = JSON.parse(body) as JsonRpcMessage;
          void this.handleMessage(parsed);
        } catch {
          // Ignore malformed frames from crashed adapters.
        }
        continue;
      }

      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd === -1) return;

      const line = this.buffer.slice(0, lineEnd).trim();
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as JsonRpcMessage;
        void this.handleMessage(parsed);
      } catch {
        // Ignore malformed lines from crashed adapters.
      }
    }
  }

  private async handleMessage(message: JsonRpcMessage): Promise<void> {
    if ("method" in message) {
      if ("id" in message) {
        try {
          const result = await this.handlers.onRequest(message);
          const response: JsonRpcSuccess = {
            jsonrpc: "2.0",
            id: message.id,
            result: result ?? null
          };
          this.write(response);
        } catch (error) {
          const response: JsonRpcFailure = {
            jsonrpc: "2.0",
            id: message.id,
            error: toJsonRpcError(error)
          };
          this.write(response);
        }
        return;
      }
      this.handlers.onNotification?.(message);
      return;
    }

    if (message.id == null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if ("error" in message) {
      pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      return;
    }
    pending.resolve(message.result);
  }

  private failAllPending(error: unknown): void {
    const normalized = normalizeError(error);
    for (const pending of this.pending.values()) {
      pending.reject(normalized);
    }
    this.pending.clear();
  }
}
