import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import fixPath from "fix-path";

const here = dirname(fileURLToPath(import.meta.url));
const resolverPath = join(here, "..", "src", "resolver.ts");
const resolverSource = readFileSync(resolverPath, "utf8");

test("resolver.ts imports fix-path and calls fixPath() at module load", () => {
  // GUI app contexts (.app bundle on macOS, packaged Windows app) do not inherit
  // the user's shell PATH, so `npm`/`pnpm` resolve to ENOENT. fixPath() must run
  // at module load so findExecutableInPath, the pnpm probe, and the install
  // spawn all inherit the augmented PATH without each having to remember.
  assert.match(
    resolverSource,
    /import\s+fixPath\s+from\s+["']fix-path["']/,
    "resolver.ts must import fix-path"
  );
  assert.match(
    resolverSource,
    /\bfixPath\(\)/,
    "resolver.ts must call fixPath() so the side effect runs at import time"
  );
});

test("installProviderRuntime hands process.env to the child spawn", () => {
  // The spawn inside installProviderRuntime must propagate process.env (not a
  // hand-rolled env that drops PATH), otherwise fix-path's PATH augmentation
  // never reaches the child. This is the structural guarantee that makes the
  // fix above work.
  assert.match(
    resolverSource,
    /env:\s*process\.env/,
    "installProviderRuntime's spawn must use env: process.env so PATH propagates"
  );
});

test("fix-path is idempotent across repeated calls", () => {
  // fixPath() is invoked at module load; a second call must not corrupt the
  // PATH that was already augmented. Sanity check that the dependency is wired
  // up correctly and stays a no-op on platforms where it has nothing to do.
  const before = process.env.PATH;
  fixPath();
  fixPath();
  assert.equal(typeof process.env.PATH, "string");
  assert.ok(process.env.PATH, "PATH must remain populated after fixPath()");
  if (before) {
    // When the dep augments PATH, it prepends the user's shell PATH so the
    // shell value still appears. When it is a no-op (Linux terminal, etc.),
    // the value is unchanged. Either way the existing PATH must survive.
    assert.ok(
      process.env.PATH.length >= before.length,
      "PATH must not shrink after repeated fixPath() calls"
    );
  }
});
