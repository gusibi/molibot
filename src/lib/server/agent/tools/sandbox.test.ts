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
  sandboxInfrastructureKey,
  type SandboxProvider
} from "$lib/server/agent/tools/sandbox.js";

test("sanitizeToolSandboxSettings keeps safe defaults for invalid input", () => {
  const settings = sanitizeToolSandboxSettings({
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

  assert.equal(settings.envFilePath, defaultToolSandboxSettings.envFilePath);
  assert.deepEqual(settings.env.allow, ["OPENAI_API_KEY", "TAVILY_API_KEY"]);
  assert.deepEqual(settings.env.deny, ["MOLIBOT_*"]);
  assert.deepEqual(settings.network.allowedDomains, ["example.com", "api.example.com"]);
  assert.deepEqual(settings.filesystem.denyWrite, ["*.key"]);

  const override = sanitizeToolSandboxSettings(
    { env: { inheritMode: "minimal" } },
    {
      ...defaultToolSandboxSettings,
      env: { ...defaultToolSandboxSettings.env, inheritMode: "full" }
    }
  );
  assert.equal(override.env.inheritMode, "minimal");
});

test("the default sandbox network posture is unrestricted and obsolete controls are dropped", () => {
  // Unified execution modes: the sandbox participates by mode, not by a saved
  // switch, and ordinary package downloads need no domain list. Persisted
  // `enabled`/`initFailureMode` fields from the removed controls are dropped
  // by the sanitizer on both save and load.
  assert.deepEqual(defaultToolSandboxSettings.network, { allowedDomains: ["*"], deniedDomains: [] });
  const stale = sanitizeToolSandboxSettings({
    ...defaultToolSandboxSettings,
    enabled: false,
    initFailureMode: "warn-disable"
  } as never);
  assert.equal("enabled" in stale, false);
  assert.equal("initFailureMode" in stale, false);
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

test("buildSandboxEnvFileInjection exposes only policy-allowed file-only secrets for host execution", () => {
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
      envFilePath: join(workspaceDir, ".env.sandbox.local"),
      env: {
        inheritMode: "full",
        allow: [],
        deny: ["TELEGRAM_*"]
      }
    });

    const injection = buildSandboxEnvFileInjection(settings);
    // File-only secret is injected so host execution (full access or the
    // sandbox-denial fallback) can reach it.
    assert.equal(injection.BOT_API_TOKEN, "file-token");
    // Denied keys never leak to the host.
    assert.equal(injection.TELEGRAM_BOT_TOKEN, undefined);
    // Keys already in the parent process env are skipped (host inherits them).
    assert.equal(injection.PLAIN, undefined);

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

    const settings = sanitizeToolSandboxSettings(defaultToolSandboxSettings);

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

test("sandbox network keeps loopback reachable despite upstream NO_PROXY bypass", async () => {
  const originalProvider = getSandboxProvider();

  let initializedWithConfig: any = null;
  const capturingProvider: SandboxProvider = {
    name: "capture-loopback-sandbox",
    checkDependencies() {
      return true;
    },
    async initialize(config) {
      initializedWithConfig = config;
    },
    async reset() {},
    async wrapWithSandbox(command) {
      return command;
    },
    isInitialized() {
      return initializedWithConfig !== null;
    },
    getLastError() {
      return undefined;
    }
  };

  try {
    setSandboxProvider(capturingProvider);
    await prepareToolSandboxExecution({
      settings: sanitizeToolSandboxSettings(defaultToolSandboxSettings),
      cwd: "/mock-cwd",
      workspaceDir: "/mock-workspace",
      command: "curl http://localhost:5040/health",
      env: {}
    });
    // The upstream runtime always injects NO_PROXY=localhost,127.0.0.1,::1, so
    // HTTP clients connect to loopback directly and the seatbelt profile must
    // allow that — otherwise every localhost service fails with
    // "Couldn't connect to server" even while running.
    assert.equal(initializedWithConfig.network.allowLocalBinding, true);
  } finally {
    setSandboxProvider(originalProvider);
  }
});

test("the sandbox backend fails closed when its provider is unavailable", async () => {
  const originalProvider = getSandboxProvider();
  const unavailableProvider: SandboxProvider = {
    name: "missing-test-sandbox",
    checkDependencies() {
      return false;
    },
    async initialize() {},
    async reset() {},
    async wrapWithSandbox(command) {
      return command;
    },
    isInitialized() {
      return false;
    },
    getLastError() {
      return "dependencies missing";
    }
  };

  try {
    setSandboxProvider(unavailableProvider);
    await assert.rejects(
      prepareToolSandboxExecution({
        settings: defaultToolSandboxSettings,
        cwd: "/mock-cwd",
        workspaceDir: "/mock-workspace",
        command: "echo must-not-run",
        env: {}
      }),
      /Sandbox unavailable: Sandbox dependencies are missing\./
    );
  } finally {
    setSandboxProvider(originalProvider);
  }
});

test("sandbox defaults keep the minimal env-inheritance posture", () => {
  assert.equal(defaultToolSandboxSettings.env.inheritMode, "minimal");
});

test("sandboxInfrastructureKey varies only with manager-global state", () => {
  // Two environment handles in the same runtime differ by workspace paths and
  // domain lists — those must NOT reset the shared manager (and never run the
  // second handle under the first one's init). Only static profile knobs and
  // proxy presence are manager-global.
  const workspaceA = "/tmp/ws-a/scratch";
  const workspaceB = "/tmp/ws-b/scratch";
  const domainsA = ["example.com"];
  const base = {
    network: { allowedDomains: ["*"], deniedDomains: [], allowLocalBinding: true },
    filesystem: { denyRead: [] as string[], allowWrite: [workspaceA], denyWrite: [] as string[] }
  };
  const handleA = { ...base, filesystem: { ...base.filesystem, allowWrite: [workspaceA] } };
  const handleB = {
    ...base,
    network: { allowedDomains: domainsA, deniedDomains: [], allowLocalBinding: true },
    filesystem: { ...base.filesystem, allowWrite: [workspaceB] }
  };
  assert.equal(sandboxInfrastructureKey(handleA), sandboxInfrastructureKey(handleB), "per-handle differences must not change the infrastructure key");

  assert.notEqual(
    sandboxInfrastructureKey({ ...base, network: { ...base.network, allowLocalBinding: false } }),
    sandboxInfrastructureKey(base),
    "static profile knobs are manager-global"
  );
  assert.notEqual(
    sandboxInfrastructureKey({ ...base, network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: true } }),
    sandboxInfrastructureKey(base),
    "proxy presence is manager-global"
  );
});

test("prepareToolSandboxExecution hands the environment's own config to the provider wrap", async () => {
  // Regression (unified execution modes review): the second concurrent handle
  // used to wait out the first one's initialization and wrap under its config.
  // The provider contract now receives the calling handle's config so the SDK
  // bakes it into that command alone.
  const originalProvider = getSandboxProvider();
  const wrappedWith: Array<unknown> = [];
  const capturingProvider: SandboxProvider = {
    name: "capture-config-sandbox",
    checkDependencies: () => true,
    async initialize() {},
    async reset() {},
    async wrapWithSandbox(command, options) {
      wrappedWith.push(options?.config);
      return command;
    },
    isInitialized: () => true,
    getLastError: () => undefined
  };
  try {
    setSandboxProvider(capturingProvider);
    const settings = {
      ...defaultToolSandboxSettings,
      filesystem: { ...defaultToolSandboxSettings.filesystem, allowWrite: ["/tmp/handle-b"] }
    };
    await prepareToolSandboxExecution({
      settings,
      cwd: "/tmp/handle-b-cwd",
      workspaceDir: "/tmp/handle-b-ws",
      command: "echo hi",
      env: {}
    });
    assert.equal(wrappedWith.length, 1);
    const config = wrappedWith[0] as { filesystem: { allowWrite: string[] } };
    assert.ok(config.filesystem.allowWrite.includes("/tmp/handle-b-cwd"), "the wrap config belongs to this handle");
    assert.ok(config.filesystem.allowWrite.includes("/tmp/handle-b"), "and carries this handle's settings");
  } finally {
    setSandboxProvider(originalProvider);
  }
});
