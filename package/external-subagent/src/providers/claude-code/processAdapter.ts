import { EventEmitter } from "node:events";
import type { Writable, Readable } from "node:stream";
import type { ManagedProcessHandle, ProcessOutcome } from "../../managedProcess.js";

/**
 * Custom SpawnedProcess adapter satisfying the @anthropic-ai/claude-agent-sdk interface.
 */
export class ManagedClaudeCodeProcess {
  readonly stdin?: Writable;
  readonly stdout?: Readable;
  private readonly events = new EventEmitter();
  private outcomeValue?: ProcessOutcome;
  private killRequested = false;

  constructor(private readonly child: ManagedProcessHandle) {
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.events.on("error", () => {});

    void child.done.then(
      (outcome) => {
        this.outcomeValue = outcome;
        this.events.emit("exit", outcome.exitCode, outcome.signal);
      },
      (error: unknown) => {
        this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    );
  }

  get killed(): boolean {
    return this.killRequested;
  }

  get exitCode(): number | null {
    return this.outcomeValue?.exitCode ?? null;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.outcomeValue?.signal ?? null;
  }

  get outcome(): ProcessOutcome | undefined {
    return this.outcomeValue;
  }

  kill(_signal?: NodeJS.Signals): boolean {
    if (this.killRequested || this.outcomeValue !== undefined) {
      return false;
    }
    this.killRequested = true;
    this.child.terminate();
    return true;
  }

  on(event: "exit" | "error", listener: (...args: any[]) => void): this {
    this.events.on(event, listener);
    return this;
  }

  once(event: "exit" | "error", listener: (...args: any[]) => void): this {
    this.events.once(event, listener);
    return this;
  }

  off(event: "exit" | "error", listener: (...args: any[]) => void): this {
    this.events.off(event, listener);
    return this;
  }
}
