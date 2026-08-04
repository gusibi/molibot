import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCrashRecord,
  crashDir,
  formatCrashLine,
  installStdioErrorGuards,
  isBrokenPipeError,
  pruneCrashReports,
  writeCrashReport
} from "./crash-report.mjs";

test("formatCrashLine emits a parseable [mom-t] error record", () => {
  const record = buildCrashRecord({
    kind: "uncaughtException",
    error: new Error("kaboom"),
    pid: 4242,
    now: new Date("2026-08-03T12:00:00.000Z"),
    uptimeSeconds: 12
  });
  const line = formatCrashLine(record);
  assert.equal(line.startsWith("[mom-t] "), true);
  assert.equal(line.endsWith("\n"), true);

  const parsed = JSON.parse(line.slice("[mom-t] ".length));
  assert.equal(parsed.event, "service_crash");
  assert.equal(parsed.level, "error");
  assert.equal(parsed.kind, "uncaughtException");
  assert.equal(parsed.pid, 4242);
  assert.equal(parsed.message, "Error: kaboom");
  // The desktop log panel parses these; the shape must match the service's.
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.category, "runtime");
});

test("a non-Error rejection value still produces a record", () => {
  const record = buildCrashRecord({ kind: "unhandledRejection", error: "just a string" });
  const parsed = JSON.parse(formatCrashLine(record).slice("[mom-t] ".length));
  assert.equal(parsed.kind, "unhandledRejection");
  assert.equal(parsed.message.includes("just a string"), true);
});

test("writeCrashReport writes a standalone file and prunes to the cap", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-crash-"));
  try {
    const file = writeCrashReport(
      dataDir,
      buildCrashRecord({ kind: "uncaughtException", error: new Error("first") })
    );
    assert.notEqual(file, null);
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.readFileSync(file, "utf8").includes("first"), true);

    // Overflow the cap and confirm only the newest survive.
    const dir = crashDir(dataDir);
    for (let i = 0; i < 30; i += 1) {
      const stamp = `2026-08-03T00-00-${String(i).padStart(2, "0")}-000Z-${i}.log`;
      fs.writeFileSync(path.join(dir, stamp), `report ${i}`, "utf8");
    }
    pruneCrashReports(dir, 20);
    const remaining = fs.readdirSync(dir).filter((name) => name.endsWith(".log"));
    assert.equal(remaining.length, 20);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("writeCrashReport returns null instead of throwing on an unwritable dir", () => {
  // A file where the crashes directory must go makes mkdir fail.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-crash-"));
  try {
    fs.mkdirSync(path.join(dataDir, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "runtime", "crashes"), "blocker", "utf8");
    const file = writeCrashReport(
      dataDir,
      buildCrashRecord({ kind: "uncaughtException", error: new Error("x") })
    );
    assert.equal(file, null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// A closed supervisor pipe killed a healthy service twice in one day, each time
// stranding an in-flight scheduled task at "running". Log output is expendable;
// the process is not.
test("a broken stdout pipe is classified as benign, other stream errors are not", () => {
  assert.equal(isBrokenPipeError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), true);
  assert.equal(isBrokenPipeError(Object.assign(new Error("gone"), { code: "ERR_STREAM_DESTROYED" })), true);
  assert.equal(isBrokenPipeError(new Error("ordinary failure")), false);
  assert.equal(isBrokenPipeError(undefined), false);
});

test("stdio error guards swallow a broken pipe and rethrow everything else", () => {
  const handlers = [];
  const stream = { on: (event, handler) => { if (event === "error") handlers.push(handler); } };
  installStdioErrorGuards([stream]);
  assert.equal(handlers.length, 1);

  handlers[0](Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  assert.throws(() => handlers[0](new Error("a real invariant broke")), /a real invariant broke/);
});
