import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import {
  builtinMiniAppMeta,
  builtinMiniAppVersion,
  materializeBuiltinMiniApp,
  type BuiltinMiniApp
} from "$lib/server/miniapps/builtinPackage.js";
import { sanitizeMiniAppResultCard } from "$lib/shared/miniappCard.js";
import { MINIAPP_BADGE_MAX_COUNT } from "$lib/server/miniapps/types.js";
import {
  hasMiniAppManifestFile,
  readMiniAppManifest,
  type ValidatedMiniAppManifest
} from "$lib/server/miniapps/manifest.js";
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
  type MiniAppBuiltinEntry,
  type MiniAppCatalogEntry,
  type MiniAppHttpMethod,
  type MiniAppHttpRequest,
  type MiniAppHttpResult,
  type MiniAppInstallSource,
  type MiniAppLogger,
  type MiniAppAiFacade,
  type MiniAppBadge,
  type MiniAppBadgeFacade,
  type MiniAppRuntime,
  type MiniAppServerModule,
  type MiniAppStatus,
  type MiniAppToolCallContext,
  type MiniAppToolDescriptor,
  type MiniAppToolResult
} from "$lib/server/miniapps/types.js";
import { bundleMiniAppRuntime } from "$lib/server/miniapps/runtimeBundle.js";
import { createMiniAppProcessRuntime } from "$lib/server/miniapps/processRuntime.js";

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
const MAX_BINARY_BODY_BYTES = 25 * 1024 * 1024;

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
  /** Test-only seam for ESM loading. Production runs bundled code in a child process. */
  importModule?: (entryPath: string) => Promise<unknown>;
  /**
   * The bundled copy of a built-in app, used to offer and apply an update.
   * Absent means the host cannot update built-ins (the catalog then simply
   * never offers one).
   */
  getBuiltinApp?: (appId: string) => BuiltinMiniApp | null;
  createAiFacade?: (appId: string, capabilities: import("$lib/server/miniapps/types.js").MiniAppAiCapability[], dataDir: string) => MiniAppAiFacade;
  /** Test seam for process watchdogs. Production defaults to 60 seconds. */
  processCallTimeoutMs?: number;
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
  /**
   * Live sidebar badge. Held in memory rather than persisted on purpose: after
   * a restart no app can still be doing the work its badge described, so a
   * restored count would be a claim nothing backs (pitfall #23a/#23d).
   */
  badge: MiniAppBadge;
  uninstalling: boolean;
  /**
   * Set while the app's code directory is being replaced by an update. Like
   * `uninstalling` it stops new work from entering, but it is deliberately not
   * a catalog status: the app is coming straight back, and the request that
   * started it is still in flight, so there is no moment for the owner to see
   * a transient label.
   */
  updating: boolean;
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
 * Bounds whatever an app passed to `badge.set()`.
 *
 * A non-integer, negative or zero count clears the badge instead of rendering
 * "0" or "NaN" on the sidebar — an app counting down to nothing should end with
 * no badge, and that is the reading that needs no app-side special case.
 */
function normalizeBadge(badge: MiniAppBadge): MiniAppBadge {
  if (!badge || typeof badge !== "object") return null;
  if (badge.kind === "dot") return { kind: "dot" };
  if (badge.kind !== "count") return null;
  const count = Math.floor(Number(badge.count));
  if (!Number.isFinite(count) || count <= 0) return null;
  return { kind: "count", count: Math.min(count, MINIAPP_BADGE_MAX_COUNT) };
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

  /** Stop every loaded App process. Used by orderly service/test teardown. */
  async dispose(): Promise<void> {
    await Promise.all([...this.slots.values()].map(async (slot) => {
      const runtime = slot.runtime ?? await slot.loading?.catch(() => null) ?? null;
      slot.runtime = null;
      slot.loading = null;
      if (runtime?.dispose) await runtime.dispose();
    }));
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
      // The code root is a real directory a person can drop files into. Only an
      // entry that claims to be a Mini App — a directory holding a
      // `manifest.json` — is a catalog candidate; a zip, a stray file or an
      // unrelated folder is skipped without a slot, because an entry the user
      // can neither install nor uninstall is only noise.
      if (!hasMiniAppManifestFile(path.join(this.options.codeRoot, name))) continue;
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
        // A rediscovered slot that kept its runtime kept the work behind its
        // badge too; a reloaded one starts clean.
        badge: unchanged ? (existing?.badge ?? null) : null,
        uninstalling: false,
        updating: false
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
      badge: null,
      uninstalling: false,
      updating: false
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

  /**
   * The bundled version of a built-in, when this host was given access to the
   * bundle and the app is one we ship.
   */
  private bundledVersionOf(appId: string): string {
    if (!this.builtinAppIds.has(appId)) return "";
    const bundled = this.options.getBuiltinApp?.(appId);
    return bundled ? builtinMiniAppVersion(bundled) : "";
  }

  /**
   * Whether the shipped copy is newer than what is installed.
   *
   * Semver decides when both sides parse, so a build that ships an *older*
   * app than the owner already has never offers a downgrade. When either side
   * is unparseable — including the `"unknown"` an app that failed to load
   * reports — any difference counts as an update, because reinstalling the
   * shipped copy is exactly the repair for a broken built-in.
   */
  private updateAvailableFor(slot: AppSlot): boolean {
    const bundled = this.bundledVersionOf(slot.id);
    if (!bundled) return false;
    const installed = slot.descriptor?.manifest.version ?? "";
    if (installed === bundled) return false;
    const bundledParsed = semver.valid(bundled);
    const installedParsed = semver.valid(installed);
    if (bundledParsed && installedParsed) return semver.gt(bundledParsed, installedParsed);
    return true;
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
        messageActions: slot.descriptor?.manifest.contributions?.messageActions.map((action) => ({
          ...action,
          label: { ...action.label },
          accepts: [...action.accepts]
        })) ?? [],
        aiCapabilities: [...(slot.descriptor?.manifest.ai?.capabilities ?? [])],
        hostCapabilities: [...(slot.descriptor?.manifest.host?.capabilities ?? [])],
        // A disabled or failed app must not keep advertising a badge: the
        // sidebar would show a count for something the owner cannot open.
        badge: this.statusOf(slot) === "active" && this.isEnabled(slot.id) ? slot.badge : null,
        iconDataUri: slot.iconDataUri,
        source: this.sourceOf(slot.id),
        updateAvailable: this.updateAvailableFor(slot),
        availableVersion: this.bundledVersionOf(slot.id),
        error: slot.loadError ?? slot.runtimeError ?? undefined
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Every built-in this build ships, installed or not, with the state the
   * manager needs to offer install / update / uninstall.
   *
   * Reads identity from the *bundled* copy rather than from disk, because a
   * built-in the owner never installed (or deliberately removed) has nothing on
   * disk to read — and an app that cannot be listed cannot be installed back.
   */
  listBuiltinCatalog(): MiniAppBuiltinEntry[] {
    const entries: MiniAppBuiltinEntry[] = [];
    for (const appId of this.builtinAppIds) {
      const bundled = this.options.getBuiltinApp?.(appId);
      // No bundled copy means this host cannot install or describe the app;
      // listing it would offer a button that can only fail.
      if (!bundled) continue;
      const meta = builtinMiniAppMeta(bundled);
      const slot = this.slots.get(appId);
      const enablement = this.options.getEnablement()[appId];
      entries.push({
        id: meta.id,
        name: meta.name,
        description: meta.description,
        availableVersion: meta.version,
        // The installed copy's icon may be an owner-edited one; the bundled
        // icon is what the row is describing, so it wins here.
        iconDataUri: meta.iconDataUri || (slot?.iconDataUri ?? ""),
        toolNames: slot?.descriptor?.manifest.tools.map((tool) => tool.name) ?? meta.toolNames,
        installed: Boolean(slot),
        installedVersion: slot?.descriptor?.manifest.version ?? "",
        updateAvailable: slot ? this.updateAvailableFor(slot) : false,
        enabled: slot ? this.isEnabled(appId) : false,
        status: slot ? this.statusOf(slot) : "not-installed",
        removedByOwner: enablement?.removedBuiltin === true,
        error: slot ? (slot.loadError ?? slot.runtimeError ?? undefined) : undefined
      });
    }
    return entries;
  }

  /**
   * Tools eligible to appear in a run's deferred-tool index. This is a display
   * filter only — {@link invokeTool} re-checks enablement before executing.
   */
  listTools(): MiniAppToolDescriptor[] {
    const descriptors: MiniAppToolDescriptor[] = [];
    for (const slot of this.slots.values()) {
      if (!slot.descriptor || slot.uninstalling || slot.updating || slot.loadError) continue;
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

  // ----------------------------------------------------------------- badges

  /**
   * The badge handle handed to one app's runtime.
   *
   * Closes over the slot rather than the id so a badge written by a runtime
   * that has since been replaced lands on the object that is being discarded,
   * not on its successor.
   */
  private createBadgeFacade(slot: AppSlot): MiniAppBadgeFacade {
    return {
      set: (badge) => {
        slot.badge = normalizeBadge(badge);
      },
      get: () => slot.badge,
      clear: () => {
        slot.badge = null;
      }
    };
  }

  /**
   * Clears a badge on the owner's behalf — used when they open the app, which
   * is the act of "having seen it".
   *
   * The host owns this rather than the app because the host is what knows the
   * panel was opened; an app polling to discover it would be a worse contract.
   */
  clearBadge(appId: string): void {
    const slot = this.slots.get(appId);
    if (slot) slot.badge = null;
  }

  // -------------------------------------------------------- data file access

  /**
   * Reads a file the app placed in its own data directory, for the
   * `composer.attach` bridge action.
   *
   * The relative path arrives from the app's UI, so it is untrusted input about
   * a directory the app legitimately owns: containment is proven against the
   * real dataDir after following symlinks (pitfall #6 — a UI-supplied marker is
   * not a filesystem path until the owner of that directory validates it).
   * Nothing outside dataDir is reachable, and no host path is ever returned.
   */
  readDataFile(appId: string, relativePath: string, maxBytes: number): { bytes: Buffer; name: string } {
    const slot = this.requireCallableSlot(appId);
    const dataDir = appDataDirPath(this.options.dataRoot, slot.id);
    if (!dataDir) throw new MiniAppError("Invalid Mini App id.", "bad_request");

    const filePath = resolveContainedPath(dataDir, relativePath, { requireFile: true });
    if (!filePath) throw new MiniAppError("File not found in this Mini App's data directory.", "not_found");

    const stats = fs.statSync(filePath);
    if (stats.size > maxBytes) {
      throw new MiniAppError(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB attachment limit.`, "invalid_input");
    }
    return { bytes: fs.readFileSync(filePath), name: path.basename(filePath) };
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
   * Makes code that was just installed on disk live in this service process.
   *
   * Calls already inside the old runtime finish first. The old instance then
   * disposes, discovery reads the replacement manifest, and an enabled app is
   * eagerly loaded so the install request cannot report success for code that
   * only fails on its first later invocation.
   */
  async activateInstalled(appId: string): Promise<void> {
    const previous = this.slots.get(appId);
    if (previous) {
      previous.updating = true;
      try {
        const drainedAt = Date.now() + UNINSTALL_DRAIN_TIMEOUT_MS;
        while (previous.inFlight > 0) {
          if (Date.now() > drainedAt) {
            throw new MiniAppError(
              `Mini App "${appId}" still has ${previous.inFlight} call(s) running; try again shortly.`,
              "busy"
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (previous.runtime?.dispose) await previous.runtime.dispose();
        previous.runtime = null;
        previous.loading = null;
      } catch (cause) {
        previous.updating = false;
        if (cause instanceof MiniAppError) throw cause;
        throw new MiniAppError(sanitizeOutwardMessage(errorMessage(cause)), "load_failed");
      }
    }

    this.refresh();
    const active = this.slots.get(appId);
    if (!active) throw new MiniAppError(`Unknown Mini App: ${appId}`, "not_found");
    if (!active.descriptor) {
      throw new MiniAppError(active.loadError ?? "Mini App failed to load.", "load_failed");
    }
    if (this.isEnabled(appId)) await this.ensureRuntime(active);
    this.logger.info("miniapp_activated", { appId, version: active.descriptor.manifest.version });
  }

  /**
   * Writes the shipped copy of a built-in into the code root — the one
   * operation behind both "install" and "update", because they differ only in
   * whether something was there before.
   *
   * Same ordering discipline as uninstall — suspend, drain, dispose, then touch
   * the filesystem — because an installed app may hold an open SQLite handle on
   * files inside the directory being replaced. The app's *data* directory is
   * never touched, which is what makes an update safe to offer.
   *
   * Enablement is preserved: an owner who had the app switched off gets the new
   * code, still switched off. A removal tombstone is cleared, because an owner
   * asking for the app back is exactly the intent the tombstone records the
   * absence of.
   */
  async installBuiltin(appId: string): Promise<void> {
    if (!this.builtinAppIds.has(appId)) {
      throw new MiniAppError(`Mini App "${appId}" is not a built-in app.`, "bad_request");
    }
    const bundled = this.options.getBuiltinApp?.(appId);
    if (!bundled) {
      throw new MiniAppError(`No bundled copy of "${appId}" is available.`, "not_found");
    }

    const slot = this.slots.get(appId);
    if (slot) slot.updating = true;
    try {
      if (slot) {
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
      }

      materializeBuiltinMiniApp(this.options.codeRoot, bundled);
    } catch (cause) {
      if (cause instanceof MiniAppError) throw cause;
      throw new MiniAppError(sanitizeOutwardMessage(errorMessage(cause)), "load_failed");
    } finally {
      if (slot) slot.updating = false;
    }

    const enablement = this.options.getEnablement()[appId];
    if (!enablement || enablement.removedBuiltin) {
      this.options.setEnablement(appId, { ...enablement, enabled: true, removedBuiltin: false });
    }

    this.logger.info(slot ? "miniapp_updated" : "miniapp_builtin_installed", {
      appId,
      version: builtinMiniAppVersion(bundled)
    });
    await this.activateInstalled(appId);
  }

  /**
   * Reinstalls an *installed* built-in from the shipped copy.
   *
   * Only the precondition differs from {@link installBuiltin}: an update names
   * something the owner already has, so an unknown id is a 404 rather than a
   * silent first install.
   */
  async updateBuiltin(appId: string): Promise<void> {
    if (!this.slots.has(appId)) throw new MiniAppError(`Unknown Mini App: ${appId}`, "not_found");
    await this.installBuiltin(appId);
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
      fs.rmSync(path.join(this.options.codeRoot, ".runtime", appId), { recursive: true, force: true });
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

    const unavailableAi: MiniAppAiFacade = {
      generateText: async () => { throw new MiniAppError("AI capability is unavailable.", "load_failed"); },
      transcribe: async () => { throw new MiniAppError("AI capability is unavailable.", "load_failed"); }
    };
    const badge = this.createBadgeFacade(slot);
    const ai = this.options.createAiFacade?.(slot.id, descriptor.manifest.ai?.capabilities ?? [], dataDir) ?? unavailableAi;
    const appLogger: MiniAppLogger = {
      info: (event, detail) => this.logger.info(`miniapp:${slot.id}:${event}`, detail),
      warn: (event, detail) => this.logger.warn(`miniapp:${slot.id}:${event}`, detail),
      error: (event, detail) => this.logger.error(`miniapp:${slot.id}:${event}`, detail)
    };
    let runtime: MiniAppRuntime;
    if (this.options.importModule) {
      const loaded = await this.options.importModule(descriptor.entryPath) as MiniAppServerModule;
      const factory = loaded?.default;
      if (typeof factory !== "function") {
        throw new MiniAppError("runtime.entry must default-export a factory function.", "load_failed");
      }
      runtime = await factory({ appId: slot.id, dataDir, badge, ai, logger: appLogger });
    } else {
      const bundle = await bundleMiniAppRuntime({
        appId: slot.id,
        entryPath: descriptor.entryPath,
        cacheRoot: path.join(this.options.codeRoot, ".runtime")
      });
      runtime = await createMiniAppProcessRuntime({
        appId: slot.id,
        moduleUrl: bundle.moduleUrl,
        dataDir,
        toolNames: descriptor.manifest.tools.map((tool) => tool.name),
        badge,
        ai,
        logger: appLogger,
        callTimeoutMs: this.options.processCallTimeoutMs,
        onFault: (error) => {
          slot.runtime = null;
          this.logger.warn("miniapp_runtime_process_failed", { appId: slot.id, error: error.message });
        }
      });
    }

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
   * Checks the data directory's recorded schemaVersion against the manifest.
   *
   * When they differ — an update shipped a new schema — the host logs a
   * warning and lets the app start anyway. The app's own server module is
   * responsible for running its SQL migration (e.g. ALTER TABLE) inside
   * `openDatabase()`. After a successful startup, {@link writeHostState}
   * records the new schemaVersion; if the app's migration fails, the error
   * propagates naturally and the recorded version stays unchanged.
   *
   * A downgrade (new < recorded) is treated identically: the app chose to
   * accept it in its manifest, and blocking would prevent a rollback.
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
      this.logger.info("miniapp_schema_version_changed", {
        appId,
        from: recorded,
        to: schemaVersion
      });
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
    if (slot.updating) throw new MiniAppError(`Mini App "${appId}" is being updated; try again shortly.`, "busy");
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

    slot.inFlight += 1;
    try {
      const runtime = await this.ensureRuntime(slot);
      const handler = runtime.tools[parsed.toolName];
      if (!handler) {
        throw new MiniAppError(`Mini App "${parsed.appId}" has no handler for "${parsed.toolName}".`, "load_failed");
      }

      try {
        const result = await handler(input ?? {}, context);
        if (result?.changed) slot.revision += 1;
        // The card is sanitized here rather than at the render site so every
        // consumer — desktop transcript, message-action route, any later surface
        // — receives the same already-bounded shape (pitfall #7).
        const card = sanitizeMiniAppResultCard(result?.card, parsed.appId);
        return {
          content: Array.isArray(result?.content) ? result.content : [],
          structuredContent: result?.structuredContent,
          changed: result?.changed === true,
          ...(card ? { card } : {})
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
      }
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
    let contentType: string | undefined;
    if (method !== "GET") {
      const mountedPath = `/api${normalizedPath}`;
      const declaredUpload = slot.descriptor?.manifest.ai?.uploadLimits.find((limit) =>
        mountedPath === limit.path || mountedPath.startsWith(`${limit.path}/`)
      );
      const requestContentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
      if (declaredUpload && requestContentType !== "application/json") {
        const allowedBytes = Math.min(MAX_BINARY_BODY_BYTES, declaredUpload.maxBytes);
        const declaredLength = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > allowedBytes) {
          return jsonResponse(413, { error: "Request body too large." });
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength > allowedBytes) return jsonResponse(413, { error: "Request body too large." });
        body = bytes;
        contentType = requestContentType || "application/octet-stream";
      } else {
        try {
          const raw = await request.text();
          if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BODY_BYTES) {
            return jsonResponse(413, { error: "Request body too large." });
          }
          body = raw.length > 0 ? JSON.parse(raw) : undefined;
        } catch {
          return jsonResponse(400, { error: "Request body must be JSON." });
        }
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
      ...(contentType ? { contentType } : {}),
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
        : cause.code === "forbidden"
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
