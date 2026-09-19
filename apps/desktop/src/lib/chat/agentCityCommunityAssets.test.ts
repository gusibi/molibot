import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
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

test("community kit derives room materials from the active theme family", async () => {
  const { cloneCommunityComponent } = await import("./agentCityCommunityAssets");
  const root = new THREE.Group();
  const component = new THREE.Group();
  component.name = "StudioArchitecture";
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ name: "WallNeutral", color: 0xffffff })
  );
  component.add(wall);
  root.add(component);

  const cloned = cloneCommunityComponent(
    { scene: root },
    "StudioArchitecture",
    false,
    0xff00ff,
    {
      family: "cyberpunk",
      recipe: "technical",
      accent: "#00f0ff",
      surface: "#101018",
      panel: "#18182a",
      card: "#202038",
      separator: "#56567a",
      online: "#00ff99",
      danger: "#ff3b5c",
      warning: "#ffd166",
      skillAccent: "#a855f7",
      miniappAccent: "#00f0ff"
    }
  );
  assert.ok(cloned);
  const clonedWall = cloned.getObjectByName(wall.name) as THREE.Mesh | undefined
    ?? cloned.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  assert.ok(clonedWall instanceof THREE.Mesh);
  const material = clonedWall.material as THREE.MeshStandardMaterial;
  assert.notEqual(material.color.getHex(), 0xe9edf0);
  assert.ok(material.metalness > 0);
  assert.ok(material.roughness < 0.8);
});
