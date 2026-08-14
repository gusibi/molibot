import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMiniAppInstaller } from "$lib/server/miniapps/install.js";
import { MiniAppError, type MiniAppInstallSource } from "$lib/server/miniapps/types.js";

/**
 * Mini App installation.
 *
 * The behaviour that matters externally: a valid app from any of the three
 * sources lands in the code root and records where it came from; a hostile or
 * malformed source never writes anything outside the staging area; and a failed
 * install leaves an existing installation exactly as it was.
 *
 * These tests do not reach the network — the GitHub path is exercised through
 * the `downloadArchive` seam with a real ZIP built on disk.
 */

interface Harness {
  root: string;
  codeRoot: string;
  sources: Record<string, MiniAppInstallSource>;
  requiresConsent: Record<string, boolean>;
}

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-install-"));
  const codeRoot = join(root, "apps");
  mkdirSync(codeRoot, { recursive: true });
  return { root, codeRoot, sources: {}, requiresConsent: {} };
}

function installerFor(harness: Harness, downloadArchive?: (url: string) => Promise<Buffer>) {
  return createMiniAppInstaller({
    codeRoot: harness.codeRoot,
    recordSource: (appId, source, detail) => {
      harness.sources[appId] = source;
      harness.requiresConsent[appId] = detail.requiresConsent;
    },
    downloadArchive
  });
}

const APP_SOURCE = `export default function create() {
  return {
    tools: { ping: async () => ({ content: [{ type: "text", text: "pong" }] }) },
    async handleHttp() { return { body: {} }; }
  };
}
`;

function manifestFor(id: string, version = "1.0.0", usesAi = false, usesHostAudio = false): string {
  return JSON.stringify({
    manifestVersion: 1,
    id,
    name: `${id} app`,
    version,
    engines: { molibot: ">=0.0.1" },
    runtime: { entry: "server/index.mjs" },
    ui: { entry: "ui/index.html" },
    data: { schemaVersion: 1 },
    ...(usesAi ? { ai: { capabilities: ["text"] } } : {}),
    ...(usesHostAudio ? { host: { capabilities: ["audioCapture"] } } : {}),
    tools: [{
      name: "ping",
      description: "Ping the app.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      readOnlyHint: true
    }]
  });
}

/** Writes a complete, valid app into `dir`. */
function writeAppInto(dir: string, id: string, version = "1.0.0", usesAi = false, usesHostAudio = false): void {
  mkdirSync(join(dir, "server"), { recursive: true });
  mkdirSync(join(dir, "ui"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), manifestFor(id, version, usesAi, usesHostAudio), "utf8");
  writeFileSync(join(dir, "server", "index.mjs"), APP_SOURCE, "utf8");
  writeFileSync(join(dir, "ui", "index.html"), "<!doctype html><title>app</title>", "utf8");
}

/** Builds a real ZIP with the system `zip`, so yauzl parses genuine output. */
function zipDirectory(sourceDir: string, zipPath: string, entryRoot = "."): void {
  // `-y` stores symlinks as symlinks. Without it `zip` follows them and the
  // archive carries plain files, which would silently void the symlink test.
  execFileSync("zip", ["-r", "-q", "-y", zipPath, entryRoot], { cwd: sourceDir });
}

test("installs from a local directory and records its provenance", async () => {
  const harness = makeHarness();
  const source = join(harness.root, "my-notes");
  writeAppInto(source, "notes");

  const result = await installerFor(harness).install({ source: "directory", path: source });

  assert.equal(result.appId, "notes");
  assert.equal(result.replaced, false);
  assert.ok(existsSync(join(harness.codeRoot, "notes", "server", "index.mjs")));
  assert.deepEqual(harness.sources.notes, { kind: "directory", label: "my-notes" });
  // Staging must leave nothing behind.
  assert.deepEqual(readdirSync(harness.codeRoot).filter((name) => name !== "notes"), []);
});

test("reports declared AI use to the enablement policy before a third-party app is activated", async () => {
  const harness = makeHarness();
  const source = join(harness.root, "ai-writer");
  writeAppInto(source, "ai-writer", "1.0.0", true);
  await installerFor(harness).install({ source: "directory", path: source });
  assert.equal(harness.requiresConsent["ai-writer"], true);
});

test("reports declared microphone use to the enablement policy before a third-party app is activated", async () => {
  const harness = makeHarness();
  const source = join(harness.root, "audio-recorder");
  writeAppInto(source, "audio-recorder", "1.0.0", false, true);
  await installerFor(harness).install({ source: "directory", path: source });
  assert.equal(harness.requiresConsent["audio-recorder"], true);
});

test("installs from a ZIP, including one wrapped in its own folder", async () => {
  const harness = makeHarness();
  const stage = join(harness.root, "stage");
  writeAppInto(join(stage, "notes-main"), "notes");
  const zipPath = join(harness.root, "notes.zip");
  zipDirectory(stage, zipPath, "notes-main");

  const result = await installerFor(harness).install({ source: "zip", path: zipPath });

  assert.equal(result.appId, "notes");
  assert.equal(readFileSync(join(harness.codeRoot, "notes", "server", "index.mjs"), "utf8"), APP_SOURCE);
  assert.deepEqual(harness.sources.notes, { kind: "zip", label: "notes.zip" });
});

test("installs from GitHub and records repo and ref", async () => {
  const harness = makeHarness();
  const stage = join(harness.root, "stage");
  // Mirrors GitHub's archive shape: everything under `<repo>-<ref>/`.
  writeAppInto(join(stage, "notes-v2.0.0"), "notes", "2.0.0");
  const zipPath = join(harness.root, "gh.zip");
  zipDirectory(stage, zipPath, "notes-v2.0.0");

  let requestedUrl = "";
  const result = await installerFor(harness, async (url) => {
    requestedUrl = url;
    return readFileSync(zipPath);
  }).install({ source: "github", repo: "someone/notes", ref: "v2.0.0" });

  assert.equal(requestedUrl, "https://codeload.github.com/someone/notes/zip/v2.0.0");
  assert.equal(result.appId, "notes");
  assert.deepEqual(harness.sources.notes, { kind: "github", repo: "someone/notes", ref: "v2.0.0" });
});

test("accepts a github.com URL and defaults the ref", async () => {
  const harness = makeHarness();
  const stage = join(harness.root, "stage");
  writeAppInto(join(stage, "notes-HEAD"), "notes");
  const zipPath = join(harness.root, "gh.zip");
  zipDirectory(stage, zipPath, "notes-HEAD");

  let requestedUrl = "";
  await installerFor(harness, async (url) => {
    requestedUrl = url;
    return readFileSync(zipPath);
  }).install({ source: "github", repo: "https://github.com/someone/notes.git" });

  assert.equal(requestedUrl, "https://codeload.github.com/someone/notes/zip/HEAD");
  assert.deepEqual(harness.sources.notes, { kind: "github", repo: "someone/notes", ref: "HEAD" });
});

test("a malformed repo or ref never reaches the network", async () => {
  const harness = makeHarness();
  let called = false;
  const installer = installerFor(harness, async () => {
    called = true;
    return Buffer.alloc(0);
  });

  for (const repo of ["", "notarepo", "../../etc", "owner/repo/extra", "owner/re po", "-bad/repo"]) {
    await assert.rejects(
      () => installer.install({ source: "github", repo }),
      (error: unknown) => error instanceof MiniAppError,
      `repo "${repo}" must be refused`
    );
  }
  for (const ref of ["../main", "a b", "main;rm -rf /", "-x"]) {
    await assert.rejects(
      () => installer.install({ source: "github", repo: "owner/repo", ref }),
      (error: unknown) => error instanceof MiniAppError,
      `ref "${ref}" must be refused`
    );
  }
  assert.equal(called, false, "a rejected repo/ref must not trigger a download");
});

test("an archive entry that escapes the extraction root is refused", async () => {
  const harness = makeHarness();
  const stage = join(harness.root, "stage");
  writeAppInto(join(stage, "app"), "notes");
  const zipPath = join(harness.root, "evil.zip");
  zipDirectory(stage, zipPath, "app");
  // Append a traversal entry the way a zip-slip archive would carry one.
  const outsideFile = join(harness.root, "payload.txt");
  writeFileSync(outsideFile, "pwned", "utf8");
  execFileSync("zip", ["-q", zipPath, "../payload.txt"], { cwd: stage });

  await assert.rejects(
    () => installerFor(harness).install({ source: "zip", path: zipPath }),
    (error: unknown) => error instanceof MiniAppError && /unsafe path/i.test(error.message)
  );
  assert.equal(existsSync(join(harness.codeRoot, "notes")), false, "nothing may be installed");
  assert.equal(readFileSync(outsideFile, "utf8"), "pwned", "the outside file must be untouched");
});

test("a symlink inside an archive is refused", async () => {
  const harness = makeHarness();
  const stage = join(harness.root, "stage", "app");
  writeAppInto(stage, "notes");
  symlinkSync("/etc/passwd", join(stage, "ui", "leak.txt"));
  const zipPath = join(harness.root, "link.zip");
  zipDirectory(join(harness.root, "stage"), zipPath, "app");

  await assert.rejects(
    () => installerFor(harness).install({ source: "zip", path: zipPath }),
    (error: unknown) => error instanceof MiniAppError && /symlink/i.test(error.message)
  );
});

test("a symlink inside a source directory is skipped rather than followed", async () => {
  const harness = makeHarness();
  const source = join(harness.root, "my-notes");
  writeAppInto(source, "notes");
  writeFileSync(join(harness.root, "secret.txt"), "top secret", "utf8");
  symlinkSync(join(harness.root, "secret.txt"), join(source, "ui", "secret.txt"));

  await installerFor(harness).install({ source: "directory", path: source });
  assert.equal(existsSync(join(harness.codeRoot, "notes", "ui", "secret.txt")), false);
});

test("a source without a valid Mini App manifest installs nothing", async () => {
  const harness = makeHarness();

  const noManifest = join(harness.root, "empty");
  mkdirSync(noManifest, { recursive: true });
  writeFileSync(join(noManifest, "readme.md"), "# not an app", "utf8");
  await assert.rejects(
    () => installerFor(harness).install({ source: "directory", path: noManifest }),
    (error: unknown) => error instanceof MiniAppError && /manifest\.json/i.test(error.message)
  );

  // A manifest that parses but fails full validation must also be refused —
  // otherwise a broken app reaches the code root and shows up as an error row.
  const badApp = join(harness.root, "bad");
  mkdirSync(badApp, { recursive: true });
  writeFileSync(
    join(badApp, "manifest.json"),
    JSON.stringify({ manifestVersion: 1, id: "bad", name: "bad", version: "not-semver" }),
    "utf8"
  );
  await assert.rejects(
    () => installerFor(harness).install({ source: "directory", path: badApp }),
    (error: unknown) => error instanceof MiniAppError && /not a valid Mini App/i.test(error.message)
  );

  assert.deepEqual(readdirSync(harness.codeRoot), []);
});

test("a failed reinstall leaves the previous version in place", async () => {
  const harness = makeHarness();
  const good = join(harness.root, "good");
  writeAppInto(good, "notes", "1.0.0");
  await installerFor(harness).install({ source: "directory", path: good });

  const broken = join(harness.root, "broken");
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "manifest.json"), JSON.stringify({ manifestVersion: 1, id: "notes" }), "utf8");
  await assert.rejects(() => installerFor(harness).install({ source: "directory", path: broken }));

  const surviving = JSON.parse(readFileSync(join(harness.codeRoot, "notes", "manifest.json"), "utf8"));
  assert.equal(surviving.version, "1.0.0", "the working install must survive a failed replace");
  assert.ok(existsSync(join(harness.codeRoot, "notes", "server", "index.mjs")));
});

test("reinstalling reports a replacement and swaps the code", async () => {
  const harness = makeHarness();
  const v1 = join(harness.root, "v1");
  writeAppInto(v1, "notes", "1.0.0");
  await installerFor(harness).install({ source: "directory", path: v1 });

  const v2 = join(harness.root, "v2");
  writeAppInto(v2, "notes", "2.0.0");
  const result = await installerFor(harness).install({ source: "directory", path: v2 });

  assert.equal(result.replaced, true);
  assert.equal(
    JSON.parse(readFileSync(join(harness.codeRoot, "notes", "manifest.json"), "utf8")).version,
    "2.0.0"
  );
});

test("installing from inside the code root is refused", async () => {
  const harness = makeHarness();
  const inside = join(harness.codeRoot, "notes");
  writeAppInto(inside, "notes");

  await assert.rejects(
    () => installerFor(harness).install({ source: "directory", path: inside }),
    (error: unknown) => error instanceof MiniAppError && /already inside/i.test(error.message)
  );
});

test("a source directory's .git and node_modules are not copied", async () => {
  const harness = makeHarness();
  const source = join(harness.root, "repo");
  writeAppInto(source, "notes");
  mkdirSync(join(source, ".git"), { recursive: true });
  writeFileSync(join(source, ".git", "config"), "[core]", "utf8");
  mkdirSync(join(source, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(source, "node_modules", "left-pad", "index.js"), "module.exports=1", "utf8");

  await installerFor(harness).install({ source: "directory", path: source });
  assert.equal(existsSync(join(harness.codeRoot, "notes", ".git")), false);
  assert.equal(existsSync(join(harness.codeRoot, "notes", "node_modules")), false);
});

test("a non-ZIP file is rejected with a readable message", async () => {
  const harness = makeHarness();
  const notZip = join(harness.root, "notes.zip");
  writeFileSync(notZip, "this is definitely not a zip archive", "utf8");

  await assert.rejects(
    () => installerFor(harness).install({ source: "zip", path: notZip }),
    (error: unknown) => error instanceof MiniAppError && /ZIP/i.test(error.message)
  );
});

test("a missing source path is a clear error, not a crash", async () => {
  const harness = makeHarness();
  const installer = installerFor(harness);
  await assert.rejects(
    () => installer.install({ source: "directory", path: join(harness.root, "nope") }),
    (error: unknown) => error instanceof MiniAppError && /does not exist/i.test(error.message)
  );
  await assert.rejects(
    () => installer.install({ source: "zip", path: join(harness.root, "nope.zip") }),
    (error: unknown) => error instanceof MiniAppError && /does not exist/i.test(error.message)
  );
});
