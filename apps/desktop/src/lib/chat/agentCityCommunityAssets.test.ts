import assert from "node:assert/strict";
import test from "node:test";
import { COMMUNITY_KIT_URL } from "./agentCityCommunityAssets";

test("Agent Community uses a bundled modular GLTF kit", () => {
  assert.equal(COMMUNITY_KIT_URL, "/agent-community/community-kit.gltf");
});
