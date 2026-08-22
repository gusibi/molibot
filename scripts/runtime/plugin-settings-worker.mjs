#!/usr/bin/env node
import { pathToFileURL } from "node:url";

/**
 * Isolated worker process for plugin settings runtime actions (issue #34).
 *
 * Runs third-party plugin action code in a dedicated child process with:
 * - IPC message framing.
 * - Scoped config/data/cache context.
 * - No direct access to Molibot Core global objects.
 */

let runtimeModule = null;
let currentConfig = {};
let currentSecrets = {};
let scopedDataDir = "";
let scopedCacheDir = "";

async function handleLoad(payload) {
  const { moduleUrl, config, secrets, dataDir, cacheDir } = payload;
  currentConfig = config || {};
  currentSecrets = secrets || {};
  scopedDataDir = dataDir || "";
  scopedCacheDir = cacheDir || "";

  try {
    runtimeModule = await import(moduleUrl);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error.name || "Error",
        message: error.message || String(error),
        stack: error.stack
      }
    };
  }
}

async function handleInvokeAction(payload) {
  const { action, input } = payload;
  if (!runtimeModule) {
    return { ok: false, error: { message: "Runtime module is not loaded" } };
  }

  const handler = runtimeModule[action];
  if (typeof handler !== "function") {
    return { ok: false, error: { message: `Plugin action handler "${action}" not found` } };
  }

  const context = {
    action,
    config: { ...currentConfig },
    secrets: { ...currentSecrets },
    dataDir: scopedDataDir,
    cacheDir: scopedCacheDir,
    emitProgress(progress) {
      if (process.send) {
        process.send({ type: "progress", progress });
      }
    }
  };

  try {
    const result = await handler(input, context);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: error?.stack
      }
    };
  }
}

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  const { id, type, payload } = message;

  let response;
  if (type === "load") {
    response = await handleLoad(payload);
  } else if (type === "invokeAction") {
    response = await handleInvokeAction(payload);
  } else {
    response = { ok: false, error: { message: `Unknown message type: ${type}` } };
  }

  if (process.send) {
    process.send({ id, ...response });
  }
});
