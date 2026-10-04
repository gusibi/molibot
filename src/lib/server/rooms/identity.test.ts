import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { roomPolicy } from "./identity.js";
import type { AgentRoom } from "$lib/shared/rooms.js";

const room: AgentRoom = {id: "room", title: "Discussion", primaryAgentId: "a", participants: [], createdAt: "2026-10-03T00:00:00Z"};
const agent = {id: "a", name: "Agent", description: "", enabled: true};
test("discussion restricts tools without replacing the resolved permission mode with Plan", () => {
  const settings = {...defaultRuntimeSettings, permissionMode: "manual" as const};
  assert.equal(roomPolicy(settings, room, agent, "discussion").mode, "manual");
  assert.equal(roomPolicy(settings, room, agent, "discussion").readOnly, true);
  assert.equal(roomPolicy(settings, room, agent, "direct").readOnly, false);
  assert.equal(roomPolicy(settings, {...room, permissionMode: "plan"}, agent, "discussion").mode, "plan");
});
