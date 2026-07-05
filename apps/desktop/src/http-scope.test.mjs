import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capabilities = JSON.parse(
  readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8")
);
const httpPermission = capabilities.permissions.find(
  (permission) => permission?.identifier === "http:default"
);
const allowedUrls = new Set(httpPermission?.allow?.map((entry) => entry.url) ?? []);

test("desktop HTTP scope allows reading and saving the shared system settings", () => {
  assert.ok(allowedUrls.has("http://127.0.0.1:*/api/settings"));
  assert.ok(allowedUrls.has("http://localhost:*/api/settings"));
});
