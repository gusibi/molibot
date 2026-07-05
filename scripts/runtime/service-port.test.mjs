import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readConfiguredServicePort } from "./service-port.mjs";

test("readConfiguredServicePort reads a valid persisted port", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-port-"));
  try {
    writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ serverPort: 4312 }));
    assert.equal(readConfiguredServicePort(dataDir), 4312);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("readConfiguredServicePort falls back for invalid or missing settings", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-port-"));
  try {
    writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ serverPort: 80 }));
    assert.equal(readConfiguredServicePort(dataDir), 3000);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
