import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
const capabilities = JSON.parse(
  readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8")
);
const httpPermission = capabilities.permissions.find(
  (permission) => permission?.identifier === "http:default"
);
const allowedUrls = new Set(httpPermission?.allow?.map((entry) => entry.url) ?? []);

test("desktop HTTP scope allows reading and saving the shared system settings", () => {
  assert.ok(allowedUrls.has("http://127.0.0.1:*/api/settings/system"));
  assert.ok(allowedUrls.has("http://localhost:*/api/settings/system"));
  assert.match(appSource, /\$\{endpoint\}\/api\/settings\/system/);
  assert.equal(appSource.includes("`${endpoint}/api/settings`"), false);
  assert.match(appSource, /payload\.serverPort/);
});

test("desktop HTTP scope allows project registry and session routes", () => {
  assert.ok(allowedUrls.has("http://127.0.0.1:*/api/settings/projects*"));
  assert.ok(allowedUrls.has("http://localhost:*/api/settings/projects*"));
});
