import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "molibot-ext-install-"));

const { deriveExtensionId, installPiExtension, uninstallPiExtension, validatePiExtensionDir } =
  await import("$lib/server/plugins/piExtensions/install.js");
const { extensionInstallDir } = await import("$lib/server/plugins/piExtensions/paths.js");

test("install ids are derived from the spec and never escape the extensions root", () => {
  assert.equal(deriveExtensionId({ source: "npm", spec: "pi-ext-demo" }), "pi-ext-demo");
  assert.equal(deriveExtensionId({ source: "npm", spec: "pi-ext-demo@1.2.3" }), "pi-ext-demo");
  assert.equal(deriveExtensionId({ source: "npm", spec: "@scope/pi-ext-demo" }), "pi-ext-demo");
  assert.equal(deriveExtensionId({ source: "git", spec: "https://github.com/u/pi-ext-demo.git" }), "pi-ext-demo");
  assert.equal(deriveExtensionId({ source: "git", spec: "git@github.com:u/pi-ext-demo.git" }), "pi-ext-demo");

  // Explicit ids are validated, so a traversal attempt cannot pick the directory.
  assert.equal(deriveExtensionId({ source: "npm", spec: "x", id: "../evil" }), null);
  assert.equal(deriveExtensionId({ source: "npm", spec: "x", id: "a/b" }), null);
});

test("specs that are not a package name or a git URL are rejected before anything runs", async () => {
  const shellish = await installPiExtension({ source: "npm", spec: "demo; rm -rf /" });
  assert.equal(shellish.ok, false);
  assert.match(shellish.error!, /valid npm package spec/);

  const notAUrl = await installPiExtension({ source: "git", spec: "/etc/passwd" });
  assert.equal(notAUrl.ok, false);
  assert.match(notAUrl.error!, /valid git URL/);

  const empty = await installPiExtension({ source: "npm", spec: "   " });
  assert.equal(empty.ok, false);
  assert.match(empty.error!, /required/);
});

/**
 * The install gate must actually load the package: checking for an `index.js`
 * on disk is not enough, because nearly every npm package has one (`is-odd`
 * passed a file-only check and is obviously not a pi extension).
 */
test("only a package that loads and registers something passes validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-ext-validate-"));

  const real = join(root, "real");
  mkdirSync(real, { recursive: true });
  writeFileSync(
    join(real, "index.ts"),
    `import { Type } from "@sinclair/typebox";
export default function ext(pi: any) {
  pi.registerTool({
    name: "fixture_tool",
    label: "Fixture",
    description: "fixture",
    parameters: Type.Object({}),
    async execute() { return { content: [], details: {} }; }
  });
}
`,
    "utf8"
  );
  assert.deepEqual(await validatePiExtensionDir(real), { ok: true });

  // A plain npm package: loads, but its default export is not a pi factory.
  const notAnExtension = join(root, "not-an-extension");
  mkdirSync(notAnExtension, { recursive: true });
  writeFileSync(join(notAnExtension, "index.js"), "module.exports = function isOdd(n) { return n % 2 === 1; };\n", "utf8");
  const plain = await validatePiExtensionDir(notAnExtension);
  assert.equal(plain.ok, false);

  // Loads as a factory but registers nothing.
  const empty = join(root, "empty");
  mkdirSync(empty, { recursive: true });
  writeFileSync(join(empty, "index.ts"), "export default function ext(_pi: any) { /* nothing */ }\n", "utf8");
  const registersNothing = await validatePiExtensionDir(empty);
  assert.equal(registersNothing.ok, false);
  assert.match(registersNothing.error!, /registers no tools, events or commands/);

  // No entry point at all.
  const bare = join(root, "bare");
  mkdirSync(bare, { recursive: true });
  const noEntry = await validatePiExtensionDir(bare);
  assert.equal(noEntry.ok, false);
  assert.match(noEntry.error!, /No pi extension entry point/);
});

/**
 * Many pi extensions live in a monorepo, so the link people have points at a
 * subdirectory. Installing must clone the repo, take that one directory, and
 * name the install after the extension rather than after the monorepo.
 * Uses a local `file://` repo so no third-party code is downloaded.
 */
test("a monorepo subdirectory install takes only that directory", async () => {
  const repo = mkdtempSync(join(tmpdir(), "molibot-ext-monorepo-"));
  const pkg = join(repo, "packages", "pi-fixture");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "index.ts"),
    `import { Type } from "@sinclair/typebox";
export default function fixture(pi: any) {
  pi.registerTool({
    name: "monorepo_fixture_tool",
    label: "Fixture",
    description: "from a subdirectory",
    parameters: Type.Object({}),
    async execute() { return { content: [], details: {} }; }
  });
}
`,
    "utf8"
  );
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pi-fixture", version: "2.0.0" }), "utf8");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "monorepo-root", private: true }), "utf8");
  writeFileSync(join(repo, "unrelated.txt"), "should not be installed\n", "utf8");

  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "add", "-A"], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"],
    { stdio: "ignore" }
  );

  const result = await installPiExtension({
    source: "git",
    spec: `file://${repo}`,
    subdir: "packages/pi-fixture",
    ref: "main"
  });

  assert.equal(result.ok, true, result.error);
  // Named after the extension directory, not the monorepo root.
  assert.equal(result.id, "pi-fixture");

  const installed = extensionInstallDir("pi-fixture")!;
  assert.equal(existsSync(join(installed, "index.ts")), true);
  assert.equal(existsSync(join(installed, "unrelated.txt")), false, "the rest of the repo must not be installed");
  assert.equal(existsSync(join(installed, ".git")), false, "git metadata must not be installed");

  // A subdirectory that is not in the repository fails clearly.
  const missing = await installPiExtension({
    source: "git",
    spec: `file://${repo}`,
    subdir: "packages/not-there",
    ref: "main"
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error!, /no directory "packages\/not-there"/);

  // A branch that does not exist reports the branch, not just the URL.
  const badRef = await installPiExtension({
    source: "git",
    spec: `file://${repo}`,
    subdir: "packages/pi-fixture",
    ref: "nope"
  });
  assert.equal(badRef.ok, false);
  assert.match(badRef.error!, /branch nope/);
});

test("branch and subdirectory values that could reach git argv or a path join are rejected", async () => {
  const cases: Array<{ ref?: string; subdir?: string; pattern: RegExp }> = [
    { ref: "--upload-pack=touch /tmp/pwned", pattern: /valid git branch/ },
    { ref: "-x", pattern: /valid git branch/ },
    { subdir: "../../etc", pattern: /valid subdirectory/ },
    { subdir: "a/../../b", pattern: /valid subdirectory/ },
    { subdir: "", pattern: /valid subdirectory/ }
  ];

  for (const item of cases) {
    const result = await installPiExtension({
      source: "git",
      spec: "https://github.com/o/r.git",
      ...item
    });
    assert.equal(result.ok, false);
    assert.match(result.error!, item.pattern, `for ${JSON.stringify(item)}`);
  }
});

test("uninstall removes the install directory and refuses unsafe ids", () => {
  const dir = extensionInstallDir("removable")!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.ts"), "export default () => undefined;\n", "utf8");

  const removed = uninstallPiExtension("removable");
  assert.equal(removed.ok, true);
  assert.equal(existsSync(dir), false);

  assert.equal(uninstallPiExtension("removable").ok, false, "removing twice reports not installed");
  assert.equal(uninstallPiExtension("../escape").ok, false, "traversal is refused");
});
