import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export type JsonRpcId = string | number;
export type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;
export type NotificationHandler = (method: string, params: Record<string, unknown>) => void;

export class JsonRpcResponseError extends Error {
  constructor(
    readonly code: number | undefined,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "JsonRpcResponseError";
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function objectParams(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function normalizeAbortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error(`JSON-RPC request aborted: ${String(reason)}`);
}

export class JsonRpcLineTransport {
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private started = false;
  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.on("data", this.onData);
    this.input.on("error", this.onInputError);
    this.input.on("end", this.onInputEnd);
  }

  close(): void {
    this.input.off("data", this.onData);
    this.input.off("error", this.onInputError);
    this.input.off("end", this.onInputEnd);
    this.failPending(new Error("JSON-RPC transport closed"));
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  request(method: string, params: object, signal?: AbortSignal): Promise<unknown> {
    const id = `req_${randomUUID().replaceAll("-", "")}`;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      let detach = (): void => {};
      if (signal !== undefined) {
        if (signal.aborted) {
          reject(normalizeAbortError(signal.reason));
          return;
        }
        const onAbort = (): void => {
          this.pending.delete(id);
          reject(normalizeAbortError(signal.reason));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        detach = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }

      this.pending.set(id, {
        resolve: (value) => {
          detach();
          resolve(value);
        },
        reject: (error) => {
          detach();
          reject(error);
        }
      });

      try {
        this.write(message);
      } catch (error) {
        this.pending.delete(id);
        detach();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: object): void {
    this.write(
      params === undefined
        ? { jsonrpc: "2.0", method }
        : { jsonrpc: "2.0", method, params }
    );
  }

  flush(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.output.write("", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.drainLines();
  };

  private drainLines(): void {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      void this.handleLine(line);
    }
  }

  private readonly onInputError = (error: Error): void => {
    this.failPending(error);
  };

  private readonly onInputEnd = (): void => {
    this.buffer += this.decoder.end();
    this.drainLines();
    this.failPending(new Error("JSON-RPC input closed"));
  };

  private async handleLine(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const frame = message as Record<string, unknown>;
    const id = frame.id;
    const method = frame.method;

    if ((typeof id === "string" || typeof id === "number") && typeof method === "string") {
      await this.handleIncomingRequest(id, method, objectParams(frame.params));
      return;
    }
    if (typeof id === "string" || typeof id === "number") {
      this.handleIncomingResponse(id, frame);
      return;
    }
    if (typeof method === "string") {
      this.notificationHandler?.(method, objectParams(frame.params));
    }
  }

  private async handleIncomingRequest(
    id: JsonRpcId,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const handler = this.requestHandler;
    if (!handler) {
      this.writeError(id, -32601, `method not found: ${method}`);
      return;
    }
    try {
      const result = await handler(method, params);
      this.write({ jsonrpc: "2.0", id, result });
    } catch (error) {
      this.writeError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  private handleIncomingResponse(id: JsonRpcId, frame: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);

    if (frame.error && typeof frame.error === "object") {
      const error = frame.error as Record<string, unknown>;
      pending.reject(
        new JsonRpcResponseError(
          typeof error.code === "number" ? error.code : undefined,
          typeof error.message === "string" ? error.message : "JSON-RPC error",
          error.data
        )
      );
      return;
    }
    pending.resolve(frame.result);
  }

  private writeError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private write(message: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private failPending(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of pending) {
      waiter.reject(error);
    }
  }
}
