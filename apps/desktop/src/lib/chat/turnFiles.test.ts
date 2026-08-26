import assert from "node:assert/strict";
import test from "node:test";
import { collectTurnFiles } from "./turnFiles";

test("collectTurnFiles returns one flat final list with stable created/modified labels", () => {
  const files = collectTurnFiles({
    activities: [
      { key: "write-1", kind: "tool", label: "Write", state: "success", fileOutput: { path: "src/new.ts", action: "created", rootKind: "project" } },
      { key: "edit-1", kind: "tool", label: "Edit", state: "success", fileOutput: { path: "src/new.ts", action: "modified", rootKind: "project" } },
      { key: "edit-2", kind: "tool", label: "Edit", state: "success", fileOutput: { path: "src/existing.ts", action: "modified", rootKind: "project" } },
      { key: "failed", kind: "tool", label: "Write", state: "error", fileOutput: { path: "src/failed.ts", action: "created", rootKind: "project" } }
    ]
  });

  assert.deepEqual(files.map(({ path, action, source }) => ({ path, action, source })), [
    { path: "src/new.ts", action: "created", source: "project" },
    { path: "src/existing.ts", action: "modified", source: "project" }
  ]);
});

test("collectTurnFiles exposes successful scratch writes as Session outputs without attach", () => {
  const local = "web:default:web-anonymous/scratch/2026/08/26/report.html";
  const files = collectTurnFiles({
    activities: [
      {
        key: "write-scratch",
        kind: "tool",
        label: "Write",
        state: "success",
        fileOutput: { path: "2026/08/26/report.html", action: "created", rootKind: "scratch" }
      }
    ]
  }, new Map([[local, { id: "scratch-file", local }]]));

  assert.deepEqual(files, [{
    key: "session:scratch-file",
    name: "2026/08/26/report.html",
    path: local,
    action: "created",
    source: "session",
    fileId: "scratch-file"
  }]);
});

test("collectTurnFiles adds generated session attachments and resolves their file ids", () => {
  const files = collectTurnFiles({
    attachments: [{ original: "report.pdf", local: "2026/08/25/report.pdf" }]
  }, new Map([["2026/08/25/report.pdf", { id: "file-1", local: "2026/08/25/report.pdf" }]]));

  assert.deepEqual(files, [{
    key: "session:file-1",
    name: "report.pdf",
    path: "2026/08/25/report.pdf",
    action: "created",
    source: "session",
    fileId: "file-1"
  }]);
});

test("collectTurnFiles avoids listing an auto-attached Project output twice", () => {
  const files = collectTurnFiles({
    activities: [
      { key: "write-1", kind: "tool", label: "Write", state: "success", fileOutput: { path: "reports/report.pdf", action: "created", rootKind: "project" } }
    ],
    attachments: [{ original: "report.pdf", local: "2026/08/25/report.pdf" }]
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "project");
});
