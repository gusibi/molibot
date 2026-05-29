import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKSPACE_ID, WorkspaceStore } from "$lib/server/workspaces/store.js";

test("workspace store creates a default personal workspace", () => {
  const store = new WorkspaceStore(":memory:");
  const workspace = store.ensureDefaultWorkspace();
  assert.equal(workspace.id, DEFAULT_WORKSPACE_ID);
  assert.equal(workspace.name, "Personal");
  assert.equal(workspace.memoryScope, "workspace");
});
