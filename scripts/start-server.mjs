import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ServiceLeaseConflictError,
  acquireServiceLease,
  resolveDataDir,
  writeServiceState
} from "./runtime/service-lease.mjs";
import { findAvailableServicePort, readConfiguredServicePort } from "./runtime/service-port.mjs";

// Observability modules are loaded dynamically on purpose: they are diagnostics,
// not boot dependencies. A static import made a module missing from the release
// bundle a fatal ERR_MODULE_NOT_FOUND before any handler could report it, and the
// supervisor then restart-looped a service that could never start (issue #30).
async function loadOptionalRuntimeModule(specifier, exportName) {
  try {
    const module = await import(specifier);
    return module[exportName];
  } catch (error) {
    console.error(`[molibot] optional runtime module unavailable (${specifier}): ${error?.message ?? error}`);
    return null;
  }
}

const installFileLogger = await loadOptionalRuntimeModule("./runtime/file-logger.mjs", "installFileLogger");
const installCrashHandlers = await loadOptionalRuntimeModule("./runtime/crash-report.mjs", "installCrashHandlers");

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(releaseRoot, ".env") });

const dataDir = resolveDataDir();
dotenv.config({ path: path.join(dataDir, ".env") });

// The desktop build already captures the sidecar's stdout into the Rust
// supervisor's rolling log, so only the standalone Web/Node service needs its
// own rotating file sink. 5 MB per file, 5 backups.
if (process.env.MOLIBOT_DESKTOP_MANAGED !== "1" && installFileLogger) {
  try {
    installFileLogger({ dataDir });
  } catch (error) {
    console.error(`[molibot] failed to start file logger: ${error?.message ?? error}`);
  }
}

const packageInfo = JSON.parse(readFileSync(path.join(releaseRoot, "package.json"), "utf8"));
process.env.NODE_ENV ||= "production";
process.env.HOST ||= "127.0.0.1";
const preferredPort = process.env.PORT || readConfiguredServicePort(dataDir);
process.env.PORT = String(await findAvailableServicePort(preferredPort, process.env.HOST));
process.env.MOLIBOT_VERSION ||= String(packageInfo.version || "0.0.0");

let lease;
try {
  lease = acquireServiceLease({ dataDir });
} catch (error) {
  if (error instanceof ServiceLeaseConflictError) {
    console.error(`[molibot] ${error.message}`);
    process.exit(73);
  }
  throw error;
}

process.env.MOLIBOT_SERVICE_OWNER_ID = lease.ownerId;

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    lease.release();
  } catch {
    // best-effort during shutdown
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  cleanup();
  // SvelteKit's graceful close drains sockets but won't bring the process down;
  // background handles (EventsWatcher timers, sqlite, fs.watch) keep the loop
  // alive, so an orphan would linger after releasing the lock. Force exit.
  const force = setTimeout(() => process.exit(0), 500);
  force.unref?.();
}

// Installed after the lease exists so a crash still releases it: an orphaned
// lock file would make the supervisor's restart fail with a lease conflict,
// turning one crash into a service that never comes back.
installCrashHandlers?.({ dataDir, onCrash: cleanup });

process.once("exit", cleanup);
process.once("sveltekit:shutdown", shutdown);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  writeServiceState(lease, {
    status: "starting",
    endpoint: `http://${process.env.HOST}:${process.env.PORT}`,
    version: process.env.MOLIBOT_VERSION,
    protocolVersion: 1,
    managedByDesktop: process.env.MOLIBOT_DESKTOP_MANAGED === "1"
  });

  const runtime = await import(path.join(releaseRoot, "build/index.js"));
  const httpServer = runtime.server?.server;
  if (httpServer && !httpServer.listening) {
    await new Promise((resolve, reject) => {
      httpServer.once("listening", resolve);
      httpServer.once("error", reject);
    });
  }
  const address = httpServer?.address?.();
  const actualPort = typeof address === "object" && address ? address.port : Number(process.env.PORT);
  const endpoint = `http://${process.env.HOST}:${actualPort}`;
  const bootstrapResponse = await fetch(`${endpoint}/health`);
  if (!bootstrapResponse.ok) {
    throw new Error(`Runtime bootstrap failed: HTTP ${bootstrapResponse.status}`);
  }
  writeServiceState(lease, {
    status: "ready",
    endpoint,
    version: process.env.MOLIBOT_VERSION,
    protocolVersion: 1,
    managedByDesktop: process.env.MOLIBOT_DESKTOP_MANAGED === "1"
  });
  console.log(`[molibot] service ready at ${endpoint}`);
} catch (error) {
  cleanup();
  throw error;
}
