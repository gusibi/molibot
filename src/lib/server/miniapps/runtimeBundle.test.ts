import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bundleMiniAppRuntime } from "./runtimeBundle.js";

test("a changed relative module produces a fresh importable runtime bundle", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const serverDir = join(root, "app", "server");
  const cacheRoot = join(root, "cache");
  mkdirSync(serverDir, { recursive: true });
  const entryPath = join(serverDir, "index.mjs");
  const valuePath = join(serverDir, "value.mjs");
  writeFileSync(entryPath, 'import { value } from "./value.mjs"; export default () => value;\n', "utf8");
  writeFileSync(valuePath, 'export const value = "first";\n', "utf8");

  const first = await bundleMiniAppRuntime({ appId: "notes", entryPath, cacheRoot });
  assert.equal((await import(first.moduleUrl)).default(), "first");

  writeFileSync(valuePath, 'export const value = "second";\n', "utf8");
  const second = await bundleMiniAppRuntime({ appId: "notes", entryPath, cacheRoot });
  assert.notEqual(second.contentHash, first.contentHash);
  assert.notEqual(second.moduleUrl, first.moduleUrl);
  assert.equal((await import(second.moduleUrl)).default(), "second");
});

test("identical source reuses the content-addressed bundle file with a fresh module scope", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const serverDir = join(root, "app", "server");
  mkdirSync(serverDir, { recursive: true });
  const entryPath = join(serverDir, "index.mjs");
  writeFileSync(entryPath, "let loads = 0; loads += 1; export default () => loads;\n", "utf8");

  const first = await bundleMiniAppRuntime({ appId: "notes", entryPath, cacheRoot: join(root, "cache") });
  const second = await bundleMiniAppRuntime({ appId: "notes", entryPath, cacheRoot: join(root, "cache") });

  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.moduleUrl, second.moduleUrl, "each activation needs a fresh ESM module scope");
  assert.equal((await import(first.moduleUrl)).default(), 1);
  assert.equal((await import(second.moduleUrl)).default(), 1);
});

test("app-local packages keep working after the bundle moves into the host cache", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = join(root, "app");
  const serverDir = join(appRoot, "server");
  const dependencyDir = join(appRoot, "node_modules", "miniapp-value");
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(dependencyDir, { recursive: true });
  writeFileSync(join(dependencyDir, "package.json"), '{"type":"module","exports":"./index.mjs"}\n', "utf8");
  writeFileSync(join(dependencyDir, "index.mjs"), 'export default "from-package";\n', "utf8");
  const entryPath = join(serverDir, "index.mjs");
  writeFileSync(entryPath, 'import value from "miniapp-value"; export default () => value;\n', "utf8");

  const bundle = await bundleMiniAppRuntime({ appId: "notes", entryPath, cacheRoot: join(root, "cache") });
  assert.equal((await import(bundle.moduleUrl)).default(), "from-package");
});
