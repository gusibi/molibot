import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { config } from "$lib/server/app/env.js";

/**
 * pi keeps its whole user tree under `getAgentDir()`, which falls back to
 * `~/.pi/agent`. This service owns exactly one data directory, so these two
 * variables must be set before anything imports pi — `tools-manager.ts` reads
 * `getBinDir()` at module load, and a downloaded `rg` had already landed in
 * `~/.pi/agent/bin` before this was pinned.
 */
test("pi is pinned inside DATA_DIR so no second home-level state directory appears", async () => {
  assert.equal(process.env.PI_CODING_AGENT_DIR, path.join(config.dataDir, "pi"));

  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const agentDir = getAgentDir();

  assert.equal(agentDir, path.join(config.dataDir, "pi"));
  // The point of the pin: nothing pi owns may resolve under a `.pi` home folder.
  assert.equal(agentDir.includes(`${path.sep}.pi${path.sep}`), false);
  assert.equal(agentDir.endsWith(`${path.sep}.pi`), false);
  assert.equal(agentDir.startsWith(config.dataDir), true);
});

test("downloads stay disabled by default so a missing binary errors instead of fetching one", () => {
  assert.equal(process.env.PI_OFFLINE, "1");
});
