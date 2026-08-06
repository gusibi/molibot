import test from "node:test";
import assert from "node:assert/strict";
import { splitMermaidBlocks, hasMermaidBlock } from "./mermaidBlocks";

test("extracts a mermaid block and keeps the surrounding prose", () => {
  const segments = splitMermaidBlocks("intro\n\n```mermaid\ngraph TD;\nA-->B;\n```\n\noutro");
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["markdown", "mermaid", "markdown"]
  );
  assert.equal(segments[1].content, "graph TD;\nA-->B;");
  assert.match(segments[0].content, /intro/);
  assert.match(segments[2].content, /outro/);
});

test("a non-mermaid fenced block is left to the markdown renderer", () => {
  const segments = splitMermaidBlocks("```ts\nconst a = 1;\n```");
  assert.deepEqual(segments.map((segment) => segment.kind), ["markdown"]);
  assert.equal(hasMermaidBlock("```ts\nconst a = 1;\n```"), false);
});

test("the info string may carry attributes after the language", () => {
  const segments = splitMermaidBlocks("```mermaid {theme=dark}\ngraph TD;\n```");
  assert.deepEqual(segments.map((segment) => segment.kind), ["mermaid"]);
});

test("an unterminated fence stays markdown rather than rendering a broken diagram", () => {
  // Half a diagram is what a still-streaming or malformed file looks like.
  const segments = splitMermaidBlocks("```mermaid\ngraph TD;\nA-->B;");
  assert.deepEqual(segments.map((segment) => segment.kind), ["markdown"]);
  assert.equal(hasMermaidBlock("```mermaid\ngraph TD;"), false);
});

test("a longer opening fence is not closed by a shorter run inside the diagram", () => {
  const source = "````mermaid\ngraph TD;\nA[\"``\"]-->B;\n````";
  const segments = splitMermaidBlocks(source);
  assert.deepEqual(segments.map((segment) => segment.kind), ["mermaid"]);
  assert.match(segments[0].content, /A\["``"\]-->B;/);
});

test("tilde fences work and are not closed by backticks", () => {
  const segments = splitMermaidBlocks("~~~mermaid\ngraph TD;\n~~~");
  assert.deepEqual(segments.map((segment) => segment.kind), ["mermaid"]);
});

test("multiple diagrams get distinct ids and no empty markdown segments between them", () => {
  const segments = splitMermaidBlocks("```mermaid\nA\n```\n\n```mermaid\nB\n```");
  assert.deepEqual(segments.map((segment) => segment.kind), ["mermaid", "mermaid"]);
  const ids = segments.map((segment) => (segment.kind === "mermaid" ? segment.id : ""));
  assert.equal(new Set(ids).size, 2);
});

test("plain markdown with no fences is one segment, and empty input is none", () => {
  assert.deepEqual(splitMermaidBlocks("# Title\n\ntext").map((s) => s.kind), ["markdown"]);
  assert.deepEqual(splitMermaidBlocks(""), []);
  assert.deepEqual(splitMermaidBlocks("   \n\n  "), []);
});

test("an empty mermaid block does not trigger loading the library", () => {
  assert.equal(hasMermaidBlock("```mermaid\n\n```"), false);
  assert.equal(hasMermaidBlock("```mermaid\ngraph TD;\n```"), true);
});
