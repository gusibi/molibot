import assert from "node:assert/strict";
import test from "node:test";
import { resolveMcpAuthConfig } from "./mcpAuth.js";

test("MCP auth defaults to manual headers and keeps stdio header mode", () => {
  assert.deepEqual(resolveMcpAuthConfig("http", {}, { Authorization: "Bearer token" }), {
    mode: "headers",
    oauth: { authServerMetadataUrl: "", clientName: "" }
  });
  assert.equal(resolveMcpAuthConfig("stdio", { auth: { mode: "oauth" } }, {}).mode, "headers");
});

test("selecting OAuth drops a manual Authorization header and keeps other headers", () => {
  const headers: Record<string, string> = { authorization: "Bearer token", "X-Tenant": "acme" };
  const auth = resolveMcpAuthConfig("http", {
    auth: { mode: "oauth", oauth: { authServerMetadataUrl: "https://auth.example.com/meta", clientName: "Molibot" } }
  }, headers);
  assert.equal(auth.mode, "oauth");
  assert.deepEqual(headers, { "X-Tenant": "acme" });
  assert.deepEqual(auth.oauth, { authServerMetadataUrl: "https://auth.example.com/meta", clientName: "Molibot" });
});
