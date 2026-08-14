import assert from "node:assert/strict";
import test from "node:test";
import {
  MINIAPP_HOST_CAPABILITY_PROTOCOL,
  parseMiniAppHostCapabilityMessage
} from "$lib/shared/miniappHostCapability.js";

test("accepts bounded audio capture requests", () => {
  const parsed = parseMiniAppHostCapabilityMessage({
    protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL,
    version: 1,
    requestId: "request_1",
    action: "audio.start",
    meetingId: "meeting_1",
    trackId: "microphone"
  });
  assert.equal(parsed.ok, true);

  for (const action of ["audio.pause", "audio.resume"] as const) {
    const transition = parseMiniAppHostCapabilityMessage({
      protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL,
      version: 1,
      requestId: `request_${action.replace(".", "_")}`,
      action
    });
    assert.equal(transition.ok, true, `${action} must be a first-class host action`);
  }
});

test("rejects unknown actions, versions, and malformed identifiers", () => {
  for (const message of [
    { protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL, version: 2, requestId: "r", action: "audio.stop" },
    { protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL, version: 1, requestId: "r", action: "filesystem.write" },
    { protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL, version: 1, requestId: "r", action: "audio.start", meetingId: "../x", trackId: "mic" }
  ]) {
    assert.equal(parseMiniAppHostCapabilityMessage(message).ok, false);
  }
});
