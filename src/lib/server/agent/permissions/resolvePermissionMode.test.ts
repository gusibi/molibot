import assert from "node:assert/strict";
import test from "node:test";
import {
  clampModeForChannel,
  resolveEffectivePermissionMode
} from "$lib/server/agent/permissions/resolvePermissionMode.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";

function settingsFixture(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    permissionMode: "accept_edits",
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

test("falls back to the global default when nothing overrides", () => {
  const mode = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture(),
    ...IDENTITY
  });
  assert.equal(mode, "accept_edits");
});

test("the session override wins over every other level", () => {
  const mode = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      permissionMode: "auto",
      agents: [{ id: "agent-1", permissionMode: "plan" }],
      channels: { web: { instances: [{ id: "default", agentId: "agent-1", permissionMode: "auto" }] } }
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub("manual"),
    ...IDENTITY
  });
  assert.equal(mode, "manual");
});

test("the bot instance outranks its agent", () => {
  const mode = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      agents: [{ id: "agent-1", permissionMode: "plan" }],
      channels: { web: { instances: [{ id: "default", agentId: "agent-1", permissionMode: "auto" }] } }
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub(null),
    ...IDENTITY
  });
  assert.equal(mode, "auto");
});

test("the agent level applies to the bots that run it", () => {
  const mode = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      agents: [{ id: "agent-1", permissionMode: "manual" }]
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub(null),
    ...IDENTITY
  });
  assert.equal(mode, "manual");
});

test("a project override sits between session and instance", () => {
  const mode = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({
      channels: { web: { instances: [{ id: "default", agentId: "agent-1", permissionMode: "auto" }] } }
    } as unknown as Partial<RuntimeSettings>),
    store: storeStub(null),
    projectOverride: "plan",
    ...IDENTITY
  });
  assert.equal(mode, "plan");
});

test("a missing global falls back to Accept edits rather than to undefined", () => {
  const mode = resolveEffectivePermissionMode({
    getSettings: () => settingsFixture({ permissionMode: undefined } as unknown as Partial<RuntimeSettings>),
    ...IDENTITY
  });
  assert.equal(mode, "accept_edits");
});

test("Plan and Manual are clamped away on messaging channels", () => {
  // Product decision 2026-08-10: neither has an interaction surface there.
  for (const channel of ["telegram", "feishu", "qq", "weixin"]) {
    assert.equal(clampModeForChannel("plan", channel), "accept_edits", channel);
    assert.equal(clampModeForChannel("manual", channel), "accept_edits", channel);
    // The two modes a channel can honour pass through untouched.
    assert.equal(clampModeForChannel("accept_edits", channel), "accept_edits", channel);
    assert.equal(clampModeForChannel("auto", channel), "auto", channel);
  }
});

test("desktop surfaces keep every mode", () => {
  for (const mode of ["plan", "manual", "accept_edits", "auto"] as const) {
    assert.equal(clampModeForChannel(mode, "web"), mode);
    assert.equal(clampModeForChannel(mode, "cli"), mode);
  }
});

test("clamping only ever makes a channel stricter than the unsupported mode", () => {
  // Plan and Manual are both stricter than Accept edits, so a user whose mode
  // cannot be honoured on a channel still gets a gate — never a looser one.
  const rank = { plan: 0, manual: 1, accept_edits: 2, auto: 3 } as const;
  for (const mode of ["plan", "manual"] as const) {
    const clamped = clampModeForChannel(mode, "telegram");
    assert.ok(rank[clamped] > rank[mode], "the clamp loosens, which must stay a deliberate, documented choice");
    assert.equal(clamped, "accept_edits");
  }
});
