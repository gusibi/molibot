import assert from "node:assert/strict";
import test from "node:test";
import { isProjectDirectoryAccessError, sameProjectDirectory } from "./projectDirectoryAccess";

test("Project root access errors are limited to directory enumeration permissions", () => {
  assert.equal(isProjectDirectoryAccessError("EPERM: operation not permitted, scandir '/protected/project'"), true);
  assert.equal(isProjectDirectoryAccessError("EACCES: permission denied, readdir '/protected/project'"), true);
  assert.equal(isProjectDirectoryAccessError("ENOENT: no such file or directory"), false);
  assert.equal(isProjectDirectoryAccessError("EPERM: operation not permitted, open '/protected/file'"), false);
});

test("native picker paths match the persisted Project root without separator drift", () => {
  assert.equal(sameProjectDirectory("/Volumes/Work/Project/", "/Volumes/Work/Project"), true);
  assert.equal(sameProjectDirectory("C:\\Work\\Project\\", "C:/Work/Project"), true);
  assert.equal(sameProjectDirectory("/Volumes/Work/Other", "/Volumes/Work/Project"), false);
});
