import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "../defaults.js";
import type { RuntimeSettings } from "../schema.js";
import { readSystemConfig, updateSystemConfig } from "./system.js";

test("system config reads, validates, and persists serverPort", async () => {
  let settings = structuredClone(defaultRuntimeSettings);
  const runtime = {
    getSettings: () => settings,
    updateSettings: (patch: Partial<RuntimeSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }
  };
  const previousPort = process.env.PORT;
  process.env.PORT = "43115";
  try {
    assert.equal(readSystemConfig(runtime).serverPort, settings.serverPort);
    await assert.rejects(() => updateSystemConfig(runtime, { serverPort: 80 }), /between 1024 and 65535/);
    const updated = await updateSystemConfig(runtime, { serverPort: 43115 });
    assert.equal(updated.serverPort, 43115);
    assert.equal(settings.serverPort, 43115);
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
});
