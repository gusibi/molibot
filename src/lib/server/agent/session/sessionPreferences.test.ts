import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";

/**
 * Session preference round-trips (CLAUDE.md pitfall 11).
 *
 * The rule is save → *fresh store* → load, against a temporary directory: a
 * getter that reads back from the same in-process instance proves nothing about
 * what survives a restart, and narrow serialization is exactly how a field
 * silently resets. `permissionModeOverride` is the one session-scoped
 * execution control: the sandbox has no session override, because whether it
 * participates follows the effective mode.
 */

function withStore(fn: (store: MomRuntimeStore, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "molibot-session-prefs-"));
  try {
    fn(new MomRuntimeStore(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CHAT = "web:personal:prefs";

test("permission mode survives a fresh store", () => {
  withStore((store, dir) => {
    const sessionId = store.getActiveSession(CHAT);
    store.setSessionPermissionModeOverride(CHAT, sessionId, "manual");

    const reopened = new MomRuntimeStore(dir);
    assert.equal(reopened.getSessionPermissionModeOverride(CHAT, sessionId), "manual");
  });
});

test("clearing the mode falls back to null, not to a mode", () => {
  withStore((store, dir) => {
    const sessionId = store.getActiveSession(CHAT);
    store.setSessionPermissionModeOverride(CHAT, sessionId, "plan");
    store.setSessionPermissionModeOverride(CHAT, sessionId, null);

    const reopened = new MomRuntimeStore(dir);
    assert.equal(
      reopened.getSessionPermissionModeOverride(CHAT, sessionId),
      null,
      "unset must mean 'follow the default', never a pinned mode"
    );
  });
});

test("an unknown persisted mode reads as unset", () => {
  // A session written by a newer build must not make this one gate on a mode it
  // cannot evaluate; falling through to the default is the safe reading.
  withStore((store, dir) => {
    const sessionId = store.getActiveSession(CHAT);
    store.setSessionPermissionModeOverride(CHAT, sessionId, "auto");
    store.setSessionPermissionModeOverride(CHAT, sessionId, "yolo" as never);

    const reopened = new MomRuntimeStore(dir);
    assert.equal(reopened.getSessionPermissionModeOverride(CHAT, sessionId), null);
  });
});

test("every valid mode round-trips", () => {
  for (const mode of ["plan", "manual", "accept_edits", "auto"] as const) {
    withStore((store, dir) => {
      const sessionId = store.getActiveSession(CHAT);
      store.setSessionPermissionModeOverride(CHAT, sessionId, mode);
      assert.equal(new MomRuntimeStore(dir).getSessionPermissionModeOverride(CHAT, sessionId), mode, mode);
    });
  }
});

test("the mode coexists with sibling preferences without overwriting them", () => {
  // They share one `preferences` object, so a setter that replaced the
  // container instead of merging would drop the other entries. This is the
  // narrow-serialization failure pitfall 11 describes, in its smallest form.
  withStore((store, dir) => {
    const sessionId = store.getActiveSession(CHAT);
    store.setSessionRunLogNoticeOverride(CHAT, sessionId, true);
    store.setSessionPermissionModeOverride(CHAT, sessionId, "manual");

    const reopened = new MomRuntimeStore(dir);
    assert.equal(reopened.getSessionRunLogNoticeOverride(CHAT, sessionId), true, "runlog notice survived the mode write");
    assert.equal(reopened.getSessionPermissionModeOverride(CHAT, sessionId), "manual");

    // ...and in the other order.
    reopened.setSessionRunLogNoticeOverride(CHAT, sessionId, null);
    const again = new MomRuntimeStore(dir);
    assert.equal(again.getSessionPermissionModeOverride(CHAT, sessionId), "manual", "the mode survived the sibling write");
    assert.equal(again.getSessionRunLogNoticeOverride(CHAT, sessionId), null);
  });
});
