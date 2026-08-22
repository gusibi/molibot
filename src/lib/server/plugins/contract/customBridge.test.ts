import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { handlePluginUiRequest } from "./uiRoute.js";
import { invokePluginSettingsAction } from "./actionHost.js";
import { resetPluginConfigStoreForTests } from "./configStore.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { parsePluginToHostMessage } from "$lib/shared/pluginBridge.js";

/**
 * Slice 3 test suite:
 * 1. UI asset serving & CSP headers & path traversal guards
 * 2. Fault domain settings action execution (progress, result, timeout, error)
 * 3. Invocation-time disable guard
 */

test("plugin bridge rejects malformed, oversized, and invalid action messages", () => {
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:get_settings", correlationId: "request_1" })?.type, "molibot:plugin:get_settings");
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:invoke_action", correlationId: "request_2", action: "../../escape" }), null);
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:save_settings", correlationId: "request_3", values: "bad" }), null);
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:save_settings", correlationId: "request_4", values: { payload: "x".repeat(300_000) } }), null);
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:resize", correlationId: "resize_1", height: 684 })?.type, "molibot:plugin:resize");
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:resize", correlationId: "resize_2", height: -1 }), null);
  assert.equal(parsePluginToHostMessage({ type: "molibot:plugin:resize", correlationId: "resize_3", height: 100_000 }), null);
});

test("uiRoute: serves static assets with security headers and prevents traversal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-ui-route-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsPackagesDir = path.join(root, "packages");
    storagePaths.pluginsConfigDir = path.join(root, "config");
    storagePaths.pluginsDataDir = path.join(root, "data");
    storagePaths.pluginsCacheDir = path.join(root, "cache");

    const pkgDir = path.join(storagePaths.pluginsPackagesDir, "ui-test-plugin");
    const uiDir = path.join(pkgDir, "ui");
    fs.mkdirSync(uiDir, { recursive: true });

    fs.writeFileSync(path.join(uiDir, "index.html"), "<!DOCTYPE html><html><body><h1>Settings</h1></body></html>");
    fs.writeFileSync(path.join(uiDir, "style.css"), "body { color: red; }");
    fs.writeFileSync(path.join(uiDir, "icon.svg"), "<svg></svg>");

    // Secret file outside ui/
    fs.writeFileSync(path.join(pkgDir, "secret.key"), "should-not-leak");

    // 1. Successful HTML fetch with CSP header
    const htmlRes = handlePluginUiRequest("ui-test-plugin", "index.html");
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(htmlRes.headers.get("cache-control"), "no-store");
    assert.notEqual(htmlRes.headers.get("content-security-policy"), null);
    assert.match(htmlRes.headers.get("content-security-policy")!, /frame-ancestors/);

    const htmlText = await htmlRes.text();
    assert.match(htmlText, /<h1>Settings<\/h1>/);

    // 2. CSS fetch
    const cssRes = handlePluginUiRequest("ui-test-plugin", "style.css");
    assert.equal(cssRes.status, 200);
    assert.equal(cssRes.headers.get("content-type"), "text/css; charset=utf-8");

    // 3. Traversal attempt outside ui/ is blocked (400 or 404)
    const escapeRes = handlePluginUiRequest("ui-test-plugin", "../secret.key");
    assert.equal(escapeRes.status >= 400, true);

    // 4. Missing asset
    const missingRes = handlePluginUiRequest("ui-test-plugin", "missing.js");
    assert.equal(missingRes.status, 404);
  } finally {
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("actionHost: executes settings runtime actions in isolated worker process", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-action-test-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsPackagesDir = path.join(root, "packages");
    storagePaths.pluginsConfigDir = path.join(root, "config");
    storagePaths.pluginsDataDir = path.join(root, "data");
    storagePaths.pluginsCacheDir = path.join(root, "cache");
    resetPluginConfigStoreForTests();

    const pkgDir = path.join(storagePaths.pluginsPackagesDir, "action-plugin");
    fs.mkdirSync(pkgDir, { recursive: true });

    // Runtime module that exports actions
    const runtimeCode = `
      export async function detectEnv(input, ctx) {
        ctx.emitProgress({ step: "checking", percent: 50 });
        return { detected: true, version: "v1.2.3", configReceived: ctx.config };
      }
      export async function failAction(input, ctx) {
        throw new Error("Deliberate failure in action");
      }
      export async function hangAction(input, ctx) {
        await new Promise(r => setTimeout(r, 5000));
        return { done: true };
      }
    `;
    fs.writeFileSync(path.join(pkgDir, "runtime.mjs"), runtimeCode, "utf8");

    const pkg = {
      name: "action-plugin",
      version: "1.0.0",
      molibot: {
        plugin: {
          manifestVersion: 1,
          id: "action-plugin",
          name: "Action Plugin",
          version: "1.0.0",
          engines: { molibot: ">=2.0.0" },
          config: { schemaVersion: 1 },
          runtime: { entry: "runtime.mjs", actions: ["detectEnv", "failAction", "hangAction"] },
          settings: {
            mode: "custom",
            ui: { entry: "ui/index.html" }
          }
        }
      }
    };
    fs.mkdirSync(path.join(pkgDir, "ui"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "ui", "index.html"), "<h1>UI</h1>");
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg), "utf8");

    const progressReports: any[] = [];
    const settings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "action-plugin": { enabled: true }
        }
      }
    };

    // 1. Success execution with progress
    const res = await invokePluginSettingsAction({
      pluginId: "action-plugin",
      action: "detectEnv",
      input: { foo: "bar" },
      settings,
      onProgress: (p) => progressReports.push(p)
    });

    assert.equal(res.ok, true);
    assert.equal((res.result as any)?.detected, true);
    assert.equal((res.result as any)?.version, "v1.2.3");
    assert.equal(progressReports.length, 1);
    assert.equal(progressReports[0]?.percent, 50);

    // 2. Failure containment (child error does not crash host)
    const failRes = await invokePluginSettingsAction({
      pluginId: "action-plugin",
      action: "failAction",
      settings
    });
    assert.equal(failRes.ok, false);
    assert.match(failRes.error || "", /Deliberate failure in action/);

    // 3. Timeout enforcement (deadline cancels and cleans up)
    const hangRes = await invokePluginSettingsAction({
      pluginId: "action-plugin",
      action: "hangAction",
      settings,
      timeoutMs: 150
    });
    assert.equal(hangRes.ok, false);
    assert.match(hangRes.error || "", /timed out/);

    // 4. Invocation-time disable guard
    const disabledSettings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "action-plugin": { enabled: false }
        }
      }
    };
    const disabledRes = await invokePluginSettingsAction({
      pluginId: "action-plugin",
      action: "detectEnv",
      settings: disabledSettings
    });
    assert.equal(disabledRes.ok, false);
    assert.match(disabledRes.error || "", /is disabled/);

    const undeclaredRes = await invokePluginSettingsAction({
      pluginId: "action-plugin",
      action: "notDeclared",
      settings
    });
    assert.equal(undeclaredRes.ok, false);
    assert.match(undeclaredRes.error || "", /not declared/);

    const absentEnablementRes = await invokePluginSettingsAction({
      pluginId: "action-plugin",
      action: "detectEnv",
      settings: defaultRuntimeSettings
    });
    assert.equal(absentEnablementRes.ok, false);
    assert.match(absentEnablementRes.error || "", /is disabled/);
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
