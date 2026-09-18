import assert from "node:assert/strict";
import test from "node:test";
import { MOMO_GLTF_URL, MOMO_PROTOTYPE_URL, momoAnimationName } from "./agentCityMomoAsset";

test("Momo loads the production GLB first and keeps a text GLTF fallback", () => {
  assert.equal(MOMO_GLTF_URL, "/agent-community/momo.glb");
  assert.equal(MOMO_PROTOTYPE_URL, "/agent-community/momo.gltf");
});

test("momo asset clip mapping preserves the Agent behavior contract", () => {
  assert.equal(momoAnimationName("pace"), "Walk");
  assert.equal(momoAnimationName("typing"), "Typing");
  assert.equal(momoAnimationName("writing"), "Typing");
  assert.equal(momoAnimationName("thinking"), "Thinking");
  assert.equal(momoAnimationName("scan"), "Scan");
  assert.equal(momoAnimationName("reviewing"), "Reviewing");
  assert.equal(momoAnimationName("phone"), "Phone");
  assert.equal(momoAnimationName("sleep"), "Sleep");
  assert.equal(momoAnimationName("cheer"), "Celebrate");
  assert.equal(momoAnimationName("panic"), "Error");
  assert.equal(momoAnimationName("greet"), "Wave");
  assert.equal(momoAnimationName("coffee"), "Coffee");
  assert.equal(momoAnimationName("lookAround"), "Idle");
});
