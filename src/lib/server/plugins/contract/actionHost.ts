import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getPluginConfigStore } from "$lib/server/plugins/contract/configStore.js";
import { pluginCacheDir, pluginDataDir, pluginPackageDir } from "$lib/server/plugins/contract/paths.js";
import { readMolibotPluginManifest } from "$lib/server/plugins/contract/manifest.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

const DEFAULT_ACTION_TIMEOUT_MS = 60_000;
const LOAD_TIMEOUT_MS = 15_000;

function workerPath(): string {
  const appRoot = process.env.MOLIBOT_APP_ROOT?.trim() || process.cwd();
  return path.join(appRoot, "scripts", "runtime", "plugin-settings-worker.mjs");
}

function killProcessTree(child: ChildProcess): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

export interface PluginActionInvocationOptions {
  pluginId: string;
  action: string;
  input?: unknown;
  settings?: RuntimeSettings;
  timeoutMs?: number;
  onProgress?: (progress: unknown) => void;
}

export interface PluginActionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Dispatches a declared settings action in the isolated plugin fault domain.
 */
export async function invokePluginSettingsAction(
  options: PluginActionInvocationOptions
): Promise<PluginActionResult> {
  const { pluginId, action, input, settings, timeoutMs = DEFAULT_ACTION_TIMEOUT_MS, onProgress } = options;

  // 1. Invocation-time disable guard
  const entrySettings = settings?.plugins?.entries?.[pluginId];
  if (entrySettings?.enabled !== true) {
    return { ok: false, error: `Plugin "${pluginId}" is disabled` };
  }

  // 2. Validate package and manifest
  const pkgDir = pluginPackageDir(pluginId);
  if (pkgDir === null) {
    return { ok: false, error: `Plugin package "${pluginId}" not found` };
  }

  const validated = readMolibotPluginManifest(pkgDir, pluginId);
  if (!validated.ok) {
    return { ok: false, error: `Invalid plugin manifest: ${validated.error}` };
  }

  const manifest = validated.value.manifest;
  if (!validated.value.runtimeEntryPath) {
    return { ok: false, error: `Plugin "${pluginId}" has no runtime entry` };
  }
  const runtimeEntryPath = validated.value.runtimeEntryPath;
  if (!manifest.runtime?.actions.includes(action)) {
    return { ok: false, error: `Plugin action "${action}" is not declared` };
  }

  // 3. Load config and secrets (scoped)
  const configStore = getPluginConfigStore();
  const configRes = configStore.readConfig(pluginId, manifest.config.schemaVersion);
  const currentConfig = configRes.status === "ok" ? configRes.values : {};
  const currentSecrets = configStore.readSecretValues(pluginId);
  const dataDir = pluginDataDir(pluginId) ?? "";
  const cacheDir = pluginCacheDir(pluginId) ?? "";

  // 4. Fork child process in isolated group
  const child = fork(workerPath(), [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: process.platform !== "win32"
  });

  return new Promise<PluginActionResult>((resolve) => {
    let settled = false;
    let callId = 1;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessTree(child);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: `Action "${action}" timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on("message", (message: any) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "progress" && onProgress) {
        onProgress(message.progress);
        return;
      }

      if (message.id === 1) {
        // Load response
        if (!message.ok) {
          cleanup();
          resolve({ ok: false, error: message.error?.message || "Failed to load plugin runtime module" });
          return;
        }

        // Now invoke action
        callId = 2;
        child.send({
          id: 2,
          type: "invokeAction",
          payload: { action, input }
        });
      } else if (message.id === 2) {
        // Action response
        cleanup();
        if (message.ok) {
          resolve({ ok: true, result: message.result });
        } else {
          resolve({ ok: false, error: message.error?.message || "Action execution failed" });
        }
      }
    });

    child.on("error", (err) => {
      cleanup();
      resolve({ ok: false, error: `Worker error: ${err.message}` });
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        cleanup();
        resolve({ ok: false, error: `Worker exited unexpectedly (code: ${code}, signal: ${signal})` });
      }
    });

    // Send initial load command
    child.send({
      id: 1,
      type: "load",
      payload: {
        moduleUrl: pathToFileURL(runtimeEntryPath).href,
        config: currentConfig,
        secrets: currentSecrets,
        dataDir,
        cacheDir
      }
    });
  });
}
