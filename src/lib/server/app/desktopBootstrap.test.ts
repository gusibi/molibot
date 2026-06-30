import assert from "node:assert/strict";
import test from "node:test";
import { resolveDesktopProfiles } from "./desktopBootstrap";

test("desktop bootstrap exposes only enabled Web Profile summaries", () => {
  assert.deepEqual(resolveDesktopProfiles({
    channels: {
      web: {
        instances: [
          { id: "personal", name: "Personal", enabled: true, agentId: "agent-1", secret: "hidden" },
          { id: "disabled", name: "Disabled", enabled: false }
        ]
      }
    }
  }), [{ id: "personal", name: "Personal" }]);
});

test("desktop bootstrap falls back only when no Web Profile list exists", () => {
  assert.deepEqual(resolveDesktopProfiles({}), [{ id: "default", name: "Default Web" }]);
  assert.deepEqual(resolveDesktopProfiles({ channels: { web: { instances: [] } } }), []);
});
