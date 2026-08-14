import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const matrix = readFileSync(new URL("../../docs/requirements/personal-assistant-capability-matrix.md", import.meta.url), "utf8");
const prd = readFileSync(new URL("../../prd.md", import.meta.url), "utf8");
const allowedStatuses = new Set(["已交付", "部分交付", "待验证", "未开始"]);

function capabilityRows() {
  const body = matrix.split("## Current matrix\n", 2)[1]?.split("\n## Maintenance rule", 1)[0] ?? "";
  return body
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---") && !line.startsWith("| Area"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map(([area, capability, status, evidence]) => ({ area, capability, status, evidence }));
}

test("capability matrix uses one four-state vocabulary with unique capabilities", () => {
  const rows = capabilityRows();
  assert.ok(rows.length >= 15);
  for (const row of rows) {
    assert.ok(allowedStatuses.has(row.status), `invalid status: ${row.status}`);
  }
  assert.equal(new Set(rows.map((row) => `${row.area}:${row.capability}`)).size, rows.length);
  assert.equal(rows.every((row) => row.evidence.length > 0), true);
});

test("known completed capabilities cannot regress to stale session-PRD statuses", () => {
  const status = new Map(capabilityRows().map((row) => [row.capability, row.status]));
  for (const capability of [
    "`add_content` routing",
    "DOCX/XLSX/PDF deliverable export",
    "Runtime Todo, one-shot reminders, and periodic automation CRUD",
    "Agent creation/install H2",
    "Microphone recording and transcription path",
    "Safe legacy data cleanup"
  ]) {
    assert.equal(status.get(capability), "已交付", `${capability} must remain delivered until new evidence changes it`);
  }
});

test("prd declares the matrix authoritative over historical sections", () => {
  assert.match(prd, /Personal Assistant Capability Matrix/);
  assert.match(prd, /must not be used alone to generate tasks/);
});
