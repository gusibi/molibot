import assert from "node:assert/strict";
import test from "node:test";
import {
  MINIAPP_BRIDGE_MAX_PATH_LENGTH,
  MINIAPP_BRIDGE_MAX_TEXT_BYTES,
  MINIAPP_BRIDGE_SUPPORTED_VERSIONS,
  MINIAPP_BRIDGE_VERSION,
  parseMiniAppBridgeMessage
} from "./miniappBridge";

test("parses composer.insert and normalizes the optional mode", () => {
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: "Draft this", mode: "replace" }
  }), { ok: true, value: { action: "composer.insert", text: "Draft this", mode: "replace" } });

  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: "Add this" }
  }), { ok: true, value: { action: "composer.insert", text: "Add this", mode: "append" } });
});

test("rejects unknown protocol fields, actions, versions, and oversized text", () => {
  assert.deepEqual(parseMiniAppBridgeMessage({ protocol: "wrong", version: 1 }), {
    ok: false,
    reason: "invalid_protocol"
  });
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 99,
    action: "composer.insert",
    payload: { text: "hello" }
  }), { ok: false, reason: "unsupported_version" });
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.send",
    payload: { text: "hello" }
  }), { ok: false, reason: "unsupported_action" });
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: "a".repeat(MINIAPP_BRIDGE_MAX_TEXT_BYTES + 1) }
  }), { ok: false, reason: "payload_too_large" });
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: "hello", mode: "send" }
  }), { ok: false, reason: "invalid_payload" });
});

// ------------------------------------------------------------------- v2

test("v1 apps keep working after the bump", () => {
  // Existing installs were scaffolded against v1; bumping the protocol must not
  // require every one of them to be edited.
  assert.equal(MINIAPP_BRIDGE_VERSION, 2);
  assert.deepEqual([...MINIAPP_BRIDGE_SUPPORTED_VERSIONS], [1, 2]);
  assert.equal(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: "still fine" }
  }).ok, true);
});

test("a v1 message cannot reach a v2 action", () => {
  // Frozen action sets are the whole point of the version number: a v1 app
  // asking for a v2 capability is a mistake worth reporting, not a courtesy to
  // extend silently.
  for (const action of ["composer.attach", "chat.openSession"]) {
    assert.deepEqual(parseMiniAppBridgeMessage({
      protocol: "molibot-miniapp",
      version: 1,
      action,
      payload: { path: "exports/a.png", sessionId: "s1" }
    }), { ok: false, reason: "unsupported_action" });
  }
});

test("composer.attach accepts an app-relative path and falls back to the basename", () => {
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 2,
    action: "composer.attach",
    payload: { path: "exports/edited.png", name: "Edited screenshot" }
  }), {
    ok: true,
    value: { action: "composer.attach", path: "exports/edited.png", name: "Edited screenshot" }
  });

  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 2,
    action: "composer.attach",
    payload: { path: "exports/edited.png" }
  }), {
    ok: true,
    value: { action: "composer.attach", path: "exports/edited.png", name: "edited.png" }
  });
});

test("composer.attach rejects anything that is not a plain relative path", () => {
  // Shape-only gate; the host still proves containment. This just means a
  // traversal attempt never reaches a realpath call.
  const rejected = [
    "/etc/passwd",
    "../../secret",
    "exports/../../secret",
    "C:\\Windows\\system32",
    "\\\\server\\share",
    "./relative",
    "",
    "a".repeat(MINIAPP_BRIDGE_MAX_PATH_LENGTH + 1)
  ];
  for (const path of rejected) {
    assert.deepEqual(
      parseMiniAppBridgeMessage({
        protocol: "molibot-miniapp",
        version: 2,
        action: "composer.attach",
        payload: { path }
      }),
      { ok: false, reason: "invalid_payload" },
      `expected ${JSON.stringify(path)} to be rejected`
    );
  }
});

test("composer.attach rejects a non-string path rather than stringifying it", () => {
  // `String({})` is `"[object Object]"`, which is truthy — the exact shape that
  // turned into a real side effect in pitfall #26d.
  for (const path of [{}, 42, null, ["exports/a.png"]]) {
    assert.deepEqual(parseMiniAppBridgeMessage({
      protocol: "molibot-miniapp",
      version: 2,
      action: "composer.attach",
      payload: { path }
    }), { ok: false, reason: "invalid_payload" });
  }
});

test("chat.openSession requires a bounded non-empty id", () => {
  assert.deepEqual(parseMiniAppBridgeMessage({
    protocol: "molibot-miniapp",
    version: 2,
    action: "chat.openSession",
    payload: { sessionId: "  session-42  " }
  }), { ok: true, value: { action: "chat.openSession", sessionId: "session-42" } });

  for (const sessionId of ["", "   ", 42, null, "s".repeat(500)]) {
    assert.deepEqual(parseMiniAppBridgeMessage({
      protocol: "molibot-miniapp",
      version: 2,
      action: "chat.openSession",
      payload: { sessionId }
    }), { ok: false, reason: "invalid_payload" });
  }
});

test("a missing payload object is rejected for every action", () => {
  for (const action of ["composer.insert", "composer.attach", "chat.openSession"]) {
    assert.deepEqual(parseMiniAppBridgeMessage({
      protocol: "molibot-miniapp",
      version: 2,
      action
    }), { ok: false, reason: "invalid_payload" });
  }
});

test("the bridge still has no action that sends or writes anything", () => {
  // A structural guard on the design stance: the bridge carries UI intent only,
  // which is what lets it exist without an approval chain. Adding a sending or
  // mutating action must be a deliberate change to this assertion, not a quiet
  // addition to the parser.
  for (const action of ["composer.send", "chat.sendMessage", "app.write", "tool.invoke"]) {
    assert.deepEqual(parseMiniAppBridgeMessage({
      protocol: "molibot-miniapp",
      version: 2,
      action,
      payload: { text: "x" }
    }), { ok: false, reason: "unsupported_action" });
  }
});
