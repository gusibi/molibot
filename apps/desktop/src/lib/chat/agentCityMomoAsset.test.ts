import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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


test("bundled Momo fallback is the rounded mascot asset with the full clip set", () => {
  const source = JSON.parse(
    readFileSync(new URL("../../../public/agent-community/momo.gltf", import.meta.url), "utf8")
  );
  assert.equal(source.asset?.generator, "Molibot refined Momo mascot asset");
  assert.equal(source.nodes.some((node: { name?: string }) => node.name === "EyeHighlightL"), true);
  assert.equal(source.nodes.some((node: { name?: string }) => node.name === "EyeHighlightR"), true);
  assert.equal(source.materials.length >= 8, true);
  assert.deepEqual(
    source.animations.map((animation: { name: string }) => animation.name),
    ["Idle", "Walk", "Typing", "Thinking", "Scan", "Reading", "Reviewing", "Phone", "Sleep", "Celebrate", "Error", "Wave", "Coffee"]
  );
});


test("production Momo GLB is bundled and structurally valid", () => {
  const bytes = readFileSync(new URL("../../../public/agent-community/momo.glb", import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.ok(bytes.length > 10_000);
});
