import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJsonTree,
  visibleJsonRows,
  jsonByteLength,
  JSON_TREE_MAX_BYTES,
  JSON_TREE_DEFAULT_DEPTH,
  type JsonTreeRow
} from "./jsonTree";

function rowsOf(content: string): JsonTreeRow[] {
  const result = buildJsonTree(content);
  assert.equal(result.status, "ok");
  return result.status === "ok" ? result.rows : [];
}

test("flattens objects and arrays into depth-tagged rows", () => {
  const rows = rowsOf('{"name":"molibot","tags":["a","b"]}');
  assert.deepEqual(
    rows.map((row) => [row.depth, row.key, row.kind]),
    [
      [0, "", "object"],
      [1, "name", "string"],
      [1, "tags", "array"],
      [2, "0", "string"],
      [2, "1", "string"]
    ]
  );
});

test("scalar rendering keeps strings quoted and distinguishes null from empty", () => {
  const rows = rowsOf('{"s":"x","n":3,"b":false,"z":null,"e":""}');
  const byKey = new Map(rows.map((row) => [row.key, row]));
  assert.equal(byKey.get("s")?.value, '"x"');
  assert.equal(byKey.get("n")?.value, "3");
  assert.equal(byKey.get("b")?.value, "false");
  assert.equal(byKey.get("z")?.value, "null");
  assert.equal(byKey.get("z")?.kind, "null");
  assert.equal(byKey.get("e")?.value, '""');
});

test("containers report their child count so a collapsed row still states its size", () => {
  const rows = rowsOf('{"list":[1,2,3],"empty":{}}');
  const list = rows.find((row) => row.key === "list");
  assert.equal(list?.expandable, true);
  assert.equal(list?.childCount, 3);
  const empty = rows.find((row) => row.key === "empty");
  assert.equal(empty?.expandable, true);
  assert.equal(empty?.childCount, 0);
});

test("containers below the default depth start collapsed, shallow ones stay open", () => {
  const result = buildJsonTree('{"a":{"b":{"c":{"d":1}}}}');
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  // Root (0) and `a` (1) are within the default depth; `b` (2) and deeper are not.
  assert.equal(result.collapsedByDefault.includes(""), false);
  assert.equal(result.collapsedByDefault.includes("/a"), false);
  assert.equal(result.collapsedByDefault.includes("/a/b"), true);
  assert.equal(JSON_TREE_DEFAULT_DEPTH, 2);
});

test("an empty container is never listed as collapsed-by-default", () => {
  const result = buildJsonTree('{"a":{"b":{}}}');
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.collapsedByDefault.includes("/a/b"), false);
});

test("collapsing a container hides its descendants but never itself", () => {
  const rows = rowsOf('{"a":{"x":1},"b":2}');
  const visible = visibleJsonRows(rows, new Set(["/a"]));
  assert.deepEqual(
    visible.map((row) => row.path),
    ["", "/a", "/b"]
  );
});

test("a sibling whose path shares a prefix is not hidden by string matching", () => {
  // `/ab` starts with `/a` as a raw string; only a `/a/` boundary may hide it.
  const rows = rowsOf('{"a":{"x":1},"ab":{"y":2}}');
  const visible = visibleJsonRows(rows, new Set(["/a"]));
  assert.equal(visible.some((row) => row.path === "/ab"), true);
  assert.equal(visible.some((row) => row.path === "/ab/y"), true);
  assert.equal(visible.some((row) => row.path === "/a/x"), false);
});

test("invalid JSON reports a message instead of throwing", () => {
  const result = buildJsonTree("{ not json");
  assert.equal(result.status, "invalid");
  if (result.status === "invalid") assert.ok(result.message.length > 0);
});

test("a document over the ceiling reports too-large instead of building a tree", () => {
  const huge = JSON.stringify({ blob: "x".repeat(JSON_TREE_MAX_BYTES + 10) });
  const result = buildJsonTree(huge);
  assert.equal(result.status, "too-large");
  if (result.status === "too-large") assert.ok(result.sizeBytes > JSON_TREE_MAX_BYTES);
});

test("the size ceiling counts UTF-8 bytes, so CJK is not undercounted", () => {
  // Pitfall #8: character length would report a third of the real payload.
  const cjk = "配置";
  assert.equal(cjk.length, 2);
  assert.equal(jsonByteLength(cjk), 6);
});

test("a top-level array and a top-level scalar both project cleanly", () => {
  assert.deepEqual(
    rowsOf("[1,2]").map((row) => [row.depth, row.key, row.kind]),
    [
      [0, "", "array"],
      [1, "0", "number"],
      [1, "1", "number"]
    ]
  );
  const scalar = rowsOf('"hello"');
  assert.equal(scalar.length, 1);
  assert.equal(scalar[0].kind, "string");
  assert.equal(scalar[0].expandable, false);
});
