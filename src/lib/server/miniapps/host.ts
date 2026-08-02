import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readMiniAppManifest, type ValidatedMiniAppManifest } from "$lib/server/miniapps/manifest.js";
import {
  appDataDirPath,
  isValidMiniAppId,
  normalizeUiAssetPath,
  resolveAppCodeDir,
  resolveContainedPath
} from "$lib/server/miniapps/paths.js";
import {
  MiniAppError,
  miniAppToolId,
  parseMiniAppToolId,
  type MiniAppCatalogEntry,
  type MiniAppHttpMethod,
  type MiniAppHttpRequest,
  type MiniAppHttpResult,
  type MiniAppInstallSource,
  type MiniAppLogger,
  type MiniAppRuntime,
  type MiniAppServerModule,
  type MiniAppStatus,
  type MiniAppToolCallContext,
  type MiniAppToolDescriptor,
  type MiniAppToolResult
} from "$lib/server/miniapps/types.js";

/**
 * MiniAppHost — the single seam between installed Mini Apps and the rest of
 * Molibot.
 *
 * Callers (the agent tool adapter, the SvelteKit routes, Settings) know only
 * about the catalog, tool descriptors, tool invocation, HTTP requests and
 * lifecycle. Directory scanning, manifest validation, path containment, ESM
 * loading, the one-runtime-per-app singleton, revision tracking, in-flight
 * accounting and uninstall ordering all stay inside.
 *
 * Two invariants this module exists to hold:
 *
 * 1. **One runtime instance per app.** Tool handlers and HTTP handlers must
 *    share a SQLite connection and a revision counter, or the agent and the UI
 *    drift apart. Concurrent first calls therefore share one loading promise.
 * 2. **`disabled` is enforced at call time, not at list time.** Filtering the
 *    tool list is a UX affordance; the enablement check inside `invokeTool` and
 *    the HTTP entry points is the control.
 */

const UNINSTALL_DRAIN_TIMEOUT_MS = 5_000;
const HOST_STATE_FILENAME = "_host.json";
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const UI_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

export interface MiniAppEnablementEntry {
  enabled: boolean;
  /** Tombstone: owner uninstalled a built-in app; do not re-bootstrap it. */
  removedBuiltin?: boolean;
}

export interface MiniAppHostOptions {
  codeRoot: string;
  dataRoot: string;
  /** Reads the persisted enablement map. Called on every entry point. */
  getEnablement: () => Record<string, MiniAppEnablementEntry>;
  /** Persists a single-key change. Must round-trip through the settings store. */
  setEnablement: (appId: string, entry: MiniAppEnablementEntry | null) => void;
  logger?: MiniAppLogger;
  /** Ids the host ships and bootstraps; only affects catalog labelling + uninstall. */
  builtinAppIds?: string[];
  /** Where each app came from, for display. Absent = unknown local directory. */
  getInstallSources?: () => Record<string, MiniAppInstallSource>;
  /** Test seam for ESM loading. Production uses a plain dynamic import. */
  importModule?: (entryPath: string) => Promise<unknown>;
}

interface AppSlot {
  id: string;
  codeDir: string;
  /** Inlined icon, computed once per discovered build. */
  iconDataUri: string;
  descriptor: ValidatedMiniAppManifest | null;
  loadError: string | null;
  runtime: MiniAppRuntime | null;
  loading: Promise<MiniAppRuntime> | null;
  runtimeError: string | null;
  revision: number;
  inFlight: number;
  uninstalling: boolean;
}

const noopLogger: MiniAppLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Reads a validated icon into a `data:` URI.
 *
 * Inlining keeps the desktop contract path-free and avoids widening the app
 * CSP's `img-src` to the custom scheme just so a 20x20 sidebar glyph can load.
 * The manifest validator already bounded the size and the extension.
 */
function readIconDataUri(iconPath: string | null): string {
  if (!iconPath) return "";
  try {
    const bytes = fs.readFileSync(iconPath);
    const mime = iconPath.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * Strips anything that could leak host layout out of a message that reaches a
 * WebView or a tool result: absolute paths and stack frames.
 */
function sanitizeOutwardMessage(message: string): string {
  return message
    .split("\n")[0]
    .replace(/(?:file:\/\/)?\/(?:[\w.@+-]+\/)+[\w.@+-]*/g, "<path>")
    .slice(0, 300);
}

export class MiniAppHost {
  private readonly options: MiniAppHostOptions;
  private readonly logger: MiniAppLogger;
  private readonly builtinAppIds: Set<string>;
  private slots = new Map<string, AppSlot>();

  constructor(options: MiniAppHostOptions) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
    this.builtinAppIds = new Set(options.builtinAppIds ?? []);
    this.refresh();
  }

  // ---------------------------------------------------------------- discovery

  /**
   * Rescans the code root. Existing runtimes for apps whose manifest is
   * unchanged are kept, so a catalog read never drops a live SQLite connection.
   */
  refresh(): void {
    const found = new Map<string, AppSlot>();
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.options.codeRoot);
    } catch (cause) {
      // A missing root is the normal empty state, not an error.
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") {
        this.logger.warn("miniapp_scan_failed", { error: errorMessage(cause) });
      }
      this.slots = found;
      return;
    }

    for (const name of names.sort()) {
      if (name.startsWith(".")) continue;
      const codeDir = resolveAppCodeDir(this.options.codeRoot, name);
      if (!codeDir) {
        if (!isValidMiniAppId(name)) {
          found.set(name, this.errorSlot(name, path.join(this.options.codeRoot, name),
            "App directory name must match ^[a-z][a-z0-9-]{1,62}$."));
        } else {
          found.set(name, this.errorSlot(name, path.join(this.options.codeRoot, name),
            "App directory is not a real directory inside the Mini App code root."));
        }
        continue;
      }

      const result = readMiniAppManifest(codeDir, name);
      const existing = this.slots.get(name);
      if (!result.ok) {
        this.logger.warn("miniapp_manifest_invalid", { appId: name, error: result.error });
        found.set(name, this.errorSlot(name, codeDir, result.error));
        continue;
      }

      // Keep a live runtime only when the app is byte-for-byte the same build.
      const unchanged = existing?.descriptor
        && existing.codeDir === codeDir
        && existing.descriptor.manifest.version === result.value.manifest.version
        && existing.descriptor.entryPath === result.value.entryPath;

      found.set(name, {
        id: name,
        codeDir,
        iconDataUri: readIconDataUri(result.value.iconPath),
        descriptor: result.value,
        loadError: null,
        runtime: unchanged ? existing!.runtime : null,
        loading: unchanged ? existing!.loading : null,
        runtimeError: unchanged ? existing!.runtimeError : null,
        revision: existing?.revision ?? 0,
        inFlight: existing?.inFlight ?? 0,
        uninstalling: false
      });
    }

    this.slots = found;
  }

  private errorSlot(id: string, codeDir: string, error: string): AppSlot {
    return {
      id,
      codeDir,
      iconDataUri: "",
      descriptor: null,
      loadError: error,
      runtime: null,
      loading: null,
      runtimeError: null,
      revision: 0,
      inFlight: 0,
      uninstalling: false
    };
  }

  // ------------------------------------------------------------------ catalog

  private isEnabled(appId: string): boolean {
    const entry = this.options.getEnablement()[appId];
    // A newly discovered app with no record is on by default; installing it was
    // already an owner action.
    return entry?.enabled ?? true;
  }

  private statusOf(slot: AppSlot): MiniAppStatus {
    if (slot.uninstalling) return "uninstalling";
    if (slot.loadError || slot.runtimeError) return "error";
    if (!this.isEnabled(slot.id)) return "disabled";
    return "active";
  }

  /**
   * Provenance for display. A built-in always reports as such; anything else
   * falls back to an unlabelled local directory, which is what a hand-placed
   * app is.
   */
  private sourceOf(appId: string): MiniAppInstallSource {
    if (this.builtinAppIds.has(appId)) return { kind: "builtin" };
    const recorded = this.options.getInstallSources?.()[appId];
    return recorded ?? { kind: "directory", label: "" };
  }

  listCatalog(): MiniAppCatalogEntry[] {
    return [...this.slots.values()]
      .map((slot) => ({
        id: slot.id,
        name: slot.descriptor?.manifest.name ?? slot.id,
        version: slot.descriptor?.manifest.version ?? "unknown",
        description: slot.descriptor?.manifest.description,
        status: this.statusOf(slot),
        enabled: this.isEnabled(slot.id),
        builtin: this.builtinAppIds.has(slot.id),
        hasUi: Boolean(slot.descriptor),
        toolNames: slot.descriptor?.manifest.tools.map((tool) => tool.name) ?? [],
        iconDataUri: slot.iconDataUri,
        source: this.sourceOf(slot.id),
        error: slot.loadError ?? slot.runtimeError ?? undefined
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Tools eligible to appear in a run's deferred-tool index. This is a display
   * filter only — {@link invokeTool} re-checks enablement before executing.
   */
  listTools(): MiniAppToolDescriptor[] {
    const descriptors: MiniAppToolDescriptor[] = [];
    for (const slot of this.slots.values()) {
      if (!slot.descriptor || slot.uninstalling || slot.loadError) continue;
      if (!this.isEnabled(slot.id)) continue;
      const { manifest } = slot.descriptor;
      for (const tool of manifest.tools) {
        descriptors.push({
          toolId: miniAppToolId(slot.id, tool.name),
          label: `${slot.id}.${tool.name}`,
          appId: slot.id,
          appName: manifest.name,
          toolName: tool.name,
          description: tool.description,
          keywords: [
            slot.id,
            manifest.name,
            ...(manifest.description ? manifest.description.split(/\s+/).slice(0, 8) : []),
            ...(tool.title ? [tool.title] : []),
            ...(tool.keywords ?? [])
          ].filter(Boolean),
          inputSchema: tool.inputSchema,
          readOnlyHint: tool.readOnlyHint === true,
          destructiveHint: tool.destructiveHint === true
        });
      }
    }
    return descriptors.sort((a, b) => a.toolId.localeCompare(b.toolId));
  }

  getToolDescriptor(toolId: string): MiniAppToolDescriptor | null {
    const parsed = parseMiniAppToolId(toolId);
    if (!parsed) return null;
    const slot = this.slots.get(parsed.appId);
    const tool = slot?.descriptor?.manifest.tools.find((entry) => entry.name === parsed.toolName);
    if (!slot?.descriptor || !tool) return null;
    return this.listTools().find((descriptor) => descriptor.toolId === toolId)
      ?? {
        toolId,
        label: `${parsed.appId}.${parsed.toolName}`,
        appId: parsed.appId,
        appName: slot.descriptor.manifest.name,
        toolName: parsed.toolName,
        description: tool.description,
        keywords: tool.keywords ?? [],
        inputSchema: tool.inputSchema,
        readOnlyHint: tool.readOnlyHint === true,
        destructiveHint: tool.destructiveHint === true
      };
  }

  getRevision(appId: string): number {
    return this.slots.get(appId)?.revision ?? 0;
  }

  /**
   * Loads an app runtime without invoking one of its domain tools.
   *
   * The creator workflow uses this over a temporary data root before install,
   * catching invalid SQL, a missing default factory, and manifest/handler drift
   * without mutating the owner's live Mini App data.
   */
  async smokeTest(appId: string): Promise<void> {
    const slot = this.slots.get(appId);
    if (!slot) throw new MiniAppError(`Unknown Mini App: ${appId}`, "not_found");
    if (!slot.descriptor) {
      throw new MiniAppError(slot.loadError ?? "Mini App failed to load.", "load_failed");
    }

    const runtime = await this.ensureRuntime(slot);
    try {
      await runtime.dispose?.();
    } finally {
      slot.runtime = null;
      slot.loading = null;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  setEnabled(appId: string, enabled: boolean): MiniAppCatalogEntry {
    const slot = this.slots.get(appId);
    if (!slot) throw new MiniAppError(`Unknown Mini App: ${appId}`, "not_found");
    const existing = this.options.getEnablement()[appId];
    this.options.setEnablement(appId, { ...existing, enabled });
    this.logger.info("miniapp_enablement_changed", { appId, enabled });
    return this.listCatalog().find((entry) => entry.id === appId)!;
  }

  /**
   * Uninstall order matters: stop accepting work, drain what is running, let
   * the app close its own handles, and only then touch the filesystem. A drain
   * timeout deletes nothing — a half-deleted app directory with a live SQLite
   * writer is worse than a failed uninstall the owner can retry.
   */
  async uninstall(appId: string, options: { deleteData: boolean }): Promise<void> {
    const slot = this.slots.get(appId);
    if (!slot) throw new MiniAppError(`Unknown Mini App: ${appId}`, "not_found");

    const codeDir = resolveAppCodeDir(this.options.codeRoot, appId);
    const dataDir = appDataDirPath(this.options.dataRoot, appId);
    if (!dataDir) throw new MiniAppError(`Invalid Mini App id: ${appId}`, "bad_request");

    slot.uninstalling = true;
    try {
      const drainedAt = Date.now() + UNINSTALL_DRAIN_TIMEOUT_MS;
      while (slot.inFlight > 0) {
        if (Date.now() > drainedAt) {
          throw new MiniAppError(
            `Mini App "${appId}" still has ${slot.inFlight} call(s) running; try again shortly.`,
            "busy"
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (slot.runtime?.dispose) {
        await slot.runtime.dispose();
      }
      slot.runtime = null;
      slot.loading = null;

      if (codeDir) {
        fs.rmSync(codeDir, { recursive: true, force: true });
      }
      if (options.deleteData) {
        // Only remove a real directory we resolved under our own data root.
        const realDataDir = resolveContainedPath(this.options.dataRoot, appId);
        if (realDataDir) fs.rmSync(realDataDir, { recursive: true, force: true });
      }
    } catch (cause) {
      slot.uninstalling = false;
      if (cause instanceof MiniAppError) throw cause;
      throw new MiniAppError(sanitizeOutwardMessage(errorMessage(cause)), "load_failed");
    }

    // A built-in keeps a tombstone so the next boot does not silently reinstall
    // what the owner just removed.
    if (this.builtinAppIds.has(appId)) {
      this.options.setEnablement(appId, { enabled: false, removedBuiltin: true });
    } else {
      this.options.setEnablement(appId, null);
    }
    this.logger.info("miniapp_uninstalled", { appId, deleteData: options.deleteData });
    this.refresh();
  }

  // ------------------------------------------------------------------ loading

  private async ensureRuntime(slot: AppSlot): Promise<MiniAppRuntime> {
    if (slot.runtime) return slot.runtime;
    if (slot.loading) return slot.loading;
    if (!slot.descriptor) {
      throw new MiniAppError(slot.loadError ?? "Mini App failed to load.", "load_failed");
    }

    const descriptor = slot.descriptor;
    const loading = this.createRuntime(slot, descriptor)
      .then((runtime) => {
        slot.runtime = runtime;
        slot.runtimeError = null;
        return runtime;
      })
      .catch((cause) => {
        const message = cause instanceof MiniAppError ? cause.message : sanitizeOutwardMessage(errorMessage(cause));
        slot.runtimeError = message;
        this.logger.error("miniapp_runtime_load_failed", { appId: slot.id, error: errorMessage(cause) });
        throw cause instanceof MiniAppError ? cause : new MiniAppError(message, "load_failed");
      })
      .finally(() => {
        slot.loading = null;
      });

    slot.loading = loading;
    return loading;
  }

  private async createRuntime(
    slot: AppSlot,
    descriptor: ValidatedMiniAppManifest
  ): Promise<MiniAppRuntime> {
    const dataDir = appDataDirPath(this.options.dataRoot, slot.id);
    if (!dataDir) throw new MiniAppError(`Invalid Mini App id: ${slot.id}`, "bad_request");
    fs.mkdirSync(dataDir, { recursive: true });
    this.assertSchemaVersion(slot.id, dataDir, descriptor.manifest.data.schemaVersion);

    const importModule = this.options.importModule
      ?? ((entryPath: string) => import(/* @vite-ignore */ pathToFileURL(entryPath).href));
    const loaded = (await importModule(descriptor.entryPath)) as MiniAppServerModule;
    const factory = loaded?.default;
    if (typeof factory !== "function") {
      throw new MiniAppError("runtime.entry must default-export a factory function.", "load_failed");
    }

    const runtime = await factory({
      appId: slot.id,
      dataDir,
      logger: {
        info: (event, detail) => this.logger.info(`miniapp:${slot.id}:${event}`, detail),
        warn: (event, detail) => this.logger.warn(`miniapp:${slot.id}:${event}`, detail),
        error: (event, detail) => this.logger.error(`miniapp:${slot.id}:${event}`, detail)
      }
    });

    if (!runtime || typeof runtime !== "object") {
      throw new MiniAppError("runtime factory did not return a runtime object.", "load_failed");
    }
    if (typeof runtime.handleHttp !== "function") {
      throw new MiniAppError("runtime must provide handleHttp().", "load_failed");
    }

    // Handlers and manifest must correspond exactly. A missing handler is a
    // tool the agent can call and that will fail at runtime; an extra handler
    // is an undeclared capability with no schema and no risk classification.
    const declared = new Set(descriptor.manifest.tools.map((tool) => tool.name));
    const provided = new Set(Object.keys(runtime.tools ?? {}));
    const missing = [...declared].filter((name) => !provided.has(name));
    const extra = [...provided].filter((name) => !declared.has(name));
    if (missing.length > 0 || extra.length > 0) {
      throw new MiniAppError(
        `Tool handlers do not match the manifest.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Undeclared: ${extra.join(", ")}.` : ""}`,
        "load_failed"
      );
    }

    this.writeHostState(dataDir, descriptor.manifest.data.schemaVersion);
    this.logger.info("miniapp_runtime_ready", { appId: slot.id, version: descriptor.manifest.version });
    return runtime;
  }

  /**
   * V1 has no data migration. A schemaVersion the data directory does not
   * recognise stops the app instead of guessing at the owner's data.
   */
  private assertSchemaVersion(appId: string, dataDir: string, schemaVersion: number): void {
    const statePath = path.join(dataDir, HOST_STATE_FILENAME);
    let recorded: number | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as { schemaVersion?: unknown };
      if (Number.isInteger(parsed.schemaVersion)) recorded = parsed.schemaVersion as number;
    } catch {
      recorded = null;
    }
    if (recorded !== null && recorded !== schemaVersion) {
      throw new MiniAppError(
        `Data schemaVersion ${recorded} does not match app schemaVersion ${schemaVersion}. Molibot does not migrate Mini App data automatically.`,
        "load_failed"
      );
    }
  }

  private writeHostState(dataDir: string, schemaVersion: number): void {
    const statePath = path.join(dataDir, HOST_STATE_FILENAME);
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ schemaVersion }, null, 2), "utf8");
    fs.renameSync(tmpPath, statePath);
  }

  /** Shared entry gate: resolves a callable slot or throws a typed error. */
  private requireCallableSlot(appId: string): AppSlot {
    const slot = this.slots.get(appId);
    if (!slot) throw new MiniAppError(`Unknown Mini App: ${appId}`, "not_found");
    if (slot.uninstalling) throw new MiniAppError(`Mini App "${appId}" is being uninstalled.`, "disabled");
    // Re-read enablement per call. A tool already present in a run's tool list
    // must still be refused once the owner switches the app off.
    if (!this.isEnabled(appId)) throw new MiniAppError(`Mini App "${appId}" is disabled.`, "disabled");
    if (slot.loadError) throw new MiniAppError(slot.loadError, "load_failed");
    return slot;
  }

  // --------------------------------------------------------------- invocation

  async invokeTool(
    toolId: string,
    input: unknown,
    context: MiniAppToolCallContext
  ): Promise<MiniAppToolResult> {
    const parsed = parseMiniAppToolId(toolId);
    if (!parsed) throw new MiniAppError(`Not a Mini App tool: ${toolId}`, "not_found");

    const slot = this.requireCallableSlot(parsed.appId);
    const descriptor = slot.descriptor!;
    const toolManifest = descriptor.manifest.tools.find((tool) => tool.name === parsed.toolName);
    if (!toolManifest) {
      throw new MiniAppError(`Unknown tool "${parsed.toolName}" for Mini App "${parsed.appId}".`, "not_found");
    }

    const validate = descriptor.validators.get(parsed.toolName);
    if (validate && !validate(input ?? {})) {
      const detail = (validate.errors ?? [])
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; ");
      throw new MiniAppError(`Invalid input for ${parsed.appId}.${parsed.toolName}: ${detail}`, "invalid_input");
    }

    const runtime = await this.ensureRuntime(slot);
    const handler = runtime.tools[parsed.toolName];
    if (!handler) {
      throw new MiniAppError(`Mini App "${parsed.appId}" has no handler for "${parsed.toolName}".`, "load_failed");
    }

    slot.inFlight += 1;
    try {
      const result = await handler(input ?? {}, context);
      if (result?.changed) slot.revision += 1;
      return {
        content: Array.isArray(result?.content) ? result.content : [],
        structuredContent: result?.structuredContent,
        changed: result?.changed === true
      };
    } catch (cause) {
      // The stack stays in the service log; the agent gets a stable sentence.
      this.logger.error("miniapp_tool_failed", {
        appId: parsed.appId,
        toolName: parsed.toolName,
        error: errorMessage(cause),
        stack: cause instanceof Error ? cause.stack : undefined
      });
      throw new MiniAppError(
        `${parsed.appId}.${parsed.toolName} failed: ${sanitizeOutwardMessage(errorMessage(cause))}`,
        "load_failed"
      );
    } finally {
      slot.inFlight -= 1;
    }
  }

  // --------------------------------------------------------------- UI hosting

  /**
   * Resolves a UI asset request to a real file inside the app's `ui/`
   * directory. An empty path maps to the manifest's `ui.entry`.
   */
  resolveUiAsset(appId: string, rawPath: string): { filePath: string; contentType: string } {
    const slot = this.requireCallableSlot(appId);
    const descriptor = slot.descriptor!;

    const normalized = normalizeUiAssetPath(rawPath);
    if (normalized === null) throw new MiniAppError("Invalid asset path.", "bad_request");

    const filePath = normalized === ""
      ? descriptor.uiEntryPath
      : resolveContainedPath(descriptor.uiRootPath, normalized, { requireFile: true });
    if (!filePath) throw new MiniAppError("Asset not found.", "not_found");

    const extension = path.extname(filePath).toLowerCase();
    const contentType = UI_CONTENT_TYPES[extension];
    // An unknown extension is refused rather than served as octet-stream: the
    // UI directory is a known set of web assets, not a file drop.
    if (!contentType) throw new MiniAppError("Unsupported asset type.", "bad_request");
    return { filePath, contentType };
  }

  // -------------------------------------------------------------- HTTP bridge

  /**
   * Runs one app API request. The host owns method/path normalization, the body
   * size limit, the response envelope and revision bumping; the app only sees a
   * decoded JSON domain request.
   *
   * `/_host/state` is answered by the host itself and never reaches the app.
   */
  async handleHttp(appId: string, request: Request, apiPath: string): Promise<Response> {
    let slot: AppSlot;
    try {
      slot = this.requireCallableSlot(appId);
    } catch (cause) {
      return miniAppErrorResponse(cause);
    }

    const normalizedPath = normalizeApiPath(apiPath);
    if (normalizedPath === null) {
      return jsonResponse(400, { error: "Invalid request path." });
    }

    if (normalizedPath === "/_host/state") {
      return jsonResponse(200, {
        appId,
        enabled: true,
        revision: slot.revision,
        schemaVersion: slot.descriptor?.manifest.data.schemaVersion ?? null
      });
    }

    const method = request.method.toUpperCase();
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) {
      return jsonResponse(405, { error: `Method ${method} is not allowed.` });
    }

    let body: unknown = undefined;
    if (method !== "GET") {
      try {
        const raw = await request.text();
        if (raw.length > MAX_JSON_BODY_BYTES) {
          return jsonResponse(413, { error: "Request body too large." });
        }
        body = raw.length > 0 ? JSON.parse(raw) : undefined;
      } catch {
        return jsonResponse(400, { error: "Request body must be JSON." });
      }
    }

    const query: Record<string, string[]> = {};
    for (const [key, value] of new URL(request.url).searchParams.entries()) {
      (query[key] ??= []).push(value);
    }

    const appRequest: MiniAppHttpRequest = {
      method: method as MiniAppHttpMethod,
      path: normalizedPath,
      query,
      body,
      signal: request.signal
    };

    slot.inFlight += 1;
    try {
      const runtime = await this.ensureRuntime(slot);
      const result: MiniAppHttpResult = await runtime.handleHttp(appRequest);
      if (result?.changed) slot.revision += 1;
      const status = Number.isInteger(result?.status) ? (result.status as number) : 200;
      return jsonResponse(status, result?.body ?? null, slot.revision);
    } catch (cause) {
      if (cause instanceof MiniAppError) return miniAppErrorResponse(cause);
      this.logger.error("miniapp_http_failed", {
        appId,
        path: normalizedPath,
        error: errorMessage(cause),
        stack: cause instanceof Error ? cause.stack : undefined
      });
      return jsonResponse(500, { error: "Mini App request failed." });
    } finally {
      slot.inFlight -= 1;
    }
  }
}

/** Rejects null bytes, `..`, double encoding and absurd lengths. */
function normalizeApiPath(rawPath: string): string | null {
  if (typeof rawPath !== "string") return null;
  if (rawPath.length > 1024) return null;
  if (rawPath.includes("\0")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("%") || decoded.includes("\0") || decoded.includes("\\")) return null;
  const trimmed = decoded.replace(/^\/+/, "");
  if (trimmed === "") return "/";
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return `/${segments.join("/")}`;
}

function jsonResponse(status: number, body: unknown, revision?: number): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
  if (revision !== undefined) headers["x-molibot-miniapp-revision"] = String(revision);
  return new Response(JSON.stringify(body ?? null), { status, headers });
}

export function miniAppErrorResponse(cause: unknown): Response {
  if (cause instanceof MiniAppError) {
    const status = cause.code === "not_found"
      ? 404
      : cause.code === "disabled"
        ? 403
        : cause.code === "bad_request" || cause.code === "invalid_input"
          ? 400
          : cause.code === "busy"
            ? 409
            : 503;
    return jsonResponse(status, { error: cause.message, code: cause.code });
  }
  return jsonResponse(500, { error: "Mini App request failed." });
}

export function createMiniAppHost(options: MiniAppHostOptions): MiniAppHost {
  return new MiniAppHost(options);
}
