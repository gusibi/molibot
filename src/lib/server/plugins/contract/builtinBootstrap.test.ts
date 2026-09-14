import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { ensureBuiltinPlugins, isBuiltinPackageId } from "./builtinBootstrap.js";

const BUILTIN_IDS = ["external-subagent", "trace-viewer", "cloudflare-html"];

function writePluginPackage(appRoot: string, id: string, version: string): void {
  const dir = path.join(appRoot, "package", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `@molibot/plugin-${id}`, version, private: true }),
    "utf8"
  );
}

test("builtin bootstrap stages packages, version-gates re-staging, and warns on missing sources", () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-builtin-app-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-builtin-data-"));
  const packagesRoot = path.join(dataRoot, "plugins", "packages");
  const originalPackagesDir = storagePaths.pluginsPackagesDir;
  const originalAppRoot = process.env.MOLIBOT_APP_ROOT;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    storagePaths.pluginsPackagesDir = packagesRoot;
    process.env.MOLIBOT_APP_ROOT = appRoot;

    // First boot: every source package is staged, no backups, no warnings.
    for (const id of BUILTIN_IDS) writePluginPackage(appRoot, id, "0.1.0");
    ensureBuiltinPlugins();
    for (const id of BUILTIN_IDS) {
      const staged = JSON.parse(fs.readFileSync(path.join(packagesRoot, id, "package.json"), "utf8"));
      assert.equal(staged.version, "0.1.0", `${id} should be staged on first boot`);
    }
    assert.deepEqual(fs.readdirSync(packagesRoot).filter((name) => name.includes(".backup-")), []);
    assert.equal(warnings.length, 0, "a complete bundle must not warn");

    // Same version on next boot: no re-copy, therefore no backup either.
    ensureBuiltinPlugins();
    assert.deepEqual(fs.readdirSync(packagesRoot).filter((name) => name.includes(".backup-")), []);

    // Version bump: target replaced and previous copy retained as backup.
    writePluginPackage(appRoot, "trace-viewer", "0.2.0");
    ensureBuiltinPlugins();
    const bumped = JSON.parse(fs.readFileSync(path.join(packagesRoot, "trace-viewer", "package.json"), "utf8"));
    assert.equal(bumped.version, "0.2.0");
    assert.equal(
      fs.readdirSync(packagesRoot).filter((name) => name.startsWith("trace-viewer.backup-")).length,
      1,
      "re-staging over an existing copy must keep a timestamped backup"
    );

    // Missing source package (stale release bundle): warn loudly, never throw.
    fs.rmSync(path.join(appRoot, "package", "cloudflare-html"), { recursive: true, force: true });
    warnings.length = 0;
    ensureBuiltinPlugins();
    assert.ok(
      warnings.some((message) => message.includes("cloudflare-html")),
      "a missing built-in source package must produce a warning naming the plugin"
    );
  } finally {
    console.warn = originalWarn;
    storagePaths.pluginsPackagesDir = originalPackagesDir;
    if (originalAppRoot === undefined) delete process.env.MOLIBOT_APP_ROOT;
    else process.env.MOLIBOT_APP_ROOT = originalAppRoot;
    fs.rmSync(appRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("isBuiltinPackageId recognizes staged built-ins and rejects unknown ids", () => {
  for (const id of BUILTIN_IDS) assert.equal(isBuiltinPackageId(id), true);
  assert.equal(isBuiltinPackageId("memory"), false);
  assert.equal(isBuiltinPackageId("some-external-plugin"), false);
});
