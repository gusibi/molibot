import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopMemoryCandidate, DesktopMemoryItem } from "@molibot/desktop-contract";
import { compactMemoryText, memoryTopicFor, projectMemoryCenter, splitPendingCandidates } from "./memoryCenter";

function memory(overrides: Partial<DesktopMemoryItem> & Pick<DesktopMemoryItem, "id" | "content">): DesktopMemoryItem {
  return {
    channel: "web",
    externalUserId: "owner",
    tags: [],
    layer: "long_term",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides
  };
}

function candidate(id: string, updatedAt: string): DesktopMemoryCandidate {
  return {
    id,
    status: "pending",
    namespace: "owner:owner",
    domain: "owner",
    type: "user_fact",
    subject: id,
    value: id,
    confidence: 0.8,
    reason: "Repeated evidence",
    sources: [],
    createdAt: updatedAt,
    updatedAt
  };
}

test("memoryTopicFor classifies real memory fields without relying on display copy", () => {
  assert.equal(memoryTopicFor(memory({ id: "p", content: "Ship the desktop client", domain: "project" })), "projects");
  assert.equal(memoryTopicFor(memory({ id: "d", content: "偏好 macOS 原生设计" })), "design");
  assert.equal(memoryTopicFor(memory({ id: "w", content: "EMOM 训练与心率记录" })), "wellness");
  assert.equal(memoryTopicFor(memory({ id: "t", content: "Uses Svelte and Tauri" })), "technology");
  assert.equal(memoryTopicFor(memory({ id: "c", content: "公众号文章素材整理" })), "content");
  assert.equal(memoryTopicFor(memory({ id: "h", content: "Prefers a clear morning routine" })), "habits");
});

test("projectMemoryCenter keeps topics separate and derives overview from stored facts", () => {
  const items = [
    memory({ id: "project", content: "Molibot macOS 客户端是当前主线", domain: "project", type: "task", tags: ["current"] }),
    memory({ id: "design", content: "偏好简洁的 macOS 原生设计", type: "user_preference", tags: ["style"] }),
    memory({ id: "fitness", content: "持续进行 EMOM 减脂训练", tags: ["fitness"] }),
    memory({ id: "conflict", content: "旧技术栈信息", hasConflict: true })
  ];
  const result = projectMemoryCenter(items, [candidate("older", "2026-07-10T00:00:00.000Z"), candidate("newer", "2026-07-15T00:00:00.000Z")]);

  assert.match(result.summary, /Molibot|macOS/);
  assert.equal(result.currentFocus[0]?.id, "project");
  assert.equal(result.stablePreferences[0]?.id, "design");
  assert.equal(result.attentionItems[0]?.id, "conflict");
  assert.deepEqual(result.pendingCandidates.map((item) => item.id), ["newer", "older"]);
  assert.equal(result.topics.find((topic) => topic.id === "wellness")?.items[0]?.id, "fitness");
});

test("overview projection keeps lifestyle records out of stable preferences and diversifies its summary", () => {
  const projection = projectMemoryCenter([
    memory({ id: "workout", content: "EMOM workout complete", tags: ["class:lifestyle"], domain: "owner" }),
    memory({ id: "preference", content: "用户喜欢蓝色", tags: ["preference:color"], domain: "owner" }),
    memory({ id: "project", content: "正在开发 Molibot memory center", tags: ["project"], domain: "project" })
  ], []);

  assert.deepEqual(projection.stablePreferences.map((entry) => entry.id), ["preference"]);
  assert.match(projection.summary, /workout/i);
  assert.match(projection.summary, /Molibot/i);
});

test("compactMemoryText removes markup and bounds long raw memory content", () => {
  assert.equal(compactMemoryText("## Title\n-   A stored **fact**", 40), "Title A stored fact");
  assert.equal(compactMemoryText("1234567890", 6), "12345…");
});

test("splitPendingCandidates keeps owner/project candidates first and separates agent learnings", () => {
  const owner = candidate("owner-pref", "2026-07-15T00:00:00.000Z");
  const project = { ...candidate("project-task", "2026-07-14T00:00:00.000Z"), domain: "project" as const };
  const agent = { ...candidate("agent-lesson", "2026-07-16T00:00:00.000Z"), domain: "agent_self" as const };
  const content = { ...candidate("content-note", "2026-07-13T00:00:00.000Z"), domain: "content" as const };
  const groups = splitPendingCandidates([agent, owner, project, content]);
  assert.deepEqual(groups.aboutOwner.map((entry) => entry.id), ["owner-pref", "project-task"]);
  assert.deepEqual(groups.agentLearnings.map((entry) => entry.id), ["agent-lesson", "content-note"]);
});
