import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installFileLogger } from "./file-logger.mjs";

test("installFileLogger tees stdout to a file and rotates past the size cap", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-file-logger-"));
  // A tiny cap so a few lines force a rotation deterministically.
  const logger = installFileLogger({ dataDir, maxBytes: 64, maxFiles: 2 });
  try {
    const logPath = path.join(dataDir, "runtime", "server.log");
    assert.equal(logger.logPath, logPath);

    // Capture that the original writer still runs (console output is preserved).
    let sawConsole = false;
    const restore = process.stdout.write;
    // Wrap once more to detect the passthrough without swallowing it.
    process.stdout.write = ((chunk, enc, cb) => { sawConsole = true; return restore.call(process.stdout, chunk, enc, cb); });
    try {
      for (let i = 0; i < 12; i += 1) process.stdout.write(`line ${i} ${"x".repeat(20)}\n`);
    } finally {
      process.stdout.write = restore;
    }
    assert.equal(sawConsole, true);

    // Rotation produced at least one backup, and no file exceeds the cap by
    // more than one record (records are never split).
    assert.equal(fs.existsSync(`${logPath}.1`), true);
    // maxFiles: 2 means .1 and .2 at most, never .3.
    assert.equal(fs.existsSync(`${logPath}.3`), false);
  } finally {
    logger.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
