import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { findAvailableServicePort, readConfiguredServicePort } from "./service-port.mjs";

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

test("findAvailableServicePort increments from an occupied preferred port", async () => {
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  try {
    const address = occupied.address();
    assert.equal(typeof address, "object");
    const preferred = address.port;
    if (preferred === 65535) return;
    assert.equal(await findAvailableServicePort(preferred), preferred + 1);
  } finally {
    await new Promise((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
  }
});
