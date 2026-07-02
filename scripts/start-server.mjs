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

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(releaseRoot, ".env") });

const dataDir = resolveDataDir();
dotenv.config({ path: path.join(dataDir, ".env") });

const packageInfo = JSON.parse(readFileSync(path.join(releaseRoot, "package.json"), "utf8"));
process.env.NODE_ENV ||= "production";
process.env.HOST ||= "127.0.0.1";
process.env.PORT ||= "3000";
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
