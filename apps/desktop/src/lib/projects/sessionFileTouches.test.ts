import test from "node:test";
import assert from "node:assert/strict";
import { collectSessionFileTouches } from "./sessionFileTouches";
import { appendReference, formatFileReference } from "./composerBridge";

test("written files come only from mutating tool activities", () => {
  const touches = collectSessionFileTouches([
    { activities: [{ key: "read-1", kind: "tool", label: "Read", state: "success", paths: ["src/a.ts"], mutates: false }] },
    { activities: [{ key: "edit-1", kind: "tool", label: "Edit", state: "success", paths: ["src/b.ts"], mutates: true }] }
  ]);
  assert.deepEqual([...touches.written], ["src/b.ts"]);
  assert.deepEqual([...touches.all].sort(), ["src/a.ts", "src/b.ts"]);
});

test("the running turn's activities count before they reach the transcript", () => {
  // Otherwise a file the agent just wrote stays unmarked until the turn ends.
  const touches = collectSessionFileTouches(
    [{ activities: [{ key: "edit-1", kind: "tool", label: "Edit", state: "success", paths: ["done.ts"], mutates: true }] }],
    [{ key: "write-9", kind: "tool", label: "Write", state: "running", paths: ["live.ts"], mutates: true }]
  );
  assert.deepEqual([...touches.written].sort(), ["done.ts", "live.ts"]);
});

test("activities without paths and empty transcripts are ignored safely", () => {
  const touches = collectSessionFileTouches([
    { activities: [{ key: "bash-1", kind: "tool", label: "Bash", state: "success" }] },
    {}
  ]);
  assert.equal(touches.written.size, 0);
  assert.equal(touches.all.size, 0);
});

test("a file written across several turns is counted once", () => {
  const touches = collectSessionFileTouches([
    { activities: [{ key: "edit-1", kind: "tool", label: "Edit", state: "success", paths: ["a.ts"], mutates: true }] },
    { activities: [{ key: "edit-2", kind: "tool", label: "Edit", state: "success", paths: ["a.ts"], mutates: true }] }
  ]);
  assert.deepEqual([...touches.written], ["a.ts"]);
});

test("composer references keep one space around the inserted token", () => {
  assert.equal(formatFileReference("src/a.ts"), "@src/a.ts");
  assert.equal(formatFileReference("src/a.ts", 42), "@src/a.ts:42");
  assert.equal(appendReference("", "@src/a.ts"), "@src/a.ts ");
  assert.equal(appendReference("look at", "@src/a.ts"), "look at @src/a.ts ");
  assert.equal(appendReference("look at   ", "@src/a.ts"), "look at @src/a.ts ");
});
