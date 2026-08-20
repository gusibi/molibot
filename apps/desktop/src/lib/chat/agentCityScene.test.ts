import assert from "node:assert/strict";
import test from "node:test";
import { agentCityFloorSignature, agentCityViewportHeight, selectAgentCityQuality } from "./agentCityScene";
import type { AgentCityFloor } from "./agentCityProjection";

test("selectAgentCityQuality chooses fallback without WebGL2", () => {
  assert.equal(selectAgentCityQuality({ webgl2: false, deviceMemory: 8, hardwareConcurrency: 8, devicePixelRatio: 2 }), "fallback");
});

test("selectAgentCityQuality lowers quality on constrained devices", () => {
  assert.equal(selectAgentCityQuality({ webgl2: true, deviceMemory: 2, hardwareConcurrency: 4, devicePixelRatio: 2 }), "low");
  assert.equal(selectAgentCityQuality({ webgl2: true, deviceMemory: 8, hardwareConcurrency: 2, devicePixelRatio: 2 }), "low");
  assert.equal(selectAgentCityQuality({ webgl2: true, deviceMemory: 8, hardwareConcurrency: 8, devicePixelRatio: 3 }), "full");
});

test("agentCityViewportHeight grows for taller cities instead of shrinking floors", () => {
  assert.equal(agentCityViewportHeight(1, 900), 560);
  assert.equal(agentCityViewportHeight(4, 900), 720);
  assert.equal(agentCityViewportHeight(10, 900), 1200);
  assert.equal(agentCityViewportHeight(10, 520), 880);
});

function floorFixture(overrides: Partial<AgentCityFloor> = {}): AgentCityFloor {
  return {
    key: "slot-3",
    kind: "agent",
    agent: {
      id: "agent-3",
      name: "Scout",
      description: "",
      enabled: true,
      sandboxEnabled: null,
      modelOverrides: 0,
      modelRouting: { textModelKey: "", sttModelKey: "" }
    },
    activity: null,
    buildingIndex: 3,
    floorIndex: 0,
    position: { x: 5.6, y: 0.35, z: -3.6 },
    state: "idle",
    animation: "resting",
    route: null,
    subagents: { visible: [], overflowCount: 0 },
    ...overrides
  };
}

test("floor signature ignores status so the activity poll cannot rebuild a busy room", () => {
  // A rebuild would restart every animation and throw away the camera focus.
  const base = agentCityFloorSignature(floorFixture(), 2, "light");
  for (const state of ["working", "completed", "error", "disabled"] as const) {
    const animation = state === "working" ? "working" : "resting";
    assert.equal(
      agentCityFloorSignature(floorFixture({ state, animation }), 2, "light"),
      base,
      `status ${state} was treated as a geometry change`
    );
  }
});

test("floor signature changes when the room geometry actually differs", () => {
  const base = agentCityFloorSignature(floorFixture(), 2, "light");
  const variations: AgentCityFloor[] = [
    floorFixture({ floorIndex: 1 }),
    floorFixture({ buildingIndex: 4 }),
    floorFixture({ kind: "global" }),
    floorFixture({
      subagents: {
        visible: [{ name: "helper", status: "working" } as AgentCityFloor["subagents"]["visible"][number]],
        overflowCount: 0
      }
    }),
    floorFixture({ subagents: { visible: [], overflowCount: 2 } }),
    floorFixture({ route: { phase: "outbound", target: { buildingIndex: 3, floorIndex: 0 }, points: [] } })
  ];
  for (const floor of variations) {
    assert.notEqual(agentCityFloorSignature(floor, 2, "light"), base);
  }
  assert.notEqual(agentCityFloorSignature(floorFixture(), 3, "light"), base);
  // Palettes are baked into the room meshes, so a theme flip must rebuild.
  assert.notEqual(agentCityFloorSignature(floorFixture(), 2, "dark"), base);
});

test("a route only needs rebuilding when it appears or disappears, not when its phase flips", () => {
  const outbound = floorFixture({
    route: { phase: "outbound", target: { buildingIndex: 3, floorIndex: 0 }, points: [] }
  });
  const returning = floorFixture({
    route: { phase: "returning", target: { buildingIndex: 3, floorIndex: 0 }, points: [] }
  });
  assert.equal(
    agentCityFloorSignature(outbound, 2, "light"),
    agentCityFloorSignature(returning, 2, "light")
  );
});
