import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_CITY_MAX_DISTANCE,
  AGENT_CITY_MIN_DISTANCE,
  agentCityBounds,
  cameraTweenEase,
  clampCameraDistance,
  clampCameraTarget,
  cityHeightFor,
  floorFocusFraming,
  overviewFraming,
  zoomedDistance
} from "./agentCityCamera";

test("clampCameraTarget keeps panning inside the city", () => {
  const bounds = agentCityBounds(4);
  const clamped = clampCameraTarget({ x: 900, y: -50, z: -900 }, bounds);
  assert.equal(clamped.x, bounds.maxX);
  assert.equal(clamped.y, bounds.minY);
  assert.equal(clamped.z, bounds.minZ);
  const inside = { x: 2, y: 3, z: -1 };
  assert.deepEqual(clampCameraTarget(inside, bounds), inside);
});

test("bounds grow vertically with the city so tall stacks stay reachable", () => {
  assert.ok(agentCityBounds(10).maxY > agentCityBounds(1).maxY);
  assert.equal(cityHeightFor(0), 3.5);
  assert.equal(cityHeightFor(4), 10);
});

test("clampCameraDistance honours the zoom envelope", () => {
  assert.equal(clampCameraDistance(0.01), AGENT_CITY_MIN_DISTANCE);
  assert.equal(clampCameraDistance(9999), AGENT_CITY_MAX_DISTANCE);
  assert.equal(clampCameraDistance(20), 20);
});

test("zoomedDistance moves in the asked direction and never escapes the envelope", () => {
  assert.ok(zoomedDistance(30, "in") < 30);
  assert.ok(zoomedDistance(30, "out") > 30);
  assert.equal(zoomedDistance(AGENT_CITY_MIN_DISTANCE, "in"), AGENT_CITY_MIN_DISTANCE);
  assert.equal(zoomedDistance(AGENT_CITY_MAX_DISTANCE, "out"), AGENT_CITY_MAX_DISTANCE);
});

test("overviewFraming pulls back far enough to see a taller city", () => {
  const small = overviewFraming(1);
  const tall = overviewFraming(10);
  assert.ok(tall.distance >= small.distance);
  assert.ok(tall.target.y > small.target.y);
  for (const framing of [small, tall]) {
    assert.ok(framing.distance >= AGENT_CITY_MIN_DISTANCE && framing.distance <= AGENT_CITY_MAX_DISTANCE);
    const actual = Math.hypot(
      framing.position.x - framing.target.x,
      framing.position.y - framing.target.y,
      framing.position.z - framing.target.z
    );
    assert.ok(Math.abs(actual - framing.distance) < 1e-6, "camera was not placed at the framing distance");
  }
});

test("floorFocusFraming lands on the requested floor, not the ground", () => {
  const ground = floorFocusFraming({ x: 5.6, y: 0.35, z: -3.6 }, 0, "agent");
  const third = floorFocusFraming({ x: 5.6, y: 5.35, z: -3.6 }, 2, "agent");
  assert.equal(ground.target.x, 5.6);
  assert.equal(ground.target.z, -3.6);
  assert.ok(third.target.y > ground.target.y + 4, "focusing floor 3 stayed at ground level");
  assert.ok(third.distance < overviewFraming(3).distance, "focus did not zoom in");
});

test("the global headquarters is framed from further back than a single room", () => {
  const room = floorFocusFraming({ x: 0, y: 0, z: 0 }, 0, "agent");
  const headquarters = floorFocusFraming({ x: 0, y: 0, z: -9 }, 0, "global");
  assert.ok(headquarters.distance > room.distance);
});

test("cameraTweenEase is clamped and monotonic", () => {
  assert.equal(cameraTweenEase(-1), 0);
  assert.equal(cameraTweenEase(0), 0);
  assert.equal(cameraTweenEase(1), 1);
  assert.equal(cameraTweenEase(2), 1);
  let previous = 0;
  for (let step = 1; step <= 10; step += 1) {
    const value = cameraTweenEase(step / 10);
    assert.ok(value >= previous, "ease went backwards");
    previous = value;
  }
});
