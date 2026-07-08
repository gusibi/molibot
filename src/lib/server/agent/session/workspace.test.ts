import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDataRootFromWorkspacePath,
  resolveGlobalSkillsDirFromWorkspacePath,
  resolveWorkspaceRelativeFromWorkspacePath
} from "./workspace.js";

test("bot channel workspace resolves the data root above moli-*", () => {
  const ws = "/data/.molibot/moli-w/bots/personal";
  assert.equal(resolveDataRootFromWorkspacePath(ws), "/data/.molibot");
  assert.equal(resolveWorkspaceRelativeFromWorkspacePath(ws), "moli-w/bots/personal");
  assert.equal(resolveGlobalSkillsDirFromWorkspacePath(ws), "/data/.molibot/skills");
});

test("project runtime workspace resolves the data root above projects/<id>/runtime", () => {
  const ws = "/data/.molibot/projects/talkshow/runtime";
  assert.equal(resolveDataRootFromWorkspacePath(ws), "/data/.molibot");
  assert.equal(resolveWorkspaceRelativeFromWorkspacePath(ws), "projects/talkshow/runtime");
  // Global skills/memory stay shared with the rest of the data root.
  assert.equal(resolveGlobalSkillsDirFromWorkspacePath(ws), "/data/.molibot/skills");
});

test("project runtime chat subdir still resolves the data root", () => {
  const ws = "/data/.molibot/projects/talkshow/runtime/web:personal:web-anonymous";
  assert.equal(resolveDataRootFromWorkspacePath(ws), "/data/.molibot");
});

test("a 'projects' segment in an ancestor path does not hijack resolution", () => {
  // Data dir itself sits under a user 'projects' folder; channel marker wins.
  assert.equal(
    resolveDataRootFromWorkspacePath("/home/u/projects/.molibot/moli-w/bots/default"),
    "/home/u/projects/.molibot"
  );
  // And the specific projects/<id>/runtime marker matches the inner segment.
  assert.equal(
    resolveDataRootFromWorkspacePath("/home/u/projects/.molibot/projects/talkshow/runtime"),
    "/home/u/projects/.molibot"
  );
});
