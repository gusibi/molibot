import type { DesktopAgentActivityItem, DesktopAgentItem, DesktopSubagentActivityItem } from "@molibot/desktop-contract";

export const AGENT_CITY_BUILDING_COUNT = 10;
export const AGENT_CITY_MAX_AGENTS = 100;

export type AgentCityStatus = "disabled" | "idle" | "working" | "completed" | "error";
export type AgentCityAnimation = "resting" | "working" | "celebrating" | "alert" | "disabled";
export type AgentCityRoutePhase = "outbound" | "returning" | "failed";

export interface AgentCitySlotState {
  slots: Record<string, number>;
  hiddenAgentCount: number;
}

export interface AgentCityPoint {
  x: number;
  y: number;
  z: number;
}

export interface AgentCityRoute {
  phase: AgentCityRoutePhase;
  target: { buildingIndex: number | "global"; floorIndex: number };
  points: AgentCityPoint[];
}

export interface AgentCitySubagents {
  visible: DesktopSubagentActivityItem[];
  overflowCount: number;
}

export interface AgentCityFloor {
  key: string;
  kind: "agent" | "global";
  agent: DesktopAgentItem;
  activity: DesktopAgentActivityItem | null;
  buildingIndex: number | "global";
  floorIndex: number;
  position: AgentCityPoint;
  state: AgentCityStatus;
  animation: AgentCityAnimation;
  route: AgentCityRoute | null;
  subagents: AgentCitySubagents;
}

export interface AgentCityBuilding {
  index: number;
  variant: number;
  position: AgentCityPoint;
  floors: AgentCityFloor[];
}

export interface AgentCityProjection {
  buildings: AgentCityBuilding[];
  globalFloor: AgentCityFloor;
  owner: { kind: "owner"; position: AgentCityPoint; active: boolean };
  hiddenAgentCount: number;
  sceneFloors: number;
  workingCount: number;
  slotState: AgentCitySlotState;
}

export interface AgentCityProjectionInput {
  agents: DesktopAgentItem[];
  activities: DesktopAgentActivityItem[];
  slots: Record<string, number>;
}

const OWNER_POSITION: AgentCityPoint = { x: 0, y: 0, z: 0 };
const GLOBAL_POSITION: AgentCityPoint = { x: 0, y: 0, z: -9 };

function buildingPosition(index: number): AgentCityPoint {
  const row = Math.floor(index / 5);
  const column = index % 5;
  return { x: (column - 2) * 5.6, y: 0, z: row === 0 ? -3.6 : 4.2 };
}

function stateFor(agent: DesktopAgentItem, activity: DesktopAgentActivityItem | undefined): AgentCityStatus {
  if (!agent.enabled) return "disabled";
  return activity?.status ?? "idle";
}

function animationFor(state: AgentCityStatus): AgentCityAnimation {
  if (state === "working") return "working";
  if (state === "completed") return "celebrating";
  if (state === "error") return "alert";
  if (state === "disabled") return "disabled";
  return "resting";
}

function routeFor(
  activity: DesktopAgentActivityItem | undefined,
  buildingIndex: number | "global",
  floorIndex: number,
  position: AgentCityPoint
): AgentCityRoute | null {
  if (!activity) return null;
  const phase: AgentCityRoutePhase = activity.status === "working" ? "outbound" : activity.status === "completed" ? "returning" : "failed";
  return {
    phase,
    target: { buildingIndex, floorIndex },
    points: [
      OWNER_POSITION,
      { x: position.x, y: 0.05, z: OWNER_POSITION.z },
      { x: position.x, y: 0.05, z: position.z },
      { x: position.x, y: position.y, z: position.z }
    ]
  };
}

function subagentsFor(activity: DesktopAgentActivityItem | undefined): AgentCitySubagents {
  const subagents = activity?.subagents ?? [];
  return { visible: subagents.slice(0, 3), overflowCount: Math.max(0, subagents.length - 3) };
}

function makeFloor(
  agent: DesktopAgentItem,
  activity: DesktopAgentActivityItem | undefined,
  buildingIndex: number | "global",
  floorIndex: number,
  position: AgentCityPoint
): AgentCityFloor {
  const state = stateFor(agent, activity);
  return {
    key: buildingIndex === "global" ? "global" : `slot-${floorIndex * AGENT_CITY_BUILDING_COUNT + buildingIndex}`,
    kind: buildingIndex === "global" ? "global" : "agent",
    agent,
    activity: activity ?? null,
    buildingIndex,
    floorIndex,
    position,
    state,
    animation: animationFor(state),
    route: routeFor(activity, buildingIndex, floorIndex, position),
    subagents: subagentsFor(activity)
  };
}

export function reconcileAgentCitySlots(agentIds: string[], previous: Record<string, number>): AgentCitySlotState {
  const activeIds = [...new Set(agentIds.filter((id) => id && id !== "default"))];
  const activeSet = new Set(activeIds);
  const slots: Record<string, number> = {};
  const used = new Set<number>();

  for (const [agentId, slot] of Object.entries(previous)) {
    if (!activeSet.has(agentId) || !Number.isInteger(slot) || slot < 0 || slot >= AGENT_CITY_MAX_AGENTS || used.has(slot)) continue;
    slots[agentId] = slot;
    used.add(slot);
  }

  let nextSlot = 0;
  for (const agentId of activeIds) {
    if (slots[agentId] !== undefined) continue;
    while (used.has(nextSlot) && nextSlot < AGENT_CITY_MAX_AGENTS) nextSlot += 1;
    if (nextSlot >= AGENT_CITY_MAX_AGENTS) continue;
    slots[agentId] = nextSlot;
    used.add(nextSlot);
  }

  return { slots, hiddenAgentCount: Math.max(0, activeIds.length - AGENT_CITY_MAX_AGENTS) };
}

export function projectAgentCity(input: AgentCityProjectionInput): AgentCityProjection {
  const globalAgent = input.agents.find((item) => item.id === "default") ?? {
    id: "default",
    name: "Global",
    description: "",
    enabled: true,
    sandboxEnabled: null,
    modelOverrides: 0,
    modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" }
  } satisfies DesktopAgentItem;
  const regularAgents = input.agents.filter((item) => item.id !== "default");
  const slotState = reconcileAgentCitySlots(regularAgents.map((item) => item.id), input.slots);
  const activityByAgent = new Map(input.activities.map((item) => [item.agentId, item]));
  const buildings: AgentCityBuilding[] = Array.from({ length: AGENT_CITY_BUILDING_COUNT }, (_, index) => ({
    index,
    variant: index % 4,
    position: buildingPosition(index),
    floors: []
  }));

  for (const agent of regularAgents) {
    const slot = slotState.slots[agent.id];
    if (slot === undefined) continue;
    const buildingIndex = slot % AGENT_CITY_BUILDING_COUNT;
    const floorIndex = Math.floor(slot / AGENT_CITY_BUILDING_COUNT);
    const building = buildings[buildingIndex];
    const position = { x: building.position.x, y: floorIndex * 2.5 + 0.35, z: building.position.z };
    building.floors.push(makeFloor(agent, activityByAgent.get(agent.id), buildingIndex, floorIndex, position));
  }
  for (const building of buildings) building.floors.sort((left, right) => left.floorIndex - right.floorIndex);

  const globalFloor = makeFloor(globalAgent, activityByAgent.get("default"), "global", 0, GLOBAL_POSITION);
  const visibleFloorCount = buildings.reduce((total, building) => total + building.floors.length, 0);
  const sceneFloors = visibleFloorCount === 0 ? 1 : Math.max(1, ...buildings.flatMap((building) => building.floors.map((floor) => floor.floorIndex + 1)));
  const workingCount = [globalFloor, ...buildings.flatMap((building) => building.floors)].filter((floor) => floor.state === "working").length;

  return {
    buildings,
    globalFloor,
    owner: { kind: "owner", position: OWNER_POSITION, active: workingCount > 0 },
    hiddenAgentCount: slotState.hiddenAgentCount,
    sceneFloors,
    workingCount,
    slotState
  };
}
