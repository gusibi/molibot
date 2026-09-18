import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMUNITY_KIT_FALLBACK_URL, COMMUNITY_KIT_URL } from "./agentCityCommunityAssets";

test("Agent Community uses a bundled modular GLTF kit", () => {
  assert.equal(COMMUNITY_KIT_URL, "/agent-community/community-kit.glb");
  assert.equal(COMMUNITY_KIT_FALLBACK_URL, "/agent-community/community-kit.gltf");
});


test("bundled community kit contains the Phase 4 architecture and decor components", () => {
  const source = JSON.parse(
    readFileSync(new URL("../../../public/agent-community/community-kit.gltf", import.meta.url), "utf8")
  );
  const names = new Set(source.nodes.map((node: { name?: string }) => node.name));
  for (const name of ["StudioArchitecture", "HQArchitecture", "StudioDecor", "HQDecor", "CommunityHub"]) {
    assert.equal(names.has(name), true, `missing community component ${name}`);
  }
  assert.equal(source.materials.some((material: { name?: string }) => material.name === "GlassTint"), true);
});


test("production Agent Community GLB is bundled and structurally valid", () => {
  const bytes = readFileSync(new URL("../../../public/agent-community/community-kit.glb", import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.ok(bytes.length > 5_000);
});
