import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import type { RuntimeSettings } from "$lib/server/settings";
import {
  patchDesktopWebProfile,
  resolveDesktopWebProfiles
} from "./desktopProfiles";

function fixture(): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    agents: [
      { id: "agent-1", name: "Helper Bot", description: "", enabled: true },
      { id: "agent-2", name: "Researcher", description: "", enabled: true }
    ],
    channels: {
      ...defaultRuntimeSettings.channels,
      web: {
        instances: [
          {
            id: "default",
            name: "Default Web",
            enabled: true,
            agentId: "agent-1",
            credentials: { token: "must-not-leak" },
            allowedChatIds: ["123"],
            permissionMode: "auto"
          },
          {
            id: "secondary",
            name: "Secondary",
            enabled: false,
            agentId: "",
            credentials: {},
            allowedChatIds: []
          }
        ]
      }
    }
  };
}

test("resolveDesktopWebProfiles includes disabled profiles and resolves agent names without leaking credentials", () => {
  const profiles = resolveDesktopWebProfiles(fixture());

  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].id, "default");
  assert.equal(profiles[0].enabled, true);
  assert.equal(profiles[0].agentName, "Helper Bot");
  assert.equal(profiles[1].id, "secondary");
  assert.equal(profiles[1].enabled, false);
  assert.equal(profiles[1].agentName, "");

  const serialized = JSON.stringify(profiles);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes("allowedChatIds"), false);
});

test("patchDesktopWebProfile updates only requested display/link fields and preserves credentials", () => {
  const settings = fixture();
  const instances = patchDesktopWebProfile(settings, "secondary", {
    name: "Renamed",
    enabled: true,
    agentId: "agent-2"
  });

  const target = instances.find((instance) => instance.id === "secondary");
  assert.equal(target?.name, "Renamed");
  assert.equal(target?.enabled, true);
  // Untouched fields are preserved.
  assert.equal(target?.agentId, "agent-2");
  assert.deepEqual(target?.credentials, {});
  assert.deepEqual(target?.allowedChatIds, []);

  // The other profile is untouched.
  const def = instances.find((instance) => instance.id === "default");
  assert.equal(def?.name, "Default Web");
  assert.equal(def?.enabled, true);
  assert.equal(def?.agentId, "agent-1");
  assert.equal(def?.credentials.token, "must-not-leak");
});

test("patchDesktopWebProfile rejects an unknown agent id without changing settings", () => {
  const settings = fixture();
  assert.throws(
    () => patchDesktopWebProfile(settings, "default", { agentId: "missing-agent" }),
    /Agent not found: missing-agent/
  );
  assert.equal(settings.channels.web.instances[0].agentId, "agent-1");
  assert.equal(settings.channels.web.instances[0].credentials.token, "must-not-leak");
});

test("patchDesktopWebProfile rejects an unknown profile id", () => {
  assert.throws(
    () => patchDesktopWebProfile(fixture(), "missing", { enabled: false }),
    /Web profile not found: missing/
  );
});

test("patchDesktopWebProfile falls back to the id when name is cleared", () => {
  const instances = patchDesktopWebProfile(fixture(), "default", { name: "   " });
  const target = instances.find((instance) => instance.id === "default");
  assert.equal(target?.name, "default");
});
