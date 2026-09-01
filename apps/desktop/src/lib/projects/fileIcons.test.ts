import { strict as assert } from "node:assert";
import test from "node:test";
import { fileIconKind, fileIconStyle } from "./fileIcons";

test("file icons keep semantic kinds and restore repository colours", () => {
  assert.equal(fileIconKind("app.ts", "file"), "code");
  assert.equal(fileIconStyle("app.ts", "file"), "--file-color: #3178c6;");
  assert.equal(fileIconKind("main.py", "file"), "code");
  assert.equal(fileIconStyle("main.py", "file"), "--file-color: #3776ab;");
});

test("special repository files win over their generic extension", () => {
  assert.equal(fileIconKind("README.md", "file"), "text");
  assert.equal(fileIconStyle("README.md", "file"), "--file-color: #0969da;");
  assert.equal(fileIconKind("package-lock.json", "file"), "lock");
  assert.equal(fileIconStyle("package-lock.json", "file"), "--file-color: #cb3837;");
});

test("directories and expanded state choose distinct kinds", () => {
  assert.equal(fileIconKind("src", "directory"), "folder");
  assert.equal(fileIconKind("src", "directory", true), "folder-open");
  assert.equal(fileIconStyle("src", "directory"), "--file-color: #54aeff;");
  assert.equal(fileIconStyle("notes.custom", "file"), "");
});
