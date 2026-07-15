import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultToolSandboxSettings, sanitizeToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";
import {
  buildSandboxEnvFileInjection,
  buildToolSandboxEnv,
  getToolSandboxDiagnostics,
  setSandboxProvider,
  getSandboxProvider,
  prepareToolSandboxExecution,
  resolveEffectiveSandboxSettings,
  type SandboxProvider
} from "$lib/server/agent/tools/sandbox.js";

test("sanitizeToolSandboxSettings keeps safe defaults for invalid input", () => {
  const settings = sanitizeToolSandboxSettings({
    enabled: true,
    initFailureMode: "unknown",
    envFilePath: "",
    env: {
      inheritMode: "bogus",
      allow: "OPENAI_API_KEY,TAVILY_API_KEY",
      deny: ["MOLIBOT_*", ""]
    },
    network: {
      allowedDomains: "example.com\napi.example.com",
      deniedDomains: []
    },
    filesystem: {
      allowWrite: ".\n/tmp",
      denyRead: [".env"],
      denyWrite: "*.key"
    }
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.initFailureMode, defaultToolSandboxSettings.initFailureMode);
  assert.equal(settings.envFilePath, defaultToolSandboxSettings.envFilePath);
  assert.deepEqual(settings.env.allow, ["OPENAI_API_KEY", "TAVILY_API_KEY"]);
  assert.deepEqual(settings.env.deny, ["MOLIBOT_*"]);
  assert.deepEqual(settings.network.allowedDomains, ["example.com", "api.example.com"]);
  assert.deepEqual(settings.filesystem.denyWrite, ["*.key"]);

  const override = sanitizeToolSandboxSettings(
    { initFailureMode: "warn-disable", env: { inheritMode: "minimal" } },
    {
      ...defaultToolSandboxSettings,
      initFailureMode: "block",
      env: { ...defaultToolSandboxSettings.env, inheritMode: "full" }
    }
  );
  assert.equal(override.initFailureMode, "warn-disable");
  assert.equal(override.env.inheritMode, "minimal");
});

test("buildToolSandboxEnv injects only allowed env keys from workspace env file", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-sandbox-env-"));
  try {
    writeFileSync(
      join(workspaceDir, ".env.sandbox.local"),
      [
        "OPENAI_API_KEY=allowed-secret",
        "TELEGRAM_BOT_TOKEN=blocked-secret",
        "PLAIN=value",
        ""
      ].join("\n"),
      "utf8"
    );

    const settings = sanitizeToolSandboxSettings({
      ...defaultToolSandboxSettings,
      enabled: true,
      envFilePath: join(workspaceDir, ".env.sandbox.local"),
      env: {
        inheritMode: "minimal",
        allow: ["OPENAI_API_KEY", "PLAIN"],
        deny: ["TELEGRAM_*"]
      }
    });
    const result = buildToolSandboxEnv(settings, workspaceDir, { MOLIBOT_SCRATCH_ARTIFACT_DIR: "2026/05/10" });

    assert.equal(result.env.OPENAI_API_KEY, "allowed-secret");
    assert.equal(result.env.PLAIN, "value");
    assert.equal(result.env.TELEGRAM_BOT_TOKEN, undefined);
    assert.equal(result.env.MOLIBOT_SCRATCH_ARTIFACT_DIR, "2026/05/10");
    assert.deepEqual(result.injectedKeys, ["OPENAI_API_KEY", "PLAIN"]);
    assert.equal(result.deniedKeys.includes("TELEGRAM_BOT_TOKEN"), true);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("buildToolSandboxEnv falls back to process env for allowlisted keys missing from env file", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-sandbox-fallback-"));
  const previous = process.env.OPENAI_API_KEY;
  const previousTavily = process.env.TAVILY_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "host-openai";
    process.env.TAVILY_API_KEY = "host-tavily";
    writeFileSync(
      join(workspaceDir, ".env.sandbox.local"),
      [
        "OPENAI_API_KEY=file-openai",
        ""
      ].join("\n"),
      "utf8"
    );

    const settings = sanitizeToolSandboxSettings({
      ...defaultToolSandboxSettings,
      enabled: true,
      envFilePath: join(workspaceDir, ".env.sandbox.local"),
      env: {
        inheritMode: "minimal",
        allow: ["OPENAI_API_KEY", "TAVILY_API_KEY", "MISSING_API_KEY"],
        deny: []
      }
    });
    const result = buildToolSandboxEnv(settings, workspaceDir);

    assert.equal(result.env.OPENAI_API_KEY, "file-openai");
    assert.equal(result.env.TAVILY_API_KEY, "host-tavily");
    assert.equal(result.env.MISSING_API_KEY, undefined);
    assert.deepEqual(result.injectedKeys, ["OPENAI_API_KEY", "TAVILY_API_KEY"]);
    assert.deepEqual(result.missingKeys, ["MISSING_API_KEY"]);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    if (previousTavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previousTavily;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("buildSandboxEnvFileInjection exposes only policy-allowed file-only secrets for the host fallback", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-sandbox-hostinject-"));
  const previousPlain = process.env.PLAIN;
  // BOT_API_TOKEN is a file-only secret in this fixture, so it must not exist in
  // the process env (the real data-dir `.env` may define it on a dev machine).
  const previousBotToken = process.env.BOT_API_TOKEN;
  try {
    process.env.PLAIN = "from-process";
    delete process.env.BOT_API_TOKEN;
    writeFileSync(
      join(workspaceDir, ".env.sandbox.local"),
      [
        "BOT_API_TOKEN=file-token",
        "TELEGRAM_BOT_TOKEN=blocked-secret",
        "PLAIN=from-file",
        ""
      ].join("\n"),
      "utf8"
    );

    const settings = sanitizeToolSandboxSettings({
      ...defaultToolSandboxSettings,
      enabled: true,
      envFilePath: join(workspaceDir, ".env.sandbox.local"),
      env: {
        inheritMode: "full",
        allow: [],
        deny: ["TELEGRAM_*"]
      }
    });

    const injection = buildSandboxEnvFileInjection(settings);
    // File-only secret is injected so the host fallback can reach it.
    assert.equal(injection.BOT_API_TOKEN, "file-token");
    // Denied keys never leak to the host.
    assert.equal(injection.TELEGRAM_BOT_TOKEN, undefined);
    // Keys already in the parent process env are skipped (host inherits them).
    assert.equal(injection.PLAIN, undefined);

    // Disabled sandbox never injects file secrets into the host fallback.
    assert.deepEqual(buildSandboxEnvFileInjection({ ...settings, enabled: false }), {});

    // allowlist mode only injects file-only keys named in allow.
    const allowlisted = buildSandboxEnvFileInjection({
      ...settings,
      env: { inheritMode: "allowlist", allow: ["BOT_API_TOKEN"], deny: [] }
    });
    assert.equal(allowlisted.BOT_API_TOKEN, "file-token");
    const notAllowlisted = buildSandboxEnvFileInjection({
      ...settings,
      env: { inheritMode: "allowlist", allow: ["OTHER_KEY"], deny: [] }
    });
    assert.equal(notAllowlisted.BOT_API_TOKEN, undefined);
  } finally {
    if (previousPlain === undefined) delete process.env.PLAIN;
    else process.env.PLAIN = previousPlain;
    if (previousBotToken === undefined) delete process.env.BOT_API_TOKEN;
    else process.env.BOT_API_TOKEN = previousBotToken;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("sandbox diagnostics deny direct reads of the workspace env file", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-sandbox-diag-"));
  try {
    const settings = sanitizeToolSandboxSettings(defaultToolSandboxSettings);
    const diagnostics = await getToolSandboxDiagnostics(settings, workspaceDir);

    assert.equal(diagnostics.enabled, true);
    assert.equal(diagnostics.envFilePath.endsWith(".env"), true);
    assert.equal(diagnostics.effectiveFilesystem.denyRead.includes(diagnostics.envFilePath), true);
    assert.equal(diagnostics.effectiveFilesystem.denyWrite.includes(diagnostics.envFilePath), true);
    assert.deepEqual(diagnostics.envKeysMissing, []);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("pluggable sandbox provider dynamically intercepts sandbox execution", async () => {
  const originalProvider = getSandboxProvider();
  
  let initializedWithConfig: any = null;
  let wrappedCommand: string | null = null;
  
  const dummyProvider: SandboxProvider = {
    name: "dummy-test-sandbox",
    checkDependencies() {
      return true;
    },
    async initialize(config) {
      initializedWithConfig = config;
    },
    async reset() {},
    async wrapWithSandbox(command) {
      wrappedCommand = command;
      return `mocked-sandbox-exec ${command}`;
    },
    isInitialized() {
      return initializedWithConfig !== null;
    },
    getLastError() {
      return undefined;
    }
  };

  try {
    setSandboxProvider(dummyProvider);
    assert.equal(getSandboxProvider(), dummyProvider);

    const settings = sanitizeToolSandboxSettings({
      ...defaultToolSandboxSettings,
      enabled: true
    });

    const result = await prepareToolSandboxExecution({
      settings,
      cwd: "/mock-cwd",
      workspaceDir: "/mock-workspace",
      command: "echo hello",
      env: {}
    });

    assert.equal(result.sandboxApplied, true);
    assert.equal(result.command, "mocked-sandbox-exec echo hello");
    assert.equal(wrappedCommand, "echo hello");
    assert.ok(initializedWithConfig);
  } finally {
    setSandboxProvider(originalProvider);
  }
});

test("resolveEffectiveSandboxSettings correctly prioritizes scopes", () => {
  const mockSettings = {
    toolSandbox: {
      enabled: false,
      initFailureMode: "warn-disable",
      envFilePath: "",
      env: { inheritMode: "minimal", allow: [], deny: [] },
      network: { allowedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] }
    },
    channels: {
      telegram: {
        instances: [
          {
            id: "my_bot",
            name: "My Bot",
            enabled: true,
            agentId: "my_agent",
            credentials: {},
            allowedChatIds: [],
            sandboxEnabled: true
          }
        ]
      }
    },
    agents: [
      {
        id: "my_agent",
        name: "My Agent",
        description: "",
        enabled: true,
        sandboxEnabled: false
      }
    ]
  } as any;

  const getSettings = () => mockSettings;

  // Case 1: Global Default
  const res1 = resolveEffectiveSandboxSettings({ getSettings });
  assert.equal(res1.enabled, false);

  // Case 2: Agent Override
  const res2 = resolveEffectiveSandboxSettings({ getSettings, agentId: "my_agent" });
  assert.equal(res2.enabled, false);

  // Case 3: Bot Override
  const res3 = resolveEffectiveSandboxSettings({ getSettings, channel: "telegram", botId: "my_bot" });
  assert.equal(res3.enabled, true);

  // Case 4: Session Override
  const mockStore = {
    getSessionSandboxOverride: (chatId: string, sessionId: string) => false
  } as any;
  const res4 = resolveEffectiveSandboxSettings({
    getSettings,
    store: mockStore,
    chatId: "chat1",
    sessionId: "session1",
    channel: "telegram",
    botId: "my_bot"
  });
  assert.equal(res4.enabled, false);

  // Case 5: Session Override (true)
  const mockStoreTrue = {
    getSessionSandboxOverride: (chatId: string, sessionId: string) => true
  } as any;
  const res5 = resolveEffectiveSandboxSettings({
    getSettings,
    store: mockStoreTrue,
    chatId: "chat1",
    sessionId: "session1",
    channel: "telegram",
    botId: "my_bot"
  });
  assert.equal(res5.enabled, true);
});

test("Project sandbox override sits below Session and above Bot/global", () => {
  const settings = { toolSandbox: { ...defaultToolSandboxSettings, enabled: true }, channels: {}, agents: [] } as never;
  const store = { getSessionSandboxOverride: () => null } as never;
  assert.equal(resolveEffectiveSandboxSettings({ getSettings: () => settings, store, chatId: "c", sessionId: "s", projectOverride: false }).enabled, false);
  const sessionStore = { getSessionSandboxOverride: () => true } as never;
  assert.equal(resolveEffectiveSandboxSettings({ getSettings: () => settings, store: sessionStore, chatId: "c", sessionId: "s", projectOverride: false }).enabled, true);
});
