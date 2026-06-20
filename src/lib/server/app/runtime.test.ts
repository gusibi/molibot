import test from "node:test";
import assert from "node:assert/strict";
import { liveServicesDisabled } from "$lib/server/app/env.js";
import { getRuntime } from "$lib/server/app/runtime.js";

// Regression guard: importing tool/unit modules transitively reaches
// getRuntime() (e.g. the host-bash path reads settings through it). Before the
// fix, getRuntime() booted every channel from the developer's real config,
// starting a Feishu websocket that retries forever ("[ws] Maximum number of
// redirects exceeded") and pinning the node:test process open so it never
// printed its summary or exited.

test("liveServicesDisabled is true under the node:test runner", () => {
  // node --test sets NODE_TEST_CONTEXT; production never does.
  assert.equal(liveServicesDisabled(), true);
});

test("getRuntime does not start live channel managers under tests", () => {
  const runtime = getRuntime();

  let liveChannelCount = 0;
  for (const managers of runtime.channelManagers.values()) {
    liveChannelCount += managers.size;
  }
  assert.equal(liveChannelCount, 0, "no channel managers should be applied in test mode");

  // Runtime is still usable for settings reads (what host-bash needs).
  assert.ok(runtime.getSettings(), "settings should still be available");

  // No keep-alive memory-sync interval, so the process can exit cleanly.
  assert.equal(runtime.memorySyncTimer, null);
});
