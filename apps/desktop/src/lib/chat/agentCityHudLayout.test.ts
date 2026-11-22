import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCityFloor } from "./agentCityProjection";
import type { AgentCityHudCoords } from "./agentCityScene";
import { clampHoverCardPosition, layoutHudNodes } from "./agentCityHudLayout";

function floorFixture(key: string, overrides: Partial<AgentCityFloor> = {}): AgentCityFloor {
  return {
    key,
    kind: key === "global" ? "global" : "agent",
    agent: {
      id: key,
      name: key,
      description: "",
      enabled: true,
      canExecute: true,
      permissionMode: null,
      modelOverrides: 0,
      modelRouting: { textModelKey: "", sttModelKey: "" }
    },
    activity: null,
    runs: [],
    buildingIndex: key === "global" ? "global" : 0,
    floorIndex: 0,
    position: { x: 0, y: 0, z: 0 },
    state: "idle",
    animation: "resting",
    route: null,
    subagents: { instances: [], groups: [] },
    ...overrides
  };
}

test("layoutHudNodes follows updated camera coordinates directly", () => {
  const floors = [floorFixture("global"), floorFixture("slot-0")];
  const before: AgentCityHudCoords = {
    anchors: {
      global: { x: 400, y: 300, visible: true, depth: 0.4 },
      "slot-0": { x: 620, y: 260, visible: true, depth: 0.5 }
    },
    satellites: {},
    owner: { x: 400, y: 500, visible: true }
  };
  const afterZoom: AgentCityHudCoords = {
    anchors: {
      global: { x: 420, y: 340, visible: true, depth: 0.2 },
      "slot-0": { x: 780, y: 190, visible: true, depth: 0.3 }
    },
    satellites: {},
    owner: { x: 400, y: 500, visible: true }
  };

  const layoutBefore = layoutHudNodes(floors, before, null, null);
  const layoutAfter = layoutHudNodes(floors, afterZoom, null, null);

  assert.equal(layoutBefore.global.x, 400);
  assert.equal(layoutBefore["slot-0"].x, 620);
  assert.equal(layoutAfter.global.x, 420);
  assert.equal(layoutAfter["slot-0"].x, 780);
  assert.notEqual(layoutBefore["slot-0"].y, layoutAfter["slot-0"].y);
});

test("layoutHudNodes separates overlapping badges and prioritizes working/selected agents", () => {
  const floors = [
    floorFixture("idle-a", { state: "idle" }),
    floorFixture("working-b", { state: "working" }),
    floorFixture("idle-c", { state: "idle" })
  ];
  const coords: AgentCityHudCoords = {
    anchors: {
      "idle-a": { x: 300, y: 200, visible: true, depth: 0.4 },
      "working-b": { x: 302, y: 201, visible: true, depth: 0.5 },
      "idle-c": { x: 304, y: 202, visible: true, depth: 0.6 }
    },
    satellites: {},
    owner: { x: 300, y: 400, visible: true }
  };

  const layout = layoutHudNodes(floors, coords, null, null);
  // Working agent keeps its exact anchor and highest z-index.
  assert.equal(layout["working-b"].x, 302);
  assert.equal(layout["working-b"].y, 201);
  assert.ok(layout["working-b"].zIndex > layout["idle-a"].zIndex);
  // Overlapping idle badge shifts away rather than sitting on top of the working badge.
  assert.notEqual(layout["idle-a"].y, layout["working-b"].y);
});

test("clampHoverCardPosition keeps card below anchor when near the top toolbar", () => {
  const topEdge = clampHoverCardPosition({ x: 300, y: 90 }, 800, 600);
  assert.equal(topEdge.placement, "below");
  assert.ok(topEdge.y >= 54);

  const center = clampHoverCardPosition({ x: 400, y: 360 }, 800, 600);
  assert.equal(center.placement, "above");

  const leftEdge = clampHoverCardPosition({ x: 20, y: 360 }, 800, 600);
  assert.ok(leftEdge.x >= 146);
});
