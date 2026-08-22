import fs from "node:fs";
import path from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import {
  pluginConfigDir,
  pluginDataDir,
  pluginCacheDir,
  pluginSecretsFilePath,
  pluginSettingsFilePath,
  isScopedDirPath
} from "$lib/server/plugins/contract/paths.js";
import type { PluginConfigReadResult, PluginConfigWriteError } from "$lib/server/plugins/contract/types.js";

/**
 * Scoped, host-owned persistence for plugin configuration.
 *
 * The plugin owns field semantics and validation; this store owns atomic
 * persistence, secret semantics, size limits, and directory isolation. Writes
 * are serialized per plugin (a promise queue) so a settings page saving while
 * a runtime action writes cannot interleave read-modify-write cycles, and
 * each write is a tmp-file atomic replace, so a crash mid-write can never
 * leave a torn document behind.
 *
 * Secret values never leave this module except through
 * {@link PluginConfigStore.readSecretValues}, which exists for the settings
 * *runtime* (plugin fault domain) - never for an HTTP response.
 */

/** Document shape persisted at `config/<id>/settings.json`. */
interface PluginSettingsDocument {
  pluginId: string;
  schemaVersion: number;
  values: Record<string, unknown>;
}

/** Document shape persisted at `config/<id>/secrets.json`. */
interface PluginSecretsDocument {
  pluginId: string;
  values: Record<string, string>;
}

const MAX_SETTINGS_BYTES = 512 * 1024;
const MAX_SECRETS_BYTES = 128 * 1024;
const SECRET_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SECRETS_FILE_MODE = 0o600;

export type PluginConfigWriteResult = { ok: true } | { ok: false; error: PluginConfigWriteError };

export interface PluginSecretWritePatch {
  /** Replace (or set) the secret with a new value. */
  replace?: Record<string, string>;
  /** Remove the named secrets; an absent name is a no-op. */
  clear?: string[];
}

/**
 * Per-plugin mutation queue. Keyed by plugin id so two different plugins can
 * write concurrently without waiting on each other, while writes to the same
 * plugin's documents are strictly ordered.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(pluginId: string, operation: () => Promise<T> | T): Promise<T> {
  const previous = writeQueues.get(pluginId) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  writeQueues.set(pluginId, next);
  void next.catch(() => {
    // The queue must survive a failed operation; failures are reported
    // through the operation's own result, not by poisoning the chain.
  });
  return next;
}

function readJsonDocument(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function atomicWrite(filePath: string, text: string, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, mode === undefined ? "utf8" : { encoding: "utf8", mode });
  fs.renameSync(tmpPath, filePath);
}

function writeError(code: PluginConfigWriteError["code"], message: string): PluginConfigWriteResult {
  return { ok: false, error: { code, message } };
}

export class PluginConfigStore {
  readonly configRoot?: string;

  constructor(configRoot?: string) {
    this.configRoot = configRoot;
  }

  /**
   * Reads the plugin's persisted settings document. A document whose
   * `schemaVersion` does not satisfy what the caller's package supports is
   * reported as `incompatible`, never guessed at: the host has no config
   * migration system in V1, and the owner sees an explicit reconfigure state.
   */
  readConfig(pluginId: string, supportedSchemaVersion: number): PluginConfigReadResult {
    const filePath = pluginSettingsFilePath(pluginId, this.configRoot);
    if (filePath === null) return { status: "missing" };
    const document = readJsonDocument(filePath);
    if (document === null) return { status: "missing" };
    if (document.pluginId !== pluginId) return { status: "missing" };
    if (!Number.isInteger(document.schemaVersion)) return { status: "missing" };
    const schemaVersion = document.schemaVersion as number;
    if (schemaVersion !== supportedSchemaVersion) {
      return { status: "incompatible", foundSchemaVersion: schemaVersion };
    }
    const values =
      document.values && typeof document.values === "object" && !Array.isArray(document.values)
        ? (document.values as Record<string, unknown>)
        : {};
    return { status: "ok", schemaVersion, values };
  }

  /**
   * Persists the plugin's settings document. Validation runs *before* the
   * first irreversible step, so a rejected write leaves the previous file
   * intact and the caller's error reaches the user instead of being silently
   * absorbed.
   */
  async writeConfig(
    pluginId: string,
    schemaVersion: number,
    values: Record<string, unknown>,
    options: {
      /** Returns a human-readable error, or null when the values are valid. */
      validate?: (values: Record<string, unknown>) => string | null;
    } = {}
  ): Promise<PluginConfigWriteResult> {
    return enqueue(pluginId, () => {
      const filePath = pluginSettingsFilePath(pluginId, this.configRoot);
      if (filePath === null) return writeError("invalid_id", "Invalid plugin id.");
      if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
        return writeError("validation_failed", "schemaVersion must be a positive integer.");
      }
      if (options.validate) {
        const error = options.validate(values);
        if (error !== null) return writeError("validation_failed", error);
      }
      const document: PluginSettingsDocument = { pluginId, schemaVersion, values };
      const serialized = JSON.stringify(document, null, 2);
      if (Buffer.byteLength(serialized, "utf8") > MAX_SETTINGS_BYTES) {
        return writeError("too_large", `Settings document exceeds ${Math.floor(MAX_SETTINGS_BYTES / 1024)} KB.`);
      }
      try {
        atomicWrite(filePath, serialized);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return writeError("write_failed", `Could not persist settings: ${message}`);
      }
      return { ok: true } as const;
    });
  }

  /**
   * Presence metadata for the plugin's secrets - the only secret information
   * an HTTP response, catalog, or log is ever allowed to carry.
   */
  listSecrets(pluginId: string): Record<string, { present: boolean }> {
    const filePath = pluginSecretsFilePath(pluginId, this.configRoot);
    if (filePath === null) return {};
    const document = readJsonDocument(filePath);
    if (document === null || document.pluginId !== pluginId) return {};
    const values =
      document.values && typeof document.values === "object" && !Array.isArray(document.values)
        ? (document.values as Record<string, unknown>)
        : {};
    const presence: Record<string, { present: boolean }> = {};
    for (const [key, value] of Object.entries(values)) {
      if (SECRET_KEY_PATTERN.test(key) && typeof value === "string" && value.length > 0) {
        presence[key] = { present: true };
      }
    }
    return presence;
  }

  /**
   * Applies secret replacements and clears in one serialized mutation.
   * Secrets are never part of the ordinary settings document, and an empty
   * submission never erases anything - removal happens only through an
   * explicit `clear`.
   */
  async writeSecrets(pluginId: string, patch: PluginSecretWritePatch): Promise<PluginConfigWriteResult> {
    return enqueue(pluginId, () => {
      const filePath = pluginSecretsFilePath(pluginId, this.configRoot);
      if (filePath === null) return writeError("invalid_id", "Invalid plugin id.");
      const replace = patch.replace ?? {};
      const clear = patch.clear ?? [];
      for (const key of Object.keys(replace)) {
        if (!SECRET_KEY_PATTERN.test(key)) return writeError("validation_failed", `Invalid secret key "${key}".`);
        if (typeof replace[key] !== "string") return writeError("validation_failed", `Secret "${key}" must be a string.`);
      }
      for (const key of clear) {
        if (!SECRET_KEY_PATTERN.test(key)) return writeError("validation_failed", `Invalid secret key "${key}".`);
      }

      const existing = readJsonDocument(filePath);
      const values: Record<string, string> =
        existing && existing.pluginId === pluginId &&
        existing.values && typeof existing.values === "object" && !Array.isArray(existing.values)
          ? { ...(existing.values as Record<string, string>) }
          : {};
      for (const key of clear) delete values[key];
      Object.assign(values, replace);

      const document: PluginSecretsDocument = { pluginId, values };
      const serialized = JSON.stringify(document, null, 2);
      if (Buffer.byteLength(serialized, "utf8") > MAX_SECRETS_BYTES) {
        return writeError("too_large", `Secrets document exceeds ${Math.floor(MAX_SECRETS_BYTES / 1024)} KB.`);
      }
      try {
        // Every atomic replacement must recreate the file as owner-only. The
        // temporary file becomes the final inode after rename, so omitting the
        // mode on later writes would silently widen secrets to the process
        // umask (commonly 0644).
        atomicWrite(filePath, serialized, SECRETS_FILE_MODE);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return writeError("write_failed", `Could not persist secrets: ${message}`);
      }
      return { ok: true } as const;
    });
  }

  /**
   * Secret values, for the settings *runtime* in the plugin fault domain
   * only. No HTTP handler, catalog projection, or log line may call this.
   */
  readSecretValues(pluginId: string): Record<string, string> {
    const filePath = pluginSecretsFilePath(pluginId, this.configRoot);
    if (filePath === null) return {};
    const document = readJsonDocument(filePath);
    if (document === null || document.pluginId !== pluginId) return {};
    const values =
      document.values && typeof document.values === "object" && !Array.isArray(document.values)
        ? (document.values as Record<string, unknown>)
        : {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (SECRET_KEY_PATTERN.test(key) && typeof value === "string") out[key] = value;
    }
    return out;
  }

  /** Removes the plugin's entire config directory (secrets included). */
  deleteConfigDir(pluginId: string): boolean {
    const dir = pluginConfigDir(pluginId);
    return dir !== null && removeScopedDir(storagePaths.pluginsConfigDir, pluginId, dir);
  }

  /** Removes the plugin's durable data directory. */
  deleteDataDir(pluginId: string): boolean {
    const dir = pluginDataDir(pluginId);
    return dir !== null && removeScopedDir(storagePaths.pluginsDataDir, pluginId, dir);
  }

  /** Empties the plugin's disposable cache directory. */
  clearCacheDir(pluginId: string): boolean {
    const dir = pluginCacheDir(pluginId);
    return dir !== null && removeScopedDir(storagePaths.pluginsCacheDir, pluginId, dir);
  }
}

function removeScopedDir(root: string, pluginId: string, dir: string): boolean {
  // The guard before any `rm -rf`: only the plugin's own directory inside its
  // assigned root may be removed, so a bad id can never delete a sibling's
  // (or the root's) files.
  if (!isScopedDirPath(root, pluginId, dir)) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

let store: PluginConfigStore | null = null;

export function getPluginConfigStore(): PluginConfigStore {
  if (store === null) store = new PluginConfigStore();
  return store;
}

/** Test seam: drops the singleton (and, implicitly, its write queues). */
export function resetPluginConfigStoreForTests(): void {
  store = null;
  writeQueues.clear();
}
