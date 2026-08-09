import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * A disposable Molibot service for one eval run.
 *
 * Three rules, all learned the hard way (prd.md §3.41, CLAUDE.md pitfall 30):
 *
 *  1. The service is started through `scripts/start-server.mjs`, never
 *     `node build/index.js`. The launcher is what acquires the lease, installs
 *     the signal handlers and forces the exit; skipping it is how five orphan
 *     processes polled a production bot for twelve days.
 *  2. `DATA_DIR` is set in the OS environment, so `createDataDirScope` drops the
 *     repository `.env`'s `DB_DIR` and every path really does land in the
 *     throwaway directory. The service refuses to boot otherwise.
 *  3. Seeding copies the owner's provider configuration, which necessarily
 *     includes channel credentials — so `MOLIBOT_DISABLE_EXTERNAL_CHANNELS=1`
 *     is not optional and is asserted, not assumed.
 */

/** Copied from the seed data directory: everything needed to reach a model. */
const SEED_ENTRIES = [
  "settings.json",
  "auth.json",
  path.join("db", "settings.sqlite"),
  path.join("db", "settings.sqlite-wal"),
  path.join("db", "settings.sqlite-shm")
];

export function createScratchDataDir({ seedFrom } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-eval-"));
  mkdirSync(path.join(dataDir, "db"), { recursive: true });

  if (seedFrom) {
    if (!existsSync(seedFrom)) throw new Error(`seed data directory not found: ${seedFrom}`);
    for (const relative of SEED_ENTRIES) {
      const source = path.join(seedFrom, relative);
      if (!existsSync(source)) continue;
      const target = path.join(dataDir, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true });
    }
  }

  // An empty data-dir `.env` shadows nothing but documents the isolation for
  // anyone who opens the directory while a run is stuck.
  writeFileSync(
    path.join(dataDir, ".env"),
    "# Throwaway eval data directory. Deleted when the run ends.\n",
    "utf8"
  );
  return dataDir;
}

async function waitForDeepHealth(endpoint, { timeoutMs, isAlive }) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "no response";
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error(`service exited before becoming ready (${lastDetail})`);
    try {
      // The deep probe builds the runtime. `/health` and the handshake are
      // static literals and answer 200 from a process whose getRuntime()
      // throws on every request (CLAUDE.md pitfall 21a).
      const response = await fetch(`${endpoint}/api/desktop/health?deep=1`);
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok !== false) return body;
      lastDetail = `HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`;
    } catch (error) {
      lastDetail = error?.message ?? String(error);
    }
    await delay(500);
  }
  throw new Error(`service did not become ready within ${timeoutMs}ms (${lastDetail})`);
}

export async function startScratchService({
  repoRoot,
  dataDir,
  port,
  readyTimeoutMs = 90_000,
  onLog = () => {}
}) {
  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(port),
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    // Rule 3. Asserted below rather than trusted.
    MOLIBOT_DISABLE_EXTERNAL_CHANNELS: "1",
    // The launcher publishes its own owner id; make sure we never inherit one
    // from the shell that started the eval.
    MOLIBOT_SERVICE_OWNER_ID: ""
  };
  delete env.MOLIBOT_SERVICE_OWNER_ID;
  if (env.MOLIBOT_DISABLE_EXTERNAL_CHANNELS !== "1") {
    throw new Error("refusing to start an eval service with external channels enabled");
  }

  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "start-server.mjs")], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  // "fetch failed" is what a caller sees when the service dies mid-request, and
  // on its own it is indistinguishable from a network hiccup. The harness has
  // no supervisor to notice the death, so it has to report the exit itself.
  const exitInfo = () => exited;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => onLog(chunk));
  }

  const endpoint = `http://127.0.0.1:${port}`;
  try {
    await waitForDeepHealth(endpoint, {
      timeoutMs: readyTimeoutMs,
      isAlive: () => exited === null
    });
  } catch (error) {
    await stopScratchService({ child });
    throw error;
  }

  return { child, endpoint, dataDir, exitInfo };
}

export async function stopScratchService({ child }, { timeoutMs = 15_000 } = {}) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && Date.now() < deadline) {
    await delay(100);
  }
  if (child.exitCode === null) child.kill("SIGKILL");
}

export function removeScratchDataDir(dataDir, { keep = false } = {}) {
  if (keep || !dataDir) return;
  rmSync(dataDir, { recursive: true, force: true });
}

/** A port nobody else is listening on, chosen just before the service starts. */
export async function findFreePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
