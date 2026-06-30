import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_RUNTIME_DEPENDENCIES,
  buildDesktopRuntimeDependency,
  buildDesktopRuntimeEnvSummary,
  detectRuntimeDependency,
  formatRuntimeInstallCommand,
  type RuntimeDependencySpec
} from "./desktopRuntimeEnv";

function spec(overrides: Partial<RuntimeDependencySpec> = {}): RuntimeDependencySpec {
  return {
    id: "ffmpeg",
    name: "ffmpeg",
    purpose: "Media encoding/decoding",
    brewFormula: "ffmpeg",
    estimatedSize: "~90 MB",
    installSource: "homebrew",
    versionArg: "-version",
    ...overrides
  };
}

test("formatRuntimeInstallCommand uses brew for homebrew deps and pip --target for tooling deps", () => {
  assert.equal(formatRuntimeInstallCommand(spec()), "brew install ffmpeg");
  assert.equal(
    formatRuntimeInstallCommand(spec({ installSource: "tooling", name: "some-pkg" })),
    "pip install --target ~/.molibot/tooling some-pkg"
  );
  assert.equal(
    formatRuntimeInstallCommand(spec({ installSource: "system", brewFormula: null })),
    ""
  );
});

test("detectRuntimeDependency reports missing when the resolver returns null", () => {
  const detection = detectRuntimeDependency(spec(), () => null);
  assert.equal(detection.status, "missing");
  assert.equal(detection.version, "");
  assert.equal(detection.source, "");
});

test("detectRuntimeDependency classifies homebrew vs system source from the resolved path", () => {
  const homebrew = detectRuntimeDependency(spec(), () => "/opt/homebrew/bin/ffmpeg");
  assert.equal(homebrew.source, "homebrew");

  const system = detectRuntimeDependency(spec(), () => "/usr/bin/ffmpeg");
  assert.equal(system.source, "system");
});

test("buildDesktopRuntimeDependency projects display fields and drops the resolved path", () => {
  const item = buildDesktopRuntimeDependency(
    spec(),
    { id: "ffmpeg", status: "installed", version: "ffmpeg version 7.0", source: "homebrew" }
  );
  assert.equal(item.name, "ffmpeg");
  assert.equal(item.status, "installed");
  assert.equal(item.version, "ffmpeg version 7.0");
  assert.equal(item.source, "homebrew");
  assert.equal(item.installCommand, "brew install ffmpeg");
  assert.equal(item.estimatedSize, "~90 MB");
  // The resolved binary path must never reach the WebView.
  assert.equal(JSON.stringify(item).includes("/opt/homebrew"), false);
  assert.equal(JSON.stringify(item).includes("/usr/bin"), false);
});

test("buildDesktopRuntimeDependency falls back to system source when detection source is blank", () => {
  const item = buildDesktopRuntimeDependency(
    spec(),
    { id: "ffmpeg", status: "missing", version: "", source: "" }
  );
  assert.equal(item.source, "system");
  assert.equal(item.status, "missing");
});

test("buildDesktopRuntimeEnvSummary counts installed/missing and preserves spec order", () => {
  const specs = [
    spec({ id: "ffmpeg", name: "ffmpeg" }),
    spec({ id: "git", name: "git", brewFormula: "git" }),
    spec({ id: "python3", name: "python3", brewFormula: "python@3.12" })
  ];
  const detections = [
    { id: "ffmpeg", status: "installed" as const, version: "ffmpeg 7", source: "homebrew" },
    { id: "git", status: "missing" as const, version: "", source: "" },
    { id: "python3", status: "unknown" as const, version: "", source: "system" }
  ];
  const summary = buildDesktopRuntimeEnvSummary(specs, detections);
  assert.deepEqual(summary.dependencies.map((d) => d.id), ["ffmpeg", "git", "python3"]);
  assert.equal(summary.counts.total, 3);
  assert.equal(summary.counts.installed, 1);
  assert.equal(summary.counts.missing, 1);
});

test("DESKTOP_RUNTIME_DEPENDENCIES declares ffmpeg, git, and python3 with no sudo or global npm", () => {
  const ids = DESKTOP_RUNTIME_DEPENDENCIES.map((d) => d.id);
  assert.deepEqual(ids, ["ffmpeg", "git", "python3"]);
  for (const dep of DESKTOP_RUNTIME_DEPENDENCIES) {
    const cmd = formatRuntimeInstallCommand(dep);
    assert.equal(cmd.includes("sudo"), false);
    assert.equal(cmd.includes("npm -g"), false);
  }
});
