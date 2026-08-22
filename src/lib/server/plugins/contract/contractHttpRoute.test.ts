import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { GET as listPlugins } from "../../../../routes/api/settings/plugins/contract/+server.js";
import { PUT as setPluginEnabled } from "../../../../routes/api/settings/plugins/contract/[pluginId]/enable/+server.js";

test("contract HTTP routes list an installed plugin and persist its enabled state through Runtime", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-plugin-route-"));
  const originalPaths = { ...storagePaths };
  const originalRuntime = (globalThis as any).__molibotRuntime;
  try {
    storagePaths.pluginsPackagesDir = path.join(root, "packages");
    storagePaths.pluginsConfigDir = path.join(root, "config");
    storagePaths.pluginsDataDir = path.join(root, "data");
    storagePaths.pluginsCacheDir = path.join(root, "cache");

    const packageDir = path.join(storagePaths.pluginsPackagesDir, "route-plugin");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
      name: "route-plugin",
      version: "1.0.0",
      molibot: {
        plugin: {
          manifestVersion: 1,
          id: "route-plugin",
          name: "Route Plugin",
          version: "1.0.0",
          engines: { molibot: ">=2.0.0" },
          config: { schemaVersion: 1 }
        }
      }
    }));

    let settings = structuredClone(defaultRuntimeSettings);
    (globalThis as any).__molibotRuntime = {
      settings,
      getSettings: () => settings,
      updateSettings: (patch: typeof settings) => {
        settings = { ...settings, ...patch };
        (globalThis as any).__molibotRuntime.settings = settings;
        return settings;
      }
    };

    const listResponse = await listPlugins({} as never);
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].id, "route-plugin");
    assert.equal(listBody.items[0].enabled, false);

    const enableResponse = await setPluginEnabled({
      params: { pluginId: "route-plugin" },
      request: new Request("http://localhost/api/settings/plugins/contract/route-plugin/enable", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true })
      })
    } as never);
    assert.equal(enableResponse.status, 200);
    assert.equal(settings.plugins.entries?.["route-plugin"]?.enabled, true);
  } finally {
    (globalThis as any).__molibotRuntime = originalRuntime;
    Object.assign(storagePaths, originalPaths);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
