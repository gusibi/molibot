import assert from "node:assert/strict";
import test from "node:test";
import { latestAgentConversationTimes, sortAgentNavigation } from "./agentNavigation.js";

test("Agent order: default pinned first, then conversation activity, then name, independent of config order", () => {
  const agents = [{ id: "default", name: "Momo" }, { id: "b", name: "Buffett" }, { id: "a", name: "Alice" }, { id: "z", name: "Zed" }];
  const sessions = Array.from({ length: 110 }, () => ({ agentId: "b", updatedAt: "2026-10-11T12:00:00Z" }));
  sessions.push({ agentId: "a", updatedAt: "2026-10-11T12:00:00Z" }, { agentId: "default", updatedAt: "2026-10-10T12:00:00Z" });
  const times = latestAgentConversationTimes(sessions);
  for (let shift = 0; shift < agents.length; shift++) {
    const editedOrder = [...agents.slice(shift), ...agents.slice(0, shift)];
    assert.deepEqual(sortAgentNavigation(editedOrder, times, "default").map(a => a.id), ["default", "a", "b", "z"]);
  }
  // No activity data at all: default still first, rest alphabetical.
  assert.deepEqual(sortAgentNavigation(agents, {}, "default").map(a => a.id), ["default", "a", "b", "z"]);
  // A newer conversation moves an agent up, but never above the pinned default.
  const newer = latestAgentConversationTimes([...sessions, { agentId: "z", updatedAt: "2026-10-12T00:00:00Z" }]);
  assert.deepEqual(sortAgentNavigation(agents, newer, "default").map(a => a.id), ["default", "z", "a", "b"]);
});

test("Names with equal initials have deterministic order; aggregation keeps each maximum", () => {
  const times = latestAgentConversationTimes([{ agentId: "a", updatedAt: "2026-10-11T00:00:00Z" }, { agentId: "a", updatedAt: "2026-10-01T00:00:00Z" }, { agentId: "a", updatedAt: "invalid" }]);
  assert.equal(times.a, Date.parse("2026-10-11T00:00:00Z"));
  assert.deepEqual(sortAgentNavigation([{ id: "z", name: "Alice" }, { id: "a", name: "alice" }], {}).map(a => a.id), ["a", "z"]);
});
