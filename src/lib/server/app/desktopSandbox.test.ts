import assert from "node:assert/strict";
import test from "node:test";
import { defaultToolSandboxSettings } from "$lib/server/settings/toolSandbox";
import type { ToolSandboxDiagnostics } from "$lib/server/agent/tools/sandbox";
import { buildDesktopSandboxSummary, buildDesktopSandboxUpdate } from "./desktopSandbox";

function diagnostics(overrides: Partial<ToolSandboxDiagnostics> = {}): ToolSandboxDiagnostics {
  return {
    enabled: true,
    platform: "darwin",
    supportedPlatform: true,
    dependenciesAvailable: true,
    envFilePath: "/Users/example/.molibot/.env",
    envFileExists: true,
    envFileReadable: true,
    envKeysAvailable: ["SECRET_KEY", "PATH", "HOME"],
    envKeysInjected: ["PATH", "HOME"],
    envKeysDenied: ["SECRET_KEY"],
    envKeysMissing: [],
    sandboxInitialized: true,
    effectiveNetwork: defaultToolSandboxSettings.network,
    effectiveFilesystem: defaultToolSandboxSettings.filesystem,
    ...overrides
  };
}

test("buildDesktopSandboxSummary exposes editable policy but drops resolved absolute env paths and values", () => {
  const summary = buildDesktopSandboxSummary(defaultToolSandboxSettings, diagnostics());

  assert.equal(summary.enabled, true);
  assert.equal(summary.initFailureMode, "warn-disable");
  assert.equal(summary.envFilePath, ".env");
  assert.equal(summary.envFilePathConfiguredExternally, false);
  assert.equal(summary.env.inheritMode, "full");
  assert.deepEqual(summary.env.allow, []);
  assert.deepEqual(summary.env.deny, []);
  assert.deepEqual(summary.network.allowedDomains, ["*"]);
  assert.deepEqual(summary.filesystem.denyRead, ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"]);

  assert.equal(summary.diagnostics.supportedPlatform, true);
  assert.equal(summary.diagnostics.dependenciesAvailable, true);
  assert.equal(summary.diagnostics.sandboxInitialized, true);
  assert.equal(summary.diagnostics.sandboxError, null);
  assert.equal(summary.diagnostics.envKeysAvailable, 3);
  assert.equal(summary.diagnostics.envKeysInjected, 2);
  assert.equal(summary.diagnostics.envKeysDenied, 1);
  assert.equal(summary.diagnostics.envKeysMissing, 0);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(serialized.includes("SECRET_KEY"), false);
  assert.equal(serialized.includes("envKeysAvailable\""), true);
});

test("buildDesktopSandboxSummary hides an existing absolute env file setting without losing its configured state", () => {
  const summary = buildDesktopSandboxSummary(
    { ...defaultToolSandboxSettings, envFilePath: "/private/example/.env", env: { inheritMode: "allowlist", allow: ["OPENAI_API_KEY"], deny: ["MOLIBOT_*"] } },
    diagnostics()
  );

  assert.equal(summary.envFilePath, null);
  assert.equal(summary.envFilePathConfiguredExternally, true);
  assert.deepEqual(summary.env, { inheritMode: "allowlist", allow: ["OPENAI_API_KEY"], deny: ["MOLIBOT_*"] });
  assert.equal(JSON.stringify(summary).includes("/private/example"), false);
});

test("buildDesktopSandboxUpdate sanitizes full policy lists and preserves an omitted absolute env path", () => {
  const current = { ...defaultToolSandboxSettings, envFilePath: "/private/example/.env" };
  const updated = buildDesktopSandboxUpdate(current, {
    enabled: true,
    initFailureMode: "block",
    env: { inheritMode: "minimal", allow: [" OPENAI_API_KEY ", "OPENAI_API_KEY"], deny: ["MOLIBOT_*"] },
    network: { allowedDomains: ["github.com", "github.com"], deniedDomains: ["example.com"] },
    filesystem: { denyRead: ["~/.ssh"], allowWrite: ["scratch"], denyWrite: ["*.pem"] }
  });

  assert.equal(updated.envFilePath, "/private/example/.env");
  assert.equal(updated.initFailureMode, "block");
  assert.deepEqual(updated.env.allow, ["OPENAI_API_KEY"]);
  assert.deepEqual(updated.network.allowedDomains, ["github.com"]);
  assert.deepEqual(updated.filesystem.allowWrite, ["scratch"]);
});

test("buildDesktopSandboxUpdate accepts only project-relative env file replacements", () => {
  assert.equal(buildDesktopSandboxUpdate(defaultToolSandboxSettings, { envFilePath: "config/agent.env" }).envFilePath, "config/agent.env");
  assert.throws(() => buildDesktopSandboxUpdate(defaultToolSandboxSettings, { envFilePath: "/tmp/agent.env" }), /relative/);
  assert.throws(() => buildDesktopSandboxUpdate(defaultToolSandboxSettings, { envFilePath: "../agent.env" }), /relative/);
  assert.throws(() => buildDesktopSandboxUpdate(defaultToolSandboxSettings, { envFilePath: "~\/.env" }), /relative/);
});

test("buildDesktopSandboxSummary surfaces a sandbox error and missing env counts", () => {
  const summary = buildDesktopSandboxSummary(
    { ...defaultToolSandboxSettings, enabled: false },
    diagnostics({
      enabled: false,
      sandboxInitialized: false,
      sandboxError: "seatbelt not available",
      envKeysAvailable: [],
      envKeysMissing: ["FOO", "BAR"]
    })
  );

  assert.equal(summary.enabled, false);
  assert.equal(summary.diagnostics.sandboxInitialized, false);
  assert.equal(summary.diagnostics.sandboxError, "seatbelt not available");
  assert.equal(summary.diagnostics.envKeysMissing, 2);
});
