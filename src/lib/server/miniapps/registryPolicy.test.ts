import assert from "node:assert/strict";
import test from "node:test";
import { initialMiniAppEnabled } from "$lib/server/miniapps/registry.js";

test("third-party AI apps start disabled while ordinary and built-in apps keep explicit install intent", () => {
  assert.equal(initialMiniAppEnabled({ kind: "directory", label: "writer" }, true), false);
  assert.equal(initialMiniAppEnabled({ kind: "github", repo: "owner/app", ref: "main" }, true), false);
  assert.equal(initialMiniAppEnabled({ kind: "zip", label: "plain.zip" }, false), true);
  assert.equal(initialMiniAppEnabled({ kind: "builtin" }, true), true);
});
