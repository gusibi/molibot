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

test("system config persists a dedicated subagent runtime budget without changing the parent budget", async () => {
  let settings = structuredClone(defaultRuntimeSettings);
  const originalParentBudget = structuredClone(settings.budget);
  const runtime = {
    getSettings: () => settings,
    updateSettings: (patch: Partial<RuntimeSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }
  };

  const updated = await updateSystemConfig(runtime, {
    subagentRuntime: {
      maxToolCalls: 120,
      maxToolFailures: 8,
      maxModelTurns: 20,
      deadlineMs: 2_400_000,
      maxTasks: 8,
      maxConcurrency: 3,
      compactionEnabled: true,
      persistSessions: true
    }
  });

  assert.deepEqual(updated.subagentRuntime, {
    maxToolCalls: 120,
    maxToolFailures: 8,
    maxModelTurns: 20,
    deadlineMs: 2_400_000,
    maxTasks: 8,
    maxConcurrency: 3,
    compactionEnabled: true,
    persistSessions: true
  });
  assert.deepEqual(settings.budget, originalParentBudget);

  const sanitized = await updateSystemConfig(runtime, {
    subagentRuntime: {
      maxToolCalls: 120.6,
      maxToolFailures: 8,
      maxModelTurns: 20,
      deadlineMs: 2_400_000,
      maxTasks: 2,
      maxConcurrency: 4,
      compactionEnabled: "false",
      persistSessions: "false"
    }
  });
  assert.equal(sanitized.subagentRuntime.maxToolCalls, 121);
  assert.equal(sanitized.subagentRuntime.maxConcurrency, 2);
  assert.equal(sanitized.subagentRuntime.compactionEnabled, false);
  assert.equal(sanitized.subagentRuntime.persistSessions, false);
});
