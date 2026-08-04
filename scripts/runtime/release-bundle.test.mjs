import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, "../..");
const entryPath = path.join(rootDir, "scripts/start-server.mjs");
const releaseScriptPath = path.join(rootDir, "bin/molibot-release.sh");

function relativeImports(filePath) {
  const source = readFileSync(filePath, "utf8");
  const specifiers = [];
  // Any relative `*.mjs` string literal counts: static `from "./x"`, dynamic
  // `import("./x")`, and a specifier passed through a helper all resolve to a
  // file the bundle must contain.
  const pattern = /["'](\.\.?\/[^"']+\.mjs)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const specifier of relativeImports(current)) {
      queue.push(path.resolve(path.dirname(current), specifier));
    }
  }
  seen.delete(entry);
  return [...seen];
}

// Regression guard for the v2.9.0 startup crash (issue #30): start-server.mjs
// imported scripts/runtime/crash-report.mjs, but bin/molibot-release.sh copied
// runtime modules by hand-written name, so the bundled service died at boot with
// ERR_MODULE_NOT_FOUND and the supervisor restart-looped forever.
test("every module start-server.mjs imports is packaged by the release bundle", () => {
  const closure = importClosure(entryPath);
  assert.ok(closure.length > 0, "expected start-server.mjs to have relative imports");

  const releaseScript = readFileSync(releaseScriptPath, "utf8");
  const copiesRuntimeGlob = releaseScript.includes('"$ROOT_DIR"/scripts/runtime/*.mjs');
  assert.ok(
    copiesRuntimeGlob,
    "bin/molibot-release.sh must copy scripts/runtime/*.mjs as a glob, never file-by-file",
  );

  for (const modulePath of closure) {
    assert.ok(existsSync(modulePath), `missing runtime module: ${modulePath}`);
    const relative = path.relative(rootDir, modulePath);
    assert.ok(
      relative.startsWith("scripts/runtime/") && !relative.includes("/", "scripts/runtime/".length),
      `${relative} is imported at startup but lives outside the packaged scripts/runtime directory`,
    );
    assert.ok(
      relative.endsWith(".mjs") && !relative.endsWith(".test.mjs"),
      `${relative} would be skipped by the release script's copy filter`,
    );
  }
});
