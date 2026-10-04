import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPiDeviceId } from "./deviceId.js";

test("ChatGPT OAuth identity survives a fresh read without replacing an existing identity", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-pi-device-"));
  try {
    const path = join(root, "nested", "pi-device-id");
    const id = getPiDeviceId(path);
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(getPiDeviceId(path), id);
    writeFileSync(path, "invalid");
    assert.throws(() => getPiDeviceId(path), /Invalid Pi OAuth installation identity/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
