import test from "node:test";
import assert from "node:assert/strict";
import { selectScope, uiGrepExpression } from "./selection.mjs";

test("desktop chat UI selects chat, approval and navigation tags", () => {
  const scope = selectScope(["apps/desktop/src/lib/chat/ChatComposerShell.svelte"]);
  assert.deepEqual(scope.uiTags.sort(), ["@approval", "@chat", "@navigation"]);
  assert.equal(scope.fullCore, false);
  assert.equal(scope.native, false);
});

test("agent runtime selects the full core regression", () => {
  const scope = selectScope(["src/lib/server/agent/core/runner.ts"]);
  assert.equal(scope.fullCore, true);
  assert.ok(scope.uiTags.includes("@chat"));
  assert.ok(scope.uiTags.includes("@approval"));
});

test("tauri and transport paths require native tests", () => {
  for (const path of [
    "apps/desktop/src-tauri/src/supervisor.rs",
    "src/lib/server/app/desktopHandshake.ts",
    "scripts/start-server.mjs",
    "scripts/runtime/service-lease.mjs"
  ]) {
    assert.equal(selectScope([path]).native, true, path);
  }
});

test("a test file next to a transport module does not require native tests", () => {
  const scope = selectScope(["apps/desktop/src/lib/api.test.ts"]);
  assert.equal(scope.native, false);
  assert.equal(scope.fallback, true);
});

test("settings paths select the settings tag and a round-trip", () => {
  const scope = selectScope(["src/lib/server/settings/store.ts", "apps/desktop/src/lib/settings/systemConfig.ts"]);
  assert.ok(scope.uiTags.includes("@settings"));
  assert.equal(scope.settingsRoundTrip, true);
});

test("an unmatched change falls back to smoke plus full core", () => {
  const scope = selectScope(["docs/requirements/feature-verification-spec.md"]);
  assert.equal(scope.fallback, true);
  assert.equal(scope.fullCore, true);
  assert.deepEqual(scope.uiTags, []);
});

test("no changes at all is the conservative fallback", () => {
  const scope = selectScope([]);
  assert.equal(scope.fallback, true);
  assert.equal(scope.fullCore, true);
});

test("an appended tag can only add to the selected set", () => {
  const scope = selectScope(["apps/desktop/src/lib/chat/ChatComposerShell.svelte"]);
  const grep = uiGrepExpression(scope, ["@settings"]);
  assert.ok(grep.includes("@chat"));
  assert.ok(grep.includes("@settings"));
  assert.ok(grep.startsWith("@smoke") || grep.split("|").includes("@smoke"));
});
