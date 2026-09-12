// Machine guard for Recurring Pitfall (CLAUDE.md): the desktop webview origin
// is Tauri's custom protocol while the sidecar API is http://127.0.0.1:<port>,
// so a raw `fetch` from UI code is a cross-origin request and the sidecar sends
// no CORS headers — preflighted calls fail with a confusing generic error and
// even GET responses are unreadable inside the app. All API requests must go
// through `lib/api.ts`, whose transport switches to the Tauri HTTP plugin
// (Rust-side request) inside the webview. Shipped bug: "执行与权限" settings
// save always failed in the desktop app while curl/browser tests passed
// (2026-09-12). `lib/api.ts` is the only place allowed to touch fetch directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const isSource = /\.(svelte|ts|js|mjs)$/.test(entry.name);
    const isTest = /\.test\./.test(entry.name);
    return isSource && !isTest ? [path] : [];
  });
}

// A bare `fetch(` not owned by an object (`foo.fetch(`) and not the sanctioned
// `fetchFromDesktop`/`tauriFetch` helpers; plus `globalThis.fetch`/`window.fetch`.
const BARE_FETCH = /(^|[^\w.$])fetch\s*\(/;
const MEMBER_FETCH = /(globalThis|window)\.fetch\s*\(/;

test("no UI code calls fetch directly; API requests go through lib/api.ts", () => {
  const offenders = [];
  for (const file of sourceFiles(srcRoot)) {
    if (file.endsWith(join("lib", "api.ts"))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if ((BARE_FETCH.test(line) || MEMBER_FETCH.test(line)) && !line.includes("transport-guard-ok")) {
        offenders.push(`${file.slice(srcRoot.length)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Raw fetch from the webview is cross-origin to the sidecar and fails in the desktop app; add a helper in lib/api.ts (requestJson/fetchFromDesktop) instead:\n${offenders.join("\n")}`
  );
});
