import assert from "node:assert/strict";
import test from "node:test";
import { describeResolvedSpec, resolveExtensionInput } from "$lib/server/plugins/piExtensions/specResolver.js";

function resolved(input: string) {
  const result = resolveExtensionInput(input);
  assert.equal(result.ok, true, `expected ${input} to resolve, got: ${result.ok ? "" : result.error}`);
  return (result as { ok: true; resolved: any }).resolved;
}

function rejected(input: string) {
  const result = resolveExtensionInput(input);
  assert.equal(result.ok, false, `expected ${input} to be rejected`);
  return result as { ok: false; error: string; hint?: string };
}

test("bare npm package names resolve to an npm install", () => {
  assert.deepEqual(resolved("pi-subagents"), {
    source: "npm", spec: "pi-subagents", id: "pi-subagents", kind: "npm-name"
  });
  assert.deepEqual(resolved("pi-subagents@1.2.3"), {
    source: "npm", spec: "pi-subagents@1.2.3", id: "pi-subagents", kind: "npm-name"
  });
  // A scope belongs to the registry name, not to the install directory.
  assert.deepEqual(resolved("@ff-labs/pi-fff"), {
    source: "npm", spec: "@ff-labs/pi-fff", id: "pi-fff", kind: "npm-name"
  });
});

test("an npm page URL resolves to the package it shows", () => {
  assert.deepEqual(resolved("https://www.npmjs.com/package/pi-subagents"), {
    source: "npm", spec: "pi-subagents", id: "pi-subagents", kind: "npm-url"
  });
  assert.deepEqual(resolved("https://www.npmjs.com/package/@ff-labs/pi-fff"), {
    source: "npm", spec: "@ff-labs/pi-fff", id: "pi-fff", kind: "npm-url"
  });
  // `/v/<version>` is version navigation on the page, not part of the name.
  assert.deepEqual(resolved("https://www.npmjs.com/package/pi-subagents/v/0.37.0"), {
    source: "npm", spec: "pi-subagents@0.37.0", id: "pi-subagents", kind: "npm-url"
  });
});

test("repository URLs resolve to a clone, with or without .git", () => {
  assert.deepEqual(resolved("https://github.com/nicobailon/pi-subagents"), {
    source: "git", spec: "https://github.com/nicobailon/pi-subagents.git", id: "pi-subagents", kind: "git-url"
  });
  assert.deepEqual(resolved("https://github.com/nicobailon/pi-subagents.git"), {
    source: "git", spec: "https://github.com/nicobailon/pi-subagents.git", id: "pi-subagents", kind: "git-url"
  });
  assert.deepEqual(resolved("git@github.com:nicobailon/pi-subagents.git"), {
    source: "git", spec: "git@github.com:nicobailon/pi-subagents.git", id: "pi-subagents", kind: "git-ssh"
  });
  // Trailing slashes are what a copied browser URL usually carries.
  assert.equal(resolved("https://github.com/nicobailon/pi-subagents/").id, "pi-subagents");
});

/**
 * The case that motivated this resolver: many pi extensions live inside a
 * monorepo and the link people have points at the subdirectory.
 */
test("a monorepo subdirectory link keeps the branch, the path, and the extension's own name", () => {
  assert.deepEqual(resolved("https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff"), {
    source: "git",
    spec: "https://github.com/dmtrKovalenko/fff.git",
    subdir: "packages/pi-fff",
    ref: "main",
    id: "pi-fff",
    kind: "git-subdir"
  });

  // A file link (blob) points at the same directory in practice.
  assert.equal(
    resolved("https://github.com/ayu-exorcist/oh-my-pi/blob/main/extensions/pi-rewind/index.ts").subdir,
    "extensions/pi-rewind/index.ts"
  );

  // GitLab's /-/tree/ form.
  assert.deepEqual(resolved("https://gitlab.com/group/repo/-/tree/develop/packages/ext"), {
    source: "git",
    spec: "https://gitlab.com/group/repo.git",
    subdir: "packages/ext",
    ref: "develop",
    id: "ext",
    kind: "git-subdir"
  });

  // Repo root pinned to a branch: no subdirectory, ref preserved.
  const atBranch = resolved("https://github.com/owner/repo/tree/v2");
  assert.equal(atBranch.ref, "v2");
  assert.equal(atBranch.subdir, undefined);
});

test("unusable input is rejected with a hint instead of a clone failure later", () => {
  assert.match(rejected("").error, /Nothing to install/);
  assert.ok(rejected("https://example.com/justapage").hint, "a bare page URL should carry a hint");
  assert.match(rejected("https://github.com/owner/repo/issues/12").error, /which part of this URL/);
  assert.match(rejected("https://www.npmjs.com/").error, /package name/);
  assert.match(rejected("ftp://example.com/x/y").error, /Unsupported URL scheme/);
  // Path traversal. `new URL` normalizes both the literal `../` and the
  // percent-encoded `%2e%2e/` form, so those links stop looking like tree links
  // at all and are refused earlier. Encoded *slashes* are not normalized, so
  // that form is the one the explicit segment check has to catch.
  assert.equal(resolveExtensionInput("https://github.com/o/r/tree/main/../../etc").ok, false);
  assert.equal(resolveExtensionInput("https://github.com/o/r/tree/main/%2e%2e/%2e%2e/etc").ok, false);
  assert.match(rejected("https://github.com/o/r/tree/main/pkg%2f%2e%2e%2f%2e%2e").error, /Unsafe path/);
});

test("the resolved spec describes itself for a confirmation prompt", () => {
  assert.equal(describeResolvedSpec(resolved("pi-subagents")), "npm package pi-subagents");
  assert.equal(
    describeResolvedSpec(resolved("https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff")),
    "git https://github.com/dmtrKovalenko/fff.git, branch main, subdirectory packages/pi-fff"
  );
});
