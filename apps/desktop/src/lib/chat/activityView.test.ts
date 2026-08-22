import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopConversationActivity } from "@molibot/desktop-contract";
import {
  activityFileSummary,
  activityHeadline,
  activityTimelineItems,
  activityToolIcon,
  activityToolName,
  classifyActivityBody
} from "./activityView";

function activity(overrides: Partial<DesktopConversationActivity> = {}): DesktopConversationActivity {
  return {
    key: "read-1",
    kind: "tool",
    label: "read src/app.ts",
    state: "success",
    ...overrides
  };
}

test("the declared tool id wins over the key", () => {
  assert.equal(activityToolName({ tool: "bash", key: "read-4" }), "bash");
});

test("history without a tool field recovers the id from the key", () => {
  assert.equal(activityToolName({ key: "read-12" }), "read");
  // A tool id may itself contain a hyphen; only the numeric suffix is stripped.
  assert.equal(activityToolName({ key: "miniapp__expense-tracker-3" }), "miniapp__expense-tracker");
});

test("a key with no sequence suffix is returned whole rather than guessed at", () => {
  assert.equal(activityToolName({ key: "subagent:writer:0" }), "subagent:writer:0");
  assert.equal(activityToolName({ key: "bash" }), "bash");
});

test("a diff payload outranks the summary", () => {
  const body = classifyActivityBody(activity({
    tool: "edit",
    summary: "Updated src/app.ts",
    diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n"
  }));
  assert.equal(body?.kind, "diff");
  assert.match(body?.diff ?? "", /@@/);
});

test("bash output renders as a terminal, read output as code with its path", () => {
  assert.equal(classifyActivityBody(activity({ tool: "bash", summary: "ok" }))?.kind, "terminal");
  const read = classifyActivityBody(activity({
    tool: "read",
    summary: "export const x = 1;",
    paths: ["src/app.ts"]
  }));
  assert.equal(read?.kind, "code");
  assert.equal(read?.filePath, "src/app.ts");
});

test("a JSON payload renders as a tree, prose does not", () => {
  assert.equal(classifyActivityBody(activity({ tool: "mcp__x", summary: '{"a":1}' }))?.kind, "json");
  assert.equal(classifyActivityBody(activity({ tool: "mcp__x", summary: "{not json" }))?.kind, "text");
  // A bare scalar is valid JSON but is not a tree.
  assert.equal(classifyActivityBody(activity({ tool: "mcp__x", summary: "42" }))?.kind, "text");
});

test("a failed call always falls back to plain text", () => {
  // The payload of a failure is the error, not the artifact the tool produces;
  // routing it into a JSON tree or a code viewer buries the message.
  const body = classifyActivityBody(activity({
    tool: "bash",
    state: "error",
    summary: "exit 1: command not found"
  }));
  assert.equal(body?.kind, "text");
});

test("an activity with no payload has no body", () => {
  assert.equal(classifyActivityBody(activity({ summary: "" })), null);
  assert.equal(classifyActivityBody(activity({ summary: "   " })), null);
});

test("the head names the running step, then the failed one, then the last", () => {
  const running = activityHeadline([
    activity({ key: "a-1", label: "one" }),
    activity({ key: "b-2", label: "two", state: "running" }),
    activity({ key: "c-3", label: "three" })
  ]);
  assert.deepEqual(
    { label: running?.label, index: running?.index, total: running?.total, running: running?.running },
    { label: "two", index: 2, total: 3, running: true }
  );

  const failed = activityHeadline([
    activity({ key: "a-1", label: "one" }),
    activity({ key: "b-2", label: "two", state: "error" }),
    activity({ key: "c-3", label: "three" })
  ]);
  assert.equal(failed?.label, "two");
  assert.equal(failed?.failed, true);

  const done = activityHeadline([
    activity({ key: "a-1", label: "one" }),
    activity({ key: "c-3", label: "three" })
  ]);
  assert.equal(done?.label, "three");
  assert.equal(done?.running, false);
});

test("an empty activity list has no head", () => {
  assert.equal(activityHeadline([]), null);
});

test("file summary splits written from read and never counts a path twice", () => {
  const summary = activityFileSummary([
    activity({ key: "read-1", tool: "read", paths: ["a.ts"] }),
    activity({ key: "edit-2", tool: "edit", paths: ["a.ts"], mutates: true }),
    activity({ key: "read-3", tool: "read", paths: ["b.ts"] }),
    activity({ key: "read-4", tool: "read", paths: ["b.ts"] })
  ]);
  // `a.ts` was read and then written: written is the fact worth surfacing.
  assert.deepEqual(summary.written, ["a.ts"]);
  assert.deepEqual(summary.read, ["b.ts"]);
});

test("a failed call's paths are not reported as touched", () => {
  const summary = activityFileSummary([
    activity({ key: "edit-1", tool: "edit", paths: ["a.ts"], mutates: true, state: "error" })
  ]);
  assert.deepEqual(summary, { written: [], read: [] });
});

test("adjacent successful calls with the same readable action become one group", () => {
  const items = activityTimelineItems([
    activity({ key: "read-a", tool: "read", paths: ["a.ts"] }),
    activity({ key: "read-b", tool: "read", paths: ["b.ts"] }),
    activity({ key: "edit-a", tool: "edit", paths: ["a.ts"], mutates: true }),
    activity({ key: "write-b", tool: "write", paths: ["b.ts"], mutates: true })
  ]);

  assert.deepEqual(items.map((item) => item.kind === "group"
    ? { kind: item.kind, action: item.action, keys: item.activities.map((entry) => entry.key), fileCount: item.fileCount }
    : { kind: item.kind, key: item.activity.key }), [
    { kind: "group", action: "read", keys: ["read-a", "read-b"], fileCount: 2 },
    { kind: "group", action: "change", keys: ["edit-a", "write-b"], fileCount: 2 }
  ]);
});

test("a group reports wall-clock elapsed time instead of summing overlapping calls", () => {
  const [item] = activityTimelineItems([
    activity({
      key: "read-a",
      tool: "read",
      startedAt: "2026-08-14T12:00:00.000Z",
      finishedAt: "2026-08-14T12:00:02.000Z",
      durationMs: 2_000
    }),
    activity({
      key: "read-b",
      tool: "read",
      startedAt: "2026-08-14T12:00:01.000Z",
      finishedAt: "2026-08-14T12:00:03.000Z",
      durationMs: 2_000
    })
  ]);

  assert.equal(item.kind, "group");
  if (item.kind === "group") assert.equal(item.durationMs, 3_000);
});

test("grouping never crosses a different action or hides running and failed calls", () => {
  const items = activityTimelineItems([
    activity({ key: "read-a", tool: "read" }),
    activity({ key: "read-live", tool: "read", state: "running" }),
    activity({ key: "read-b", tool: "read" }),
    activity({ key: "read-failed", tool: "read", state: "error" }),
    activity({ key: "read-c", tool: "read" })
  ]);

  assert.deepEqual(items.map((item) => item.kind === "single" ? item.activity.key : item.key), [
    "read-a",
    "read-live",
    "read-b",
    "read-failed",
    "read-c"
  ]);
});

test("search and shell runs group, unknown tools remain explicit", () => {
  const items = activityTimelineItems([
    activity({ key: "search-a", tool: "web_search" }),
    activity({ key: "search-b", tool: "grep" }),
    activity({ key: "bash-a", tool: "bash" }),
    activity({ key: "bash-b", tool: "hostBash" }),
    activity({ key: "custom-a", tool: "mcp__custom" }),
    activity({ key: "custom-b", tool: "mcp__custom" })
  ]);

  assert.deepEqual(items.map((item) => item.kind === "group" ? item.action : item.activity.key), [
    "search",
    "command",
    "custom-a",
    "custom-b"
  ]);
});

test("activityToolIcon maps tools to distinct icons", () => {
  assert.equal(activityToolIcon({ tool: "bash", key: "bash-1" }), "terminal-window");
  assert.equal(activityToolIcon({ tool: "hostBash", key: "hostBash-1" }), "terminal-window");
  assert.equal(activityToolIcon({ tool: "write", key: "write-1" }), "pencil-simple-line");
  assert.equal(activityToolIcon({ tool: "edit", key: "edit-1" }), "pencil-simple-line");
  assert.equal(activityToolIcon({ key: "edit-1", mutates: true }), "pencil-simple-line");
  assert.equal(activityToolIcon({ tool: "read", key: "read-1" }), "file-text");
  assert.equal(activityToolIcon({ tool: "docExtract", key: "doc-1" }), "file-text");
  assert.equal(activityToolIcon({ tool: "webSearch", key: "search-1" }), "globe");
  assert.equal(activityToolIcon({ tool: "grep", key: "grep-1" }), "magnifying-glass");
  assert.equal(activityToolIcon({ tool: "ls", key: "ls-1" }), "folder-open");
  assert.equal(activityToolIcon({ tool: "memory_store", key: "mem-1" }), "brain");
  assert.equal(activityToolIcon({ tool: "subagent", key: "sub-1" }), "tree-structure");
  assert.equal(activityToolIcon({ tool: "miniapp__todo", key: "app-1" }), "cube");
  assert.equal(activityToolIcon({ tool: "mcp__github", key: "mcp-1" }), "plug");
  assert.equal(activityToolIcon({ key: "generic-1", label: "Run shell command" }), "terminal-window");
  assert.equal(activityToolIcon({ key: "generic-2", label: "Unknown tool" }), "wrench");
});
