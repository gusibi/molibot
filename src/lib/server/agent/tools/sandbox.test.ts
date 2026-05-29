import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultToolSandboxSettings, sanitizeToolSandboxSettings } from "$lib/server/settings/toolSandbox.js";
import {
  buildToolSandboxEnv,
  getToolSandboxDiagnostics
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

test("sandbox diagnostics deny direct reads of the workspace env file", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-sandbox-diag-"));
  try {
    const settings = sanitizeToolSandboxSettings(defaultToolSandboxSettings);
    const diagnostics = await getToolSandboxDiagnostics(settings, workspaceDir);

    assert.equal(diagnostics.enabled, true);
    assert.equal(diagnostics.envFilePath.endsWith(".env.sandbox.local"), true);
    assert.equal(diagnostics.effectiveFilesystem.denyRead.includes(diagnostics.envFilePath), true);
    assert.equal(diagnostics.effectiveFilesystem.denyWrite.includes(diagnostics.envFilePath), true);
    assert.deepEqual(diagnostics.envKeysMissing, []);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
