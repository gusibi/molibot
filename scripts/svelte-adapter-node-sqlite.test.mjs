import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { handlerReplacements, publishBuild } from "./svelte-adapter-node-sqlite.js";

test("replaces every runtime placeholder required by adapter-node handler", () => {
  const replacements = handlerReplacements(
    {
      config: { kit: { paths: { base: "/molibot" } } },
      prerendered: { paths: ["/", "/settings"] }
    },
    "APP_",
    true
  );

  assert.equal(replacements.BASE, '"/molibot"');
  assert.equal(replacements.PRERENDERED, 'new Set(["/","/settings"])');
});

test("publishing a rebuild keeps chunks required by the running server", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-adapter-publish-"));
  const output = path.join(root, "build");
  const staged = path.join(root, "staged");

  try {
    mkdirSync(path.join(output, "server/chunks"), { recursive: true });
    writeFileSync(path.join(output, "server/manifest.js"), "import('./chunks/old-route.js');\n");
    writeFileSync(path.join(output, "server/chunks/old-route.js"), "export const oldRoute = true;\n");

    mkdirSync(path.join(staged, "server/chunks"), { recursive: true });
    writeFileSync(path.join(staged, "server/manifest.js"), "import('./chunks/new-route.js');\n");
    writeFileSync(path.join(staged, "server/chunks/new-route.js"), "export const newRoute = true;\n");

    publishBuild(staged, output);

    assert.equal(existsSync(path.join(output, "server/chunks/old-route.js")), true);
    assert.equal(existsSync(path.join(output, "server/chunks/new-route.js")), true);
    assert.equal(readFileSync(path.join(output, "server/manifest.js"), "utf8"), "import('./chunks/new-route.js');\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a running manifest can lazy-load its chunk after publishing the next build", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-adapter-lazy-import-"));
  const output = path.join(root, "build");
  const staged = path.join(root, "staged");
  const oldChunk = "_server.ts-CzmUZn8-.js";

  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    mkdirSync(path.join(output, "server/chunks"), { recursive: true });
    writeFileSync(path.join(output, `server/chunks/${oldChunk}`), 'export const route = "old";');
    writeFileSync(
      path.join(output, "server/manifest.js"),
      `export const loadRoute = () => import("./chunks/${oldChunk}");`
    );

    const runningManifest = await import(pathToFileURL(path.join(output, "server/manifest.js")).href);

    mkdirSync(path.join(staged, "server/chunks"), { recursive: true });
    writeFileSync(path.join(staged, "server/chunks/new-route.js"), 'export const route = "new";');
    writeFileSync(path.join(staged, "server/manifest.js"), 'export const loadRoute = () => import("./chunks/new-route.js");');

    publishBuild(staged, output);

    assert.equal((await runningManifest.loadRoute()).route, "old");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the production build does not delete the live output before adapter publication", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.doesNotMatch(packageJson.scripts.build, /rmSync\(['"]build['"]|rm\s+-rf\s+[^&]*\bbuild\b/);
});
