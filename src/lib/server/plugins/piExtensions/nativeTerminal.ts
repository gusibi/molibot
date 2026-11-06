import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, renameSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { PiExtensionDialog, PiExtensionTerminalOutput, PiExtensionTerminalSummary } from "$lib/shared/piExtensionTerminal.js";
import { extensionInstallDir } from "./paths.js";
import { createPiExtensionProcessClient } from "./processClient.js";
import { bindPiExtensionHostSession, type PiExtensionToolOptions } from "./toolBridge.js";
import type { LoadedPiExtension, PiExtensionProcessClient } from "./types.js";
import type { AgentToolCallOutcome } from "@earendil-works/pi-agent-core";

const OUTPUT_LIMIT = 512 * 1024;
const SESSION_LIMIT = 32;
const RETENTION_MS = 60 * 60 * 1000;
type NativeRunResult = { text: string; terminalId: string; images?: Array<{ type: "image"; mimeType: string; data: string }>; sharingStatus?: PiExtensionTerminalSummary["sharingStatus"]; suspension?: AgentToolCallOutcome["result"] };

interface TerminalEntry {
  summary: PiExtensionTerminalSummary;
  agentDir: string;
  client?: PiExtensionProcessClient;
  controller: AbortController;
  chunks: Array<{ start: number; end: number; data: string }>;
  cursor: number;
  bytes: number;
  interactions?: Map<number, number>;
  cleanupRetry?: Promise<void>;
  dialogReply?: (value: string | boolean | null) => void;
}

interface NativeRunInput {
  sessionId: string; agentId?: string; runId: string; callId: string; prompt: string; extensions: LoadedPiExtension[];
  options: PiExtensionToolOptions; flags?: Record<string, boolean | string>; signal?: AbortSignal;
  onStarted?: (terminal: PiExtensionTerminalSummary) => void;
}

/** Each terminal belongs to one parent run; it cannot launch unowned model work. */
export class PiExtensionTerminalHost {
  private lastClientAt = -Infinity;
  private lastDiscoveryAt = -Infinity;
  private readonly ownedSessions = new Set<string>();

  constructor(private readonly timing = { now: () => Date.now(), clientLeaseMs: 5_000, interactionTimeoutMs: 5 * 60_000 }) {}

  /** A connected terminal viewer renews this lease; it does not imply a human response. */
  heartbeat(): void { this.lastClientAt = this.timing.now(); }

  /** Refuse active writers; the trash cleanup intent retries after they stop. */
  purgeSession(sessionId: string): void {
    if (this.ownedSessions.has(sessionId) || [...this.entries.values()].some(entry => entry.summary.sessionId === sessionId && (entry.summary.status === "running" || entry.summary.sharingRetryable))) {
      throw new Error("Stop the active native Pi task before permanently deleting this conversation.");
    }
    rmSync(this.sessionDir(sessionId), { recursive: true, force: true });
    for (const [id, entry] of this.entries) if (entry.summary.sessionId === sessionId) this.entries.delete(id);
    this.lastDiscoveryAt = -Infinity;
  }

  private sessionDir(sessionId: string): string {
    return join(storagePaths.dataDir, "pi-native", createHash("sha256").update(sessionId).digest("hex"));
  }

  private interactionError(startedAt: number): Error | undefined {
    if (this.timing.now() - this.lastClientAt > this.timing.clientLeaseMs) return new Error("Native Pi interaction requires a connected Desktop terminal. Open Desktop or select server mode in extension settings.");
    if (this.timing.now() - startedAt >= this.timing.interactionTimeoutMs) return new Error("Native Pi interaction timed out waiting for a human response. Check the task's effects before starting again.");
  }

  private readonly entries = new Map<string, TerminalEntry>();
  private readonly listeners = new Set<(id: string) => void>();

  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  list(): PiExtensionTerminalSummary[] {
    this.discoverInterrupted();
    this.prune();
    return [...this.entries.values()].map(({ summary }) => structuredClone(summary));
  }

  output(id: string, after = 0): PiExtensionTerminalOutput {
    const entry = this.get(id);
    const first = entry.chunks[0]?.start ?? entry.cursor;
    return {
      terminal: structuredClone(entry.summary), cursor: entry.cursor, reset: after < first,
      output: entry.chunks.filter((chunk) => chunk.end > after).map((chunk) => chunk.data.slice(Math.max(0, after - chunk.start))).join("")
    };
  }

  async input(id: string, data: string): Promise<void> {
    const entry = this.getRunning(id);
    if (Buffer.byteLength(data) > 16 * 1024) throw new Error("Terminal input exceeds 16 KiB.");
    await entry.client!.request("terminalInput", { data }, entry.controller.signal, 5_000);
  }

  async resize(id: string, columns: number, rows: number): Promise<void> {
    if (!Number.isInteger(columns) || columns < 20 || columns > 400 || !Number.isInteger(rows) || rows < 5 || rows > 200) {
      throw new Error("Terminal dimensions must be 20–400 columns and 5–200 rows.");
    }
    const entry = this.getRunning(id);
    await entry.client!.request("terminalResize", { columns, rows }, entry.controller.signal, 5_000);
  }

  /** Start a fresh context only after the owner has inspected interrupted effects. */
  review(id: string): void {
    const entry = this.get(id);
    if (this.ownedSessions.has(entry.summary.sessionId) || [...this.entries.values()].some((candidate) => candidate.summary.sessionId === entry.summary.sessionId && candidate.summary.status === "running")) throw new Error("Stop the active native task before reviewing its context.");
    if (entry.summary.sharingRetryable) throw new Error("Retry stopping the task sharing before allowing a fresh native context.");
    const state = join(entry.agentDir, "state.json");
    if (!existsSync(state) || !this.needsReview(JSON.parse(readFileSync(state, "utf8")))) throw new Error("This context has no incomplete task to review.");
    if (existsSync(state)) renameSync(state, join(entry.agentDir, `state.reviewed-${randomUUID()}.json`));
    for (const candidate of this.entries.values()) if (candidate.agentDir === entry.agentDir) { candidate.summary.contextReviewed = true; candidate.summary.requiresReview = false; }
  }

  stop(id: string): void { this.getRunning(id).controller.abort(new Error("Stopped from the native Pi terminal.")); }

  /** A reply resolves only the currently displayed request, once. */
  respond(id: string, dialogId: string, value: unknown): void {
    const entry = this.getRunning(id);
    const dialog = entry.summary.dialog;
    if (entry.controller.signal.aborted || !dialog || dialog.id !== dialogId || !entry.dialogReply) throw new Error("This Pi dialog is no longer pending or has expired.");
    if (value !== null) {
      if (dialog.kind === "select" && (typeof value !== "string" || !dialog.options?.includes(value))) throw new Error("Invalid Pi dialog option.");
      if (dialog.kind === "confirm" && typeof value !== "boolean") throw new Error("A Pi confirmation requires a boolean reply.");
      if (["input", "editor"].includes(dialog.kind) && (typeof value !== "string" || Buffer.byteLength(value) > 64 * 1024)) throw new Error("Invalid Pi text reply.");
    }
    entry.dialogReply(value as string | boolean | null);
  }

  private async dialog(entry: TerminalEntry, input: any, signal?: AbortSignal): Promise<string | boolean | null> {
    if (entry.summary.dialog) throw new Error("This terminal already has a pending Pi dialog.");
    if (!["select", "confirm", "input", "editor"].includes(input?.kind) || typeof input.title !== "string" || input.title.length > 4_000) throw new Error("Invalid Pi dialog.");
    if (input.kind === "select" && (!Array.isArray(input.options) || input.options.length > 256 || input.options.some((value: unknown) => typeof value !== "string" || value.length > 2_000))) throw new Error("Invalid Pi dialog options.");
    for (const field of ["message", "placeholder", "initialValue"]) if (input[field] !== undefined && (typeof input[field] !== "string" || input[field].length > 64 * 1024)) throw new Error("Invalid Pi dialog text.");
    signal?.throwIfAborted();
    const dialog: PiExtensionDialog = { id: randomUUID(), kind: input.kind, title: input.title, options: input.options, message: input.message, placeholder: input.placeholder, initialValue: input.initialValue };
    let cleanup: (() => void) | undefined;
    try {
      return await new Promise((resolve, reject) => {
        const onAbort = () => { entry.dialogReply = undefined; entry.summary.dialog = undefined; reject(signal?.reason ?? new Error("Pi dialog cancelled.")); };
        cleanup = () => signal?.removeEventListener("abort", onAbort);
        entry.dialogReply = value => {
          entry.dialogReply = undefined;
          entry.summary.dialog = undefined;
          cleanup?.();
          resolve(value);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        entry.summary.dialog = dialog;
        for (const listener of this.listeners) listener(entry.summary.id);
      });
    } finally {
      cleanup?.();
      entry.dialogReply = undefined;
      entry.summary.dialog = undefined;
    }
  }

  async retrySharing(id: string): Promise<void> {
    const entry=this.get(id);
    if(entry.summary.status === "running") throw new Error("Wait for the native task to finish before retrying sharing cleanup.");
    if(entry.cleanupRetry)return entry.cleanupRetry;
    if(!entry.client || !entry.summary.sharingRetryable) throw new Error("The cleanup connection is unavailable. Check and stop sharing in the system UI.");
    const client=entry.client;
    const operation=(async()=>{
      entry.summary.sharingStatus="stopping";
      try {
        const outcome=await client.request("retrySharingCleanup",{statePath:join(entry.agentDir,"state.json")},undefined,10_000);
        if(outcome?.status !== "released" || outcome.retryable) throw new Error("LCU sharing release is still unconfirmed.");
        entry.summary.sharingStatus="released";entry.summary.sharingRetryable=false;
        entry.summary.cleanupStatus="hooks_completed";
        client.dispose();entry.client=undefined;
      } catch(error) {
        entry.summary.error=error instanceof Error?error.message:String(error);
        entry.summary.sharingStatus="unknown";
        throw error;
      }
    })().finally(()=>{entry.cleanupRetry=undefined;});
    entry.cleanupRetry=operation;return operation;
  }

  async run(input: NativeRunInput): Promise<NativeRunResult> {
    if (this.ownedSessions.has(input.sessionId)) throw new Error("This conversation already owns an active native Pi terminal.");
    this.ownedSessions.add(input.sessionId);
    try { return await this.runOwned(input); }
    finally { this.ownedSessions.delete(input.sessionId); }
  }

  private async runOwned(input: NativeRunInput): Promise<NativeRunResult> {
    this.prune(true);
    if ([...this.entries.values()].some((entry) => entry.summary.sessionId === input.sessionId && (entry.summary.status === "running" || entry.summary.sharingRetryable))) {
      throw new Error("This conversation already owns an active native Pi terminal.");
    }
    if (this.entries.size >= SESSION_LIMIT) throw new Error("Native Pi terminal limit reached. Wait for an active task to finish.");
    if (!input.options.streamModel || !input.options.executeTool) throw new Error("Native Pi requires the current run's model and tool authority.");
    input.signal?.throwIfAborted();
    const snapshot = await input.options.runtime?.();
    if (!snapshot?.model) throw new Error("The current run has no native Pi model snapshot.");
    input.signal?.throwIfAborted();
    if ([...this.entries.values()].some((entry) => entry.summary.sessionId === input.sessionId && (entry.summary.status === "running" || entry.summary.sharingRetryable))) throw new Error("This conversation already owns an active native Pi terminal.");
    if (this.entries.size >= SESSION_LIMIT) throw new Error("Native Pi terminal limit reached.");
    const id = randomUUID();
    const agentDir = this.sessionDir(input.sessionId);
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    const env: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", TERM: "xterm-256color", COLORTERM: "truecolor" };
    for (const key of ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SystemRoot", "WINDIR", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "TZ"]) if (process.env[key]) env[key] = process.env[key];
    const client = createPiExtensionProcessClient({ native: true, env, onNativeLifecycle: stage => {
      entry.summary.cleanupStatus = stage === "cleanup_started" ? "running" : stage === "cleanup_completed" ? "hooks_completed" : "unknown";
      for (const listener of this.listeners) listener(entry.summary.id);
    }, onNativeSharing: state => {
      entry.summary.sharingStatus=state.status;entry.summary.sharingRetryable=state.retryable;
      for (const listener of this.listeners) listener(entry.summary.id);
    } });
    const controller = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    const entry: TerminalEntry = { agentDir, client, controller,
      summary: { id, sessionId: input.sessionId, agentId: input.agentId, runId: input.runId, extensionIds: input.extensions.map((extension) => extension.id), status: "running", createdAt: Date.now(), cleanupStatus: "pending", sharingStatus: "unverified" },
      chunks: [], bytes: 0, cursor: 0 };
    this.entries.set(id, entry);
    client.onFault(() => {
      entry.client=undefined;entry.summary.sharingRetryable=false;
      if(entry.summary.sharingStatus === "stopping")entry.summary.sharingStatus="unknown";
    });
    const interactionMonitor = setInterval(() => {
      for (const startedAt of entry.interactions?.values() ?? []) {
        const error = this.interactionError(startedAt);
        if (error) { controller.abort(error); break; }
      }
    }, 1_000);
    interactionMonitor.unref();
    let suspension: AgentToolCallOutcome["result"] | undefined;
    const ownedOptions = { ...input.options, executeTool: async (...args: Parameters<NonNullable<PiExtensionToolOptions["executeTool"]>>) => {
      const outcome = await input.options.executeTool!(...args);
      if ((outcome.result as { terminate?: boolean }).terminate) {
        suspension = outcome.result;
        controller.abort(new Error("Native Pi stopped at a suspended host approval."));
      }
      return outcome;
    } };
    const permits = new Map<string, { provider: string; id: string; api: string; kind: string }>();
    let token: string | undefined;
    try {
      token = bindPiExtensionHostSession(client, ownedOptions, signal, input.callId, async (method, value, emit, callSignal) => {
        if (method === "terminal.dialog") return this.dialog(entry, value, callSignal);
        if (method === "terminal.interactionStart") {
          const startedAt = this.timing.now();
          const error = this.interactionError(startedAt);
          if (error) { controller.abort(error); throw error; }
          (entry.interactions ??= new Map()).set(value.id, startedAt);
          if (value.kind === "custom") entry.summary.customInteraction = true;
          return null;
        }
        if (method === "terminal.interactionEnd") { entry.interactions?.delete(value.id); if (!entry.interactions?.size) entry.summary.customInteraction = false; return null; }
        if (method === "nativeModel.hostStream") {
          const callback = (name: string, data: unknown, model?: unknown) => client.request("nativeModelCallback", { callbackId: value.callbackId, method: name, value: data, model }, signal);
          try {
            return await input.options.streamModel!({ ...value, callId: `${input.callId}:native:host:${value.callbackId}`,
              onPayload: (payload, model) => callback("onPayload", payload, model),
              onResponse: async (response) => { await callback("onResponse", response); },
              onProviderStreamEvent: async (event) => { await callback("onProviderStreamEvent", event); }
            }, emit, signal);
          } catch (error) {
            const waiting = (error as { suspendedResult?: AgentToolCallOutcome["result"] })?.suspendedResult;
            if (waiting) { suspension = waiting; controller.abort(new Error("Native Pi stopped at a suspended model approval.")); }
            throw error;
          }
        }
        if (method === "nativeModel.before") {
          if (!input.options.nativeModels || !value || typeof value.provider !== "string" || typeof value.id !== "string" || typeof value.api !== "string" || !["chat", "classify", "image"].includes(value.kind)) throw new Error("Native provider model work is unavailable in this host run.");
          const permit = randomUUID();
          const metadata = { provider: value.provider, id: value.id, api: value.api, kind: value.kind };
          await input.options.nativeModels.beforeCall(metadata, `${input.callId}:native:${permit}`, signal);
          permits.set(permit, metadata);
          return { permit };
        }
        if (method === "nativeModel.usage") {
          const metadata = permits.get(value?.permit);
          if (!metadata) throw new Error("Native model receipt has no active admission.");
          permits.delete(value.permit);
          input.options.nativeModels?.recordUsage(metadata, value.usage, `${input.callId}:native:${value.permit}`);
          return null;
        }
        if (method !== "terminal.write" || typeof value?.data !== "string") throw new Error("Unsupported native Pi terminal operation.");
        this.append(entry, value.data);
        return null;
      });
      const extensionTools = new Set(input.extensions.flatMap((extension) => extension.toolNames));
      const tools = (input.options.toolCatalog?.() ?? []).filter((tool) => tool.name !== "piExtensionRun" && !extensionTools.has(tool.name));
      writeFileSync(join(agentDir, "owner.json"), JSON.stringify(entry.summary), { mode: 0o600 });
      input.onStarted?.(structuredClone(entry.summary));
      const result = await client.request("nativeRun", {
        hostToken: token, snapshot, agentDir, prompt: input.prompt, tools,
        flags: input.flags,
        extensionPaths: [...new Set(input.extensions.map((extension) => {
          const root = extensionInstallDir(extension.id);
          const path = root ? relative(root, extension.entryPath) : "..";
          return root && path !== ".." && !path.startsWith("../") && !isAbsolute(path) ? root : extension.entryPath;
        }))]
      }, signal, 60 * 60 * 1000);
      signal.throwIfAborted();
      entry.summary.status = "completed";
      return { text: result.text, images: result.images, sharingStatus: result.sharingStatus, terminalId: id };
    } catch (error) {
      if (suspension) {
        entry.summary.status = "waiting_approval";
        return { text: "Native Pi reached a suspended host approval. Earlier effects remain recorded; the native JavaScript continuation is not replayed.", terminalId: id, suspension };
      }
      entry.summary.status = signal.aborted ? "stopped" : "failed";
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      entry.summary.error = reason instanceof Error ? reason.message : String(reason);
      throw reason;
    } finally {
      clearInterval(interactionMonitor);
      if (entry.summary.cleanupStatus !== "hooks_completed") entry.summary.cleanupStatus = "unknown";
      try { entry.summary.requiresReview = this.needsReview(JSON.parse(readFileSync(join(agentDir, "state.json"), "utf8"))); } catch { /* No native execution started. */ }
      if (token) client.releaseHostSession(token);
      if (!entry.summary.sharingRetryable) {client.dispose();entry.client=undefined;}
    }
  }

  private needsReview(state: { status?: string; requiresReview?: boolean }): boolean {
    return state.status === "running" || state.requiresReview === true;
  }

  private discoverInterrupted(): void {
    if (this.timing.now() - this.lastDiscoveryAt < 2_000) return;
    this.lastDiscoveryAt = this.timing.now();
    const root = join(storagePaths.dataDir, "pi-native");
    if (!existsSync(root)) return;
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (this.entries.size >= SESSION_LIMIT) break;
      if (!dir.isDirectory() || !/^[a-f0-9]{64}$/.test(dir.name)) continue;
      const agentDir = join(root, dir.name);
      if ([...this.entries.values()].some((entry) => entry.agentDir === agentDir)) continue;
      try {
        const state = JSON.parse(readFileSync(join(agentDir, "state.json"), "utf8"));
        if (!this.needsReview(state)) continue;
        const owner = JSON.parse(readFileSync(join(agentDir, "owner.json"), "utf8"));
        if (typeof owner.id !== "string" || typeof owner.sessionId !== "string" || !Array.isArray(owner.extensionIds)) continue;
        this.entries.set(owner.id, { agentDir, controller: new AbortController(), chunks: [], cursor: 0, bytes: 0,
          summary: { ...owner, cleanupStatus: state.cleanupStatus === "hooks_completed" ? "hooks_completed" : "unknown", sharingStatus: state.sharingStatus === "released" ? "released" : state.sharingStatus === "unknown" || state.sharingRetryable ? "unknown" : "unverified", sharingRetryable:false, createdAt: Date.now(), status: "failed", requiresReview: true, error: state.status === "failed" ? "The native Pi task failed. Check its effects before allowing a fresh context." : "The service stopped before this native Pi task completed. Check its effects before allowing a fresh context." } });
      } catch { /* An incomplete state cannot be resumed or replayed. */ }
    }
  }

  private append(entry: TerminalEntry, data: string): void {
    // Bound foreign output without growing request history.
    if (Buffer.byteLength(data) > OUTPUT_LIMIT) data = [...data].slice(-OUTPUT_LIMIT / 4).join("");
    const bytes = Buffer.byteLength(data);
    entry.chunks.push({ start: entry.cursor, end: entry.cursor + data.length, data });
    entry.cursor += data.length;
    entry.bytes += bytes;
    while (entry.bytes > OUTPUT_LIMIT && entry.chunks.length > 1) entry.bytes -= Buffer.byteLength(entry.chunks.shift()!.data);
    for (const listener of this.listeners) listener(entry.summary.id);
  }
  private get(id: string): TerminalEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Native Pi terminal was not found.");
    return entry;
  }
  private getRunning(id: string): TerminalEntry {
    const entry = this.get(id);
    if (entry.summary.status !== "running") throw new Error("Native Pi terminal has ended.");
    return entry;
  }
  private prune(reserveSlot = false): void {
    for (const [id, entry] of this.entries) if (entry.summary.status !== "running" && !entry.summary.sharingRetryable && Date.now() - entry.summary.createdAt > RETENTION_MS) this.entries.delete(id);
    if (reserveSlot && this.entries.size >= SESSION_LIMIT) {
      const oldest = [...this.entries].find(([, entry]) => entry.summary.status !== "running" && !entry.summary.sharingRetryable);
      if (oldest) this.entries.delete(oldest[0]);
    }
  }
}

export const piExtensionTerminalHost = new PiExtensionTerminalHost();
