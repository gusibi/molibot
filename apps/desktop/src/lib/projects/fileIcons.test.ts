import { strict as assert } from "node:assert";
import test from "node:test";
import { fileIconName, fileIconStyle } from "./fileIcons";

test("file icons keep language glyphs and restore repository colours", () => {
  assert.equal(fileIconName("app.ts", "file"), "ph-file-ts");
  assert.equal(fileIconStyle("app.ts", "file"), "--file-color: #3178c6;");
  assert.equal(fileIconName("main.py", "file"), "ph-file-py");
  assert.equal(fileIconStyle("main.py", "file"), "--file-color: #3776ab;");
});

test("special repository files win over their generic extension", () => {
  assert.equal(fileIconName("README.md", "file"), "ph-file-md");
  assert.equal(fileIconStyle("README.md", "file"), "--file-color: #0969da;");
  assert.equal(fileIconName("package-lock.json", "file"), "ph-file-lock");
  assert.equal(fileIconStyle("package-lock.json", "file"), "--file-color: #cb3837;");
});

test("directories use a stable folder colour and unknown files stay neutral", () => {
  assert.equal(fileIconStyle("src", "directory"), "--file-color: #54aeff;");
  assert.equal(fileIconStyle("notes.custom", "file"), "");
});
