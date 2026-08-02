import type { AgentCityPoint } from "./agentCityProjection";

export const AGENT_CITY_FLOOR_HEIGHT = 2.5;
export const AGENT_CITY_MIN_DISTANCE = 5.5;
export const AGENT_CITY_MAX_DISTANCE = 82;
/** Distance the camera settles at when a single floor is focused. */
export const AGENT_CITY_FOCUS_DISTANCE = 9.5;
export const AGENT_CITY_GLOBAL_FOCUS_DISTANCE = 13.5;
/** Closer than this, props and subagent desks are worth drawing. */
export const AGENT_CITY_DETAIL_DISTANCE = 30;
export const AGENT_CITY_ZOOM_STEP = 1.35;

export interface AgentCityBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface AgentCityFraming {
  target: AgentCityPoint;
  position: AgentCityPoint;
  distance: number;
}

const OVERVIEW_DIRECTION: AgentCityPoint = { x: 0.72, y: 0.62, z: 0.9 };
const FOCUS_DIRECTION: AgentCityPoint = { x: 0.38, y: 0.34, z: 1 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize(point: AgentCityPoint): AgentCityPoint {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

function offset(target: AgentCityPoint, direction: AgentCityPoint, distance: number): AgentCityPoint {
  const unit = normalize(direction);
  return {
    x: target.x + unit.x * distance,
    y: target.y + unit.y * distance,
    z: target.z + unit.z * distance
  };
}

export function cityHeightFor(sceneFloors: number): number {
  return Math.max(3.5, Math.max(1, sceneFloors) * AGENT_CITY_FLOOR_HEIGHT);
}

/**
 * The box the orbit target may roam in. Keeps panning inside the city instead
 * of letting the user drift into empty space with nothing on screen.
 */
export function agentCityBounds(sceneFloors: number): AgentCityBounds {
  const height = cityHeightFor(sceneFloors);
  return { minX: -15, maxX: 15, minY: 0, maxY: height + 3, minZ: -12, maxZ: 8 };
}

export function clampCameraTarget(target: AgentCityPoint, bounds: AgentCityBounds): AgentCityPoint {
  return {
    x: clamp(target.x, bounds.minX, bounds.maxX),
    y: clamp(target.y, bounds.minY, bounds.maxY),
    z: clamp(target.z, bounds.minZ, bounds.maxZ)
  };
}

export function clampCameraDistance(distance: number): number {
  return clamp(distance, AGENT_CITY_MIN_DISTANCE, AGENT_CITY_MAX_DISTANCE);
}

/** The default "whole city" shot, also used by the Reset view control. */
export function overviewFraming(sceneFloors: number): AgentCityFraming {
  const height = cityHeightFor(sceneFloors);
  const target: AgentCityPoint = { x: 0, y: height * 0.42, z: -0.6 };
  const distance = clampCameraDistance(36 + height * 1.35);
  return { target, position: offset(target, OVERVIEW_DIRECTION, distance), distance };
}

/** A close-up on one dollhouse room, low enough to read what the pug is doing. */
export function floorFocusFraming(
  position: AgentCityPoint,
  floorIndex: number,
  kind: "agent" | "global"
): AgentCityFraming {
  const distance = kind === "global" ? AGENT_CITY_GLOBAL_FOCUS_DISTANCE : AGENT_CITY_FOCUS_DISTANCE;
  const target: AgentCityPoint = {
    x: position.x,
    y: floorIndex * AGENT_CITY_FLOOR_HEIGHT + (kind === "global" ? 1.4 : 1.02),
    z: position.z
  };
  return { target, position: offset(target, FOCUS_DIRECTION, distance), distance };
}

export function zoomedDistance(distance: number, direction: "in" | "out"): number {
  return clampCameraDistance(direction === "in" ? distance / AGENT_CITY_ZOOM_STEP : distance * AGENT_CITY_ZOOM_STEP);
}

/** Ease-out cubic — used for the fly-to-floor tween. */
export function cameraTweenEase(progress: number): number {
  const clamped = clamp(progress, 0, 1);
  return 1 - (1 - clamped) ** 3;
}
