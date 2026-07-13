import assert from "node:assert/strict";
import test from "node:test";
import { resolveDesktopProfiles } from "./desktopBootstrap";

test("desktop bootstrap exposes only enabled Web Profile summaries", () => {
  assert.deepEqual(resolveDesktopProfiles({
    agents: [{ id: "agent-1", name: "Research Agent" }],
    channels: {
      web: {
        instances: [
          { id: "personal", name: "Personal", enabled: true, agentId: "agent-1", secret: "hidden" },
          { id: "disabled", name: "Disabled", enabled: false }
        ]
      }
    }
  }), [{ id: "personal", name: "Personal", agentId: "agent-1", agentName: "Research Agent" }]);
});

test("desktop bootstrap falls back only when no Web Profile list exists", () => {
  assert.deepEqual(resolveDesktopProfiles({}), [{ id: "default", name: "Default Web" }]);
  assert.deepEqual(resolveDesktopProfiles({ channels: { web: { instances: [] } } }), []);
});
