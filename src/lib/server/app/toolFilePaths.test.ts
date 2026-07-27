import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolFileTarget } from "./toolFilePaths";

test("write and edit are recorded as mutating, read as non-mutating", () => {
  assert.deepEqual(resolveToolFileTarget("write", { path: "src/a.ts" }), { paths: ["src/a.ts"], mutates: true });
  assert.deepEqual(resolveToolFileTarget("edit", { path: "src/a.ts" }), { paths: ["src/a.ts"], mutates: true });
  assert.deepEqual(resolveToolFileTarget("read", { path: "src/a.ts" }), { paths: ["src/a.ts"], mutates: false });
});

test("tools without a file path argument record nothing", () => {
  assert.equal(resolveToolFileTarget("bash", { command: "ls" }), undefined);
  assert.equal(resolveToolFileTarget("write", {}), undefined);
  assert.equal(resolveToolFileTarget("write", { path: "   " }), undefined);
  assert.equal(resolveToolFileTarget("write", undefined), undefined);
});

test("paths that are not Project-relative are dropped rather than recorded misleadingly", () => {
  // These would never match a `git status` entry, so recording them would show
  // the user a "changed file" the panel can never open.
  assert.equal(resolveToolFileTarget("write", { path: "/etc/hosts" }), undefined);
  assert.equal(resolveToolFileTarget("write", { path: "~/notes.md" }), undefined);
  assert.equal(resolveToolFileTarget("write", { path: "../outside.ts" }), undefined);
  assert.equal(resolveToolFileTarget("write", { path: "src/../../escape.ts" }), undefined);
});

test("leading ./ and backslashes are normalized to the tree's path form", () => {
  assert.deepEqual(resolveToolFileTarget("edit", { path: "./src/a.ts" })?.paths, ["src/a.ts"]);
  assert.deepEqual(resolveToolFileTarget("edit", { path: "src\\lib\\a.ts" })?.paths, ["src/lib/a.ts"]);
});
