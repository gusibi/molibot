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

export interface AgentCitySubagentGroup {
  role: string;
  total: number;
  working: number;
  completed: number;
  error: number;
  instances: DesktopSubagentActivityItem[];
}

export interface AgentCitySubagents {
  /** Complete runtime instances. Never truncate here; rendering decides its own LOD. */
  instances: DesktopSubagentActivityItem[];
  /** Role-level view for repeated workers such as scan ×10. */
  groups: AgentCitySubagentGroup[];
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

// The community is staged from back to front: regular studios form the
// neighbourhood, the primary/default Agent owns the central Momo HQ, and the
// owner dispatch hub sits closest to the camera.
const OWNER_POSITION: AgentCityPoint = { x: 0, y: 0, z: 8.2 };
const GLOBAL_POSITION: AgentCityPoint = { x: 0, y: 0, z: 2.4 };

const COMMUNITY_BUILDING_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-11, -4.8], [-5.6, -6], [5.6, -6], [11, -4.8],
  [-13, 0.5], [-7.8, 1.8], [7.8, 1.8], [13, 0.5],
  [-10.5, 6], [10.5, 6]
];

function buildingPosition(index: number): AgentCityPoint {
  const [x, z] = COMMUNITY_BUILDING_POSITIONS[index] ?? [0, -6];
  return { x, y: 0, z };
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
  const instances = activity?.subagents ?? [];
  const byRole = new Map<string, AgentCitySubagentGroup>();

  for (const subagent of instances) {
    const role = subagent.name.trim() || "subagent";
    let group = byRole.get(role);
    if (!group) {
      group = { role, total: 0, working: 0, completed: 0, error: 0, instances: [] };
      byRole.set(role, group);
    }
    group.total += 1;
    group.instances.push(subagent);
    if (subagent.status === "working") group.working += 1;
    else if (subagent.status === "completed") group.completed += 1;
    else group.error += 1;
  }

  return { instances, groups: [...byRole.values()] };
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

export function agentCityFloors(projection: AgentCityProjection): AgentCityFloor[] {
  return [projection.globalFloor, ...projection.buildings.flatMap((building) => building.floors)];
}

function startedAtMs(floor: AgentCityFloor): number {
  const value = floor.activity?.startedAt ? Date.parse(floor.activity.startedAt) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Which agent the follow camera should be watching. Deliberately sticky: while
 * the agent it is already following is still working the camera stays put, so a
 * busy city does not make the view hop between rooms every poll. Returns null
 * when nothing is working, which means "stay where you are".
 */
export function selectFollowFloorKey(
  projection: AgentCityProjection,
  currentKey: string | null
): string | null {
  const working = agentCityFloors(projection).filter((floor) => floor.state === "working");
  if (working.length === 0) return null;
  if (currentKey && working.some((floor) => floor.key === currentKey)) return currentKey;
  const [next] = [...working].sort((left, right) => {
    const delta = startedAtMs(right) - startedAtMs(left);
    return delta !== 0 ? delta : left.key.localeCompare(right.key);
  });
  return next.key;
}

export function projectAgentCity(input: AgentCityProjectionInput): AgentCityProjection {
  const globalAgent = input.agents.find((item) => item.id === "default") ?? {
    id: "default",
    name: "Momo",
    description: "",
    enabled: true,
    permissionMode: null,
    modelOverrides: 0,
    modelRouting: { textModelKey: "", sttModelKey: "" }
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
