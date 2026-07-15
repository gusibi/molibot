import assert from "node:assert/strict";
import test from "node:test";
import { agentCityViewportHeight, selectAgentCityQuality } from "./agentCityScene";

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
