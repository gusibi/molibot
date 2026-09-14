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

test("untrusted runtime worker entry points are included by the runtime-module glob", () => {
  const releaseScript = readFileSync(releaseScriptPath, "utf8");
  assert.ok(releaseScript.includes('"$ROOT_DIR"/scripts/runtime/*.mjs'));
  for (const name of ["untrusted-miniapp-worker.mjs", "untrusted-pi-extension-worker.mjs"]) {
    assert.ok(existsSync(path.join(rootDir, "scripts", "runtime", name)), `missing packaged worker: ${name}`);
  }
});

test("desktop launcher raises the adapter body limit before loading the server", () => {
  const source = readFileSync(entryPath, "utf8");
  const bodyLimit = source.indexOf('process.env.BODY_SIZE_LIMIT ||= "12M"');
  const serverImport = source.indexOf('await import(path.join(releaseRoot, "build/index.js"))');
  assert.ok(bodyLimit >= 0, "10-second meeting audio chunks must fit through adapter-node");
  assert.ok(bodyLimit < serverImport, "BODY_SIZE_LIMIT must be set before adapter-node is imported");
});

// Regression guard for the v2.9.53 trace-viewer gap: builtinBootstrap.ts stages
// BUILTIN_PACKAGES from `<appRoot>/package/<id>`, but the release script copied
// its own hand-written subset, so staged built-in plugins were silently absent
// from every released bundle (the plugin never appeared on end-user machines).
test("every BUILTIN_PACKAGES entry is copied into the release bundle, and vice versa", () => {
  const bootstrapSource = readFileSync(
    path.join(rootDir, "src/lib/server/plugins/contract/builtinBootstrap.ts"),
    "utf8"
  );
  const builtinPackages = [...bootstrapSource.matchAll(/\{ id: "([a-z0-9-]+)", sourceRelative: "([^"]+)" \}/g)]
    .map((match) => ({ id: match[1], sourceRelative: match[2] }));
  assert.ok(builtinPackages.length > 0, "failed to parse BUILTIN_PACKAGES from builtinBootstrap.ts");

  for (const { id, sourceRelative } of builtinPackages) {
    assert.ok(
      existsSync(path.join(rootDir, sourceRelative)),
      `built-in plugin "${id}" source package is missing from the repo at ${sourceRelative}`
    );
  }

  const releaseScript = readFileSync(releaseScriptPath, "utf8");
  const loopMatch = releaseScript.match(/for plugin_package in ([a-z0-9- ]+); do/);
  assert.ok(loopMatch, "release script must copy built-in plugin packages via the plugin_package loop");
  const packaged = new Set(loopMatch[1].trim().split(/\s+/));

  for (const { id } of builtinPackages) {
    assert.ok(
      packaged.has(id),
      `built-in plugin "${id}" is staged by builtinBootstrap.ts but never copied into the release bundle; it will be missing on end-user machines`
    );
  }
  for (const id of packaged) {
    assert.ok(
      builtinPackages.some((pkg) => pkg.id === id),
      `release bundle copies plugin "${id}" but it is not in BUILTIN_PACKAGES; remove the stale release script entry`
    );
  }

  // The Docker image assembles its runtime stage independently of the release
  // script, so it needs its own copy of every built-in plugin package.
  const dockerfilePath = path.join(rootDir, "Dockerfile");
  const dockerfile = existsSync(dockerfilePath) ? readFileSync(dockerfilePath, "utf8") : "";
  assert.ok(dockerfile.length > 0, "Dockerfile must exist");
  for (const { id } of builtinPackages) {
    assert.ok(
      dockerfile.includes(`/app/package/${id}`),
      `built-in plugin "${id}" is not copied into the Docker runtime stage; the plugin will be missing in Docker deployments`
    );
  }
});
