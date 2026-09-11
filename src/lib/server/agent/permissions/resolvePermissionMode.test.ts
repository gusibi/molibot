import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveEffectiveExecutionPolicy,
  resolveEffectivePermissionMode
} from "$lib/server/agent/permissions/resolvePermissionMode.js";
import { defaultToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";

function settingsFixture(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    permissionMode: "accept_edits",
    toolSandbox: defaultToolSandboxSettings,
    channels: {
      web: { instances: [{ id: "default", agentId: "agent-1" }] }
    },
    agents: [{ id: "agent-1" }],
    ...overrides
  } as unknown as RuntimeSettings;
}

function storeStub(value: unknown): MomRuntimeStore {
  return { getSessionPermissionModeOverride: () => value } as unknown as MomRuntimeStore;
}

const IDENTITY = { chatId: "c", sessionId: "s", channel: "web", botId: "default" };

test("falls back to the global default when nothing overrides, and says so", () => {
  const resolved = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture(),
    ...IDENTITY
  });
  assert.equal(resolved.mode, "accept_edits");
  assert.equal(resolved.source, "global");
});

test("the session override wins over every other level", () => {
  const resolved = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      permissionMode: "auto",
      agents: [{ id: "agent-1", permissionMode: "plan" }],
      channels: { web: { instances: [{ id: "default", agentId: "agent-1", permissionMode: "auto" }] } }
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub("manual"),
    ...IDENTITY
  });
  assert.equal(resolved.mode, "manual");
  assert.equal(resolved.source, "session");
});

test("the bot instance outranks its agent", () => {
  const resolved = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      agents: [{ id: "agent-1", permissionMode: "plan" }],
      channels: { web: { instances: [{ id: "default", agentId: "agent-1", permissionMode: "auto" }] } }
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub(null),
    ...IDENTITY
  });
  assert.equal(resolved.mode, "auto");
  assert.equal(resolved.source, "instance");
});

test("the agent level applies to the bots that run it", () => {
  const resolved = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      agents: [{ id: "agent-1", permissionMode: "manual" }]
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub(null),
    ...IDENTITY
  });
  assert.equal(resolved.mode, "manual");
  assert.equal(resolved.source, "agent");
});

test("a project override sits between session and instance", () => {
  const resolved = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      channels: { web: { instances: [{ id: "default", agentId: "agent-1", permissionMode: "auto" }] } }
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub(null),
    projectOverride: "plan",
    ...IDENTITY
  });
  assert.equal(resolved.mode, "plan");
  assert.equal(resolved.source, "project");
});

test("a missing global falls back to Accept edits rather than to undefined", () => {
  const resolved = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({ permissionMode: undefined } as unknown as Partial<RuntimeSettings>),
    ...IDENTITY
  });
  assert.equal(resolved.mode, "accept_edits");
});

test("every transport receives the mode it resolved — no channel clamping", () => {
  // Clamping Plan/Manual to Accept edits silently widened permissions on
  // transports without an approval card. Plan is honoured read-only and
  // Manual's approval suspends through the existing defer path, so the
  // resolver never rewrites a mode.
  for (const channel of ["web", "cli", "telegram", "feishu", "qq", "weixin"]) {
    for (const mode of ["plan", "manual", "accept_edits", "auto"] as const) {
      const resolved = resolveEffectivePermissionMode({
        getSettings: () => settingsFixture({ permissionMode: mode } as unknown as Partial<RuntimeSettings>),
        channel
      });
      assert.equal(resolved.mode, mode, `${channel}/${mode}`);
    }
  }
});

test("the execution policy derives the target from the mode", () => {
  const base = { getSettings: () => settingsFixture(), ...IDENTITY };
  assert.equal(resolveEffectiveExecutionPolicy({ ...base, getSettings: () => settingsFixture({ permissionMode: "auto" } as unknown as Partial<RuntimeSettings>) }).executionTarget, "host");
  assert.equal(resolveEffectiveExecutionPolicy({ ...base, getSettings: () => settingsFixture({ permissionMode: "plan" } as unknown as Partial<RuntimeSettings>) }).executionTarget, "none");
  assert.equal(resolveEffectiveExecutionPolicy({ ...base, getSettings: () => settingsFixture({ permissionMode: "manual" } as unknown as Partial<RuntimeSettings>) }).executionTarget, "sandbox");
  assert.equal(resolveEffectiveExecutionPolicy(base).executionTarget, "sandbox");
});

test("sandbox restrictions are attached only when the sandbox participates", () => {
  const sandboxSettings = { ...defaultToolSandboxSettings, network: { allowedDomains: ["example.com"], deniedDomains: [] } };
  const base = { getSettings: () => settingsFixture({ toolSandbox: sandboxSettings }), ...IDENTITY };
  const sandboxed = resolveEffectiveExecutionPolicy(base);
  assert.equal(sandboxed.sandbox?.network.allowedDomains[0], "example.com");

  const auto = resolveEffectiveExecutionPolicy({ ...base, getSettings: () => settingsFixture({ permissionMode: "auto", toolSandbox: sandboxSettings } as unknown as Partial<RuntimeSettings>) });
  assert.equal(auto.executionTarget, "host");
  assert.equal(auto.sandbox, undefined, "full access must not apply sandbox restrictions");
});
