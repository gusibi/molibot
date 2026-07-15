import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopAgentActivityItem, DesktopAgentItem } from "@molibot/desktop-contract";
import { projectAgentCity, reconcileAgentCitySlots } from "./agentCityProjection";

function agent(id: string, enabled = true): DesktopAgentItem {
  return {
    id,
    name: `Agent ${id}`,
    description: `Description ${id}`,
    enabled,
    sandboxEnabled: null,
    modelOverrides: 0,
    modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" }
  };
}

function activity(agentId: string, status: DesktopAgentActivityItem["status"] = "working"): DesktopAgentActivityItem {
  return {
    agentId,
    status,
    runId: `run-${agentId}`,
    channel: "web",
    botId: `bot-${agentId}`,
    botName: `Bot ${agentId}`,
    taskPreview: "Inspect the repository without inventing tool actions",
    startedAt: "2026-07-14T12:00:00.000Z",
    finishedAt: status === "working" ? "" : "2026-07-14T12:00:10.000Z",
    subagents: []
  };
}

function regularAgents(count: number): DesktopAgentItem[] {
  return Array.from({ length: count }, (_, index) => agent(`agent-${index + 1}`));
}

test("reconcileAgentCitySlots preserves active assignments and fills the lowest free slot", () => {
  const result = reconcileAgentCitySlots(["agent-b", "agent-c", "agent-d"], {
    "agent-a": 0,
    "agent-b": 4,
    "agent-c": 9
  });

  assert.deepEqual(result.slots, { "agent-b": 4, "agent-c": 9, "agent-d": 0 });
  assert.equal(result.hiddenAgentCount, 0);
});

test("projectAgentCity keeps the city deterministic at zero and one regular Agent", () => {
  const empty = projectAgentCity({ agents: [], activities: [], slots: {} });
  assert.equal(empty.buildings.length, 10);
  assert.equal(empty.buildings.flatMap((building) => building.floors).length, 0);
  assert.equal(empty.globalFloor.agent.id, "default");
  assert.equal(empty.sceneFloors, 1);

  const single = projectAgentCity({ agents: [agent("agent-1")], activities: [], slots: {} });
  assert.equal(single.buildings[0]?.floors[0]?.agent.id, "agent-1");
  assert.equal(single.buildings[0]?.floors[0]?.floorIndex, 0);
  assert.equal(single.buildings.slice(1).flatMap((building) => building.floors).length, 0);
  assert.deepEqual(single.slotState.slots, { "agent-1": 0 });
});

test("projectAgentCity keeps Global and owner separate from regular Agent capacity", () => {
  const projection = projectAgentCity({
    agents: [agent("default"), ...regularAgents(101)],
    activities: [],
    slots: {}
  });

  assert.equal(projection.globalFloor.agent.id, "default");
  assert.equal(projection.owner.kind, "owner");
  assert.equal(projection.buildings.length, 10);
  assert.equal(projection.buildings.flatMap((building) => building.floors).length, 100);
  assert.equal(projection.hiddenAgentCount, 1);
  assert.equal(projection.sceneFloors, 10);
});

test("projectAgentCity adds floors round-robin at 11, 40, 41, and 100 Agents", () => {
  for (const [count, expectedFloors, expectedBuildingOne, expectedBuildingTen] of [
    [10, 1, 1, 1],
    [11, 2, 2, 1],
    [40, 4, 4, 4],
    [41, 5, 5, 4],
    [100, 10, 10, 10]
  ] as const) {
    const projection = projectAgentCity({ agents: regularAgents(count), activities: [], slots: {} });
    assert.equal(projection.sceneFloors, expectedFloors, `scene floors for ${count}`);
    assert.equal(projection.buildings[0]?.floors.length, expectedBuildingOne, `building 1 for ${count}`);
    assert.equal(projection.buildings[9]?.floors.length, expectedBuildingTen, `building 10 for ${count}`);
  }

  const eleven = projectAgentCity({ agents: regularAgents(11), activities: [], slots: {} });
  const eleventh = eleven.buildings[0]?.floors[1];
  assert.equal(eleventh?.agent.id, "agent-11");
  assert.equal(eleventh?.buildingIndex, 0);
  assert.equal(eleventh?.floorIndex, 1);
});

test("projectAgentCity emits exclusive states and an exact owner-to-floor route", () => {
  const agents = [agent("default"), agent("idle"), agent("disabled", false), agent("done"), agent("failed")];
  const activities = [activity("default"), activity("done", "completed"), activity("failed", "error")];
  const projection = projectAgentCity({ agents, activities, slots: { idle: 0, disabled: 10, done: 20, failed: 30 } });

  assert.equal(projection.globalFloor.state, "working");
  assert.equal(projection.buildings[0]?.floors[0]?.state, "idle");
  assert.equal(projection.buildings[0]?.floors[1]?.state, "disabled");
  assert.equal(projection.buildings[0]?.floors[2]?.state, "completed");
  assert.equal(projection.buildings[0]?.floors[3]?.state, "error");

  const route = projection.buildings[0]?.floors[2]?.route;
  assert.deepEqual(route?.target, { buildingIndex: 0, floorIndex: 2 });
  assert.equal(route?.phase, "returning");
});

test("projectAgentCity caps visible Sub-agents at three and never invents tool intent", () => {
  const parentActivity = activity("agent-1");
  parentActivity.taskPreview = "Search, code, approve, and generate an image";
  parentActivity.subagents = Array.from({ length: 5 }, (_, index) => ({
    id: `sub-${index}`,
    name: `Sub ${index}`,
    status: index === 0 ? "completed" : "working",
    startedAt: "2026-07-14T12:00:00.000Z",
    finishedAt: index === 0 ? "2026-07-14T12:00:05.000Z" : ""
  }));

  const projection = projectAgentCity({ agents: [agent("agent-1")], activities: [parentActivity], slots: {} });
  const floor = projection.buildings[0]?.floors[0];
  assert.equal(floor?.subagents.visible.length, 3);
  assert.equal(floor?.subagents.overflowCount, 2);
  assert.equal(floor?.animation, "working");
  assert.equal(floor?.activity?.taskPreview, parentActivity.taskPreview);
  assert.equal("toolAction" in (floor ?? {}), false);
});
