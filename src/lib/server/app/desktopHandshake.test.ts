import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopHandshake, DESKTOP_PROTOCOL_VERSION } from "./desktopHandshake.js";

test("desktop handshake reports the stable protocol and service identity", () => {
  assert.deepEqual(
    buildDesktopHandshake({
      MOLIBOT_VERSION: "2.2.4",
      MOLIBOT_SERVICE_OWNER_ID: "instance-1",
      MOLIBOT_DESKTOP_MANAGED: "1"
    }),
    {
      service: "molibot",
      version: "2.2.4",
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      instanceId: "instance-1",
      managedByDesktop: true,
      capabilities: [
        "service-discovery-v1",
        "service-ownership-v1",
        "desktop-token-v1",
        "runtime-health-v1"
      ]
    }
  );
});

test("desktop handshake advertises the deep health probe", () => {
  // The supervisor only enforces readiness against builds that declare this;
  // dropping it silently turns deep health checking off for every install.
  assert.equal(
    buildDesktopHandshake({}).capabilities.includes("runtime-health-v1"),
    true
  );
});

test("desktop handshake does not expose a capability token", () => {
  const handshake = buildDesktopHandshake({ MOLIBOT_DESKTOP_TOKEN: "secret-token" });
  assert.equal("token" in handshake, false);
  assert.equal(JSON.stringify(handshake).includes("secret-token"), false);
});
