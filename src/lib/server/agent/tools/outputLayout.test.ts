import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { buildRunOutputLayout, describeFileToolResult, outputReportBase } from "./outputLayout.js";

test("scratch receipts are relative to the scratch root with the dated segment", () => {
  const cwd = "/tmp/ws/chat/scratch";
  const layout = buildRunOutputLayout({ cwd, scratchRoot: join(cwd, "2026", "09", "14"), scratchBase: cwd });
  assert.equal(outputReportBase(layout, "scratch"), cwd);
  const details = describeFileToolResult(layout, join(cwd, "2026", "09", "14", "report.html"), "created");
  assert.equal(details?.rootKind, "scratch");
  // Must match how the Session file list resolves it: scratch/<path>.
  assert.equal(details?.relativePath, "2026/09/14/report.html");
});

test("project receipts stay project-root relative", () => {
  const projectRoot = "/tmp/proj";
  const layout = buildRunOutputLayout({
    cwd: projectRoot,
    scratchRoot: join(projectRoot, "scratch", "2026", "09", "14"),
    scratchBase: join(projectRoot, "scratch"),
    projectRoot
  });
  const details = describeFileToolResult(layout, join(projectRoot, "src", "a.ts"), "modified");
  assert.equal(details?.rootKind, "project");
  assert.equal(details?.relativePath, "src/a.ts");
});

test("a layout without an explicit scratch base keeps the classic basename behavior", () => {
  const layout = buildRunOutputLayout({ cwd: "/tmp/ws/chat/scratch", scratchRoot: "/tmp/ws/chat/scratch/2026/09/14" });
  const details = describeFileToolResult(layout, "/tmp/ws/chat/scratch/2026/09/14/report.html", "created");
  assert.equal(details?.relativePath, "report.html");
});
