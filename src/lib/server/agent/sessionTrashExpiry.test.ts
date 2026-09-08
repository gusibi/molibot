import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { ensureOwnerSessionTrashExpiryEvent } from "$lib/server/agent/taskScheduler.js";

test("trash-expiry watched event is always enabled with the runtime dispatcher kind", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "molibot-trash-expiry-events-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const written = ensureOwnerSessionTrashExpiryEvent(dir, {
    ...defaultRuntimeSettings,
    sessionAutoArchive: { enabled: false, inactiveDays: 30, bots: {} }
  });
  assert.ok(written);
  assert.ok(existsSync(written as string));
  const event = JSON.parse(readFileSync(written as string, "utf8")) as {
    enabled?: boolean;
    execution?: string;
    schedule?: string;
    timezone?: string;
    internal?: { kind?: string };
    managed?: { by?: string; scope?: string; kind?: string };
  };
  // No opt-in switch governs trash expiry: the fixed recovery deadline shown
  // at deletion time does, so the event stays enabled either way.
  assert.equal(event.enabled, true);
  assert.equal(event.execution, "internal");
  assert.equal(event.internal?.kind, "session-trash-expiry");
  assert.deepEqual(event.managed, {
    by: "molibot",
    scope: "owner",
    kind: "session-trash-expiry",
    ownerId: "owner"
  });
  assert.ok(event.schedule && event.schedule.trim().length > 0);
  assert.equal(event.timezone, defaultRuntimeSettings.timezone);

  const again = ensureOwnerSessionTrashExpiryEvent(dir, defaultRuntimeSettings);
  assert.equal(again, written);
});
