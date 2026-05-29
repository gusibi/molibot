import assert from "node:assert/strict";
import test from "node:test";
import { TELEGRAM_SHARED_COMMANDS } from "$lib/server/channels/telegram/commands.js";

test("telegram registers shared live-control, queue, and host-tool commands", () => {
  const registered = new Set<string>(TELEGRAM_SHARED_COMMANDS);
  for (const command of ["steer", "followup", "follow_up", "queue", "hosttools", "host-tools"]) {
    assert.ok(
      registered.has(command),
      `expected /${command} to be handled before busy-message enqueue`
    );
  }
});
