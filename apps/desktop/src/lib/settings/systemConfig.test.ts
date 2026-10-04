import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopSystemConfig } from "@molibot/desktop-contract";
import { buildDesktopSystemPatch } from "./systemConfig";

const config: DesktopSystemConfig = { serverPort: 3040, timezone: "UTC",
  budget: { maxToolCalls: 100, maxToolFailures: 6, maxModelAttempts: 6 },
  subagentRuntime: { maxToolCalls: 100, maxToolFailures: 6, maxModelTurns: 12, deadlineMs: 600000,
    maxTasks: 4, maxConcurrency: 2, compactionEnabled: true, persistSessions: true },
  browserAutomation: { defaultTimeoutMs: 60000 },
  display: { toolProgress: "new", showReasoning: "off", gatewayNotifyInterval: 5, runLogNotice: false } };

test("editing only retries never sends other runtime settings or stale sibling budget values", () => {
  const draft = structuredClone(config); draft.budget.maxModelAttempts = 12;
  assert.deepEqual(buildDesktopSystemPatch(draft, config), { budget: { maxModelAttempts: 12 } });
  assert.deepEqual(buildDesktopSystemPatch(config, config), {});
});

test("system patches retain explicit false and zero edits", () => {
  const draft = structuredClone(config); draft.subagentRuntime.persistSessions = false; draft.display.gatewayNotifyInterval = 0;
  assert.deepEqual(buildDesktopSystemPatch(draft, config), { subagentRuntime: { persistSessions: false }, display: { gatewayNotifyInterval: 0 } });
});
