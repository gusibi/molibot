import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStreamingRenderer,
  splitMarkdownBlocks
} from "./streamingMarkdown";

const DEPS = { copyCode: "Copy", wrapLinesLabel: "Wrap" };

/**
 * A deterministic stand-in for `defaultStreamingParse`. The real parser goes
 * through `marked` + `DOMPurify`, which needs a DOM this unit suite does not
 * stand up; the properties under test here (split, cache, fence completion)
 * are independent of how a block becomes HTML, so a stable fake is exact. The
 * real pipeline is exercised by the live harness and the structural guards.
 */
const fakeParse = (content: string, deps: { copyCode: string; wrapLinesLabel: string }) =>
  `<p data-cc="${deps.copyCode}" data-wl="${deps.wrapLinesLabel}">${content}</p>`;

test("splitMarkdownBlocks: an empty source yields no blocks and no open fence", () => {
  const { contents, openFenceMarker } = splitMarkdownBlocks("");
  assert.deepEqual(contents, []);
  assert.equal(openFenceMarker, null);
});

test("splitMarkdownBlocks: paragraphs split on blank lines", () => {
  const { contents, openFenceMarker } = splitMarkdownBlocks("first paragraph\n\nsecond paragraph");
  assert.equal(contents.length, 2);
  assert.equal(contents[0], "first paragraph");
  assert.equal(contents[1], "second paragraph");
  assert.equal(openFenceMarker, null);
});

test("splitMarkdownBlocks: a blank line inside a fenced block does not split", () => {
  const src = "```js\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
  const { contents, openFenceMarker } = splitMarkdownBlocks(src);
  assert.equal(contents.length, 2);
  assert.ok(contents[0].includes("const a = 1;"));
  assert.ok(contents[0].includes("const b = 2;"));
  assert.equal(contents[1], "after");
  assert.equal(openFenceMarker, null);
});

test("splitMarkdownBlocks: a fence line with an info string inside a fence is content, not a close", () => {
  // ``` opens; the inner ```python has an info string, so it is not a closing
  // fence - the block stays whole until the bare ``` at the end.
  const src = "```\n```python\nfoo\n```\n\nafter";
  const { contents } = splitMarkdownBlocks(src);
  assert.equal(contents.length, 2);
  assert.ok(contents[0].includes("```python"));
  assert.ok(contents[0].includes("foo"));
  assert.equal(contents[1], "after");
});

test("splitMarkdownBlocks: an unclosed fence marks the last block open", () => {
  const { contents, openFenceMarker } = splitMarkdownBlocks("intro\n\n```js\ncode here");
  assert.equal(contents.length, 2);
  assert.equal(contents[0], "intro");
  assert.equal(contents[1], "```js\ncode here");
  assert.equal(openFenceMarker, "`");
});

test("splitMarkdownBlocks: a tilde fence is tracked by its own marker", () => {
  const { openFenceMarker } = splitMarkdownBlocks("~~~js\ncode");
  assert.equal(openFenceMarker, "~");
});

test("splitMarkdownBlocks: trailing blank lines do not create an empty block", () => {
  const { contents } = splitMarkdownBlocks("intro\n\n");
  assert.deepEqual(contents, ["intro"]);
});

test("derive: an empty source yields no blocks", () => {
  const renderer = createStreamingRenderer(fakeParse);
  assert.deepEqual(renderer.derive("", DEPS), []);
});

test("derive: each block is rendered through the supplied parse", () => {
  const renderer = createStreamingRenderer(fakeParse);
  const blocks = renderer.derive("first paragraph\n\nsecond paragraph", DEPS);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].html, /<p data-cc="Copy"[^>]*>first paragraph<\/p>/);
  assert.match(blocks[1].html, /<p data-cc="Copy"[^>]*>second paragraph<\/p>/);
});

test("derive: a sealed block keeps a stable html value across frames (selection survives)", () => {
  // The selection-preservation property is value equality, not reference
  // identity. Svelte 5's `{@html}` runtime guards
  // `value === (value = get_value())` and skips the innerHTML write when the
  // value is unchanged, so a sealed block must produce the same html on every
  // subsequent frame - including across the active->sealed transition, where
  // the wrapper object is new but the content (and so the html) is final. The
  // wrapper reference is allowed to change; the html value is not.
  const renderer = createStreamingRenderer(fakeParse);
  const b0 = renderer.derive("first paragraph", DEPS);
  const b1 = renderer.derive("first paragraph\n\nsecond", DEPS);
  const b2 = renderer.derive("first paragraph\n\nsecond\n\nthird", DEPS);
  assert.equal(b1[0].html, b0[0].html);
  assert.equal(b2[0].html, b0[0].html);
  assert.equal(b2[1].html, b1[1].html);
});

test("derive: the active block is re-rendered when it grows (its html changes)", () => {
  // The still-growing last block must produce a new html value each frame, or
  // the stream would freeze on the first frame's content.
  const renderer = createStreamingRenderer(fakeParse);
  const a = renderer.derive("growing", DEPS);
  const b = renderer.derive("growing still", DEPS);
  assert.notEqual(a[0].html, b[0].html);
});

test("derive: a sealed block is not re-parsed on subsequent frames (the cache hits)", () => {
  // A spy parse that records every content it is handed. "a" is sealed once
  // the second block arrives, so re-deriving with more text must not parse it
  // again - only the newly-sealed "b" and the active tail are parsed.
  const seen: string[] = [];
  const renderer = createStreamingRenderer((content) => {
    seen.push(content);
    return `<p>${content}</p>`;
  });
  renderer.derive("a\n\nb", DEPS); // "a" sealed+cached, "b" active
  seen.length = 0;
  renderer.derive("a\n\nb\n\nc", DEPS); // "a" cached, "b" newly sealed, "c" active
  assert.ok(!seen.includes("a"), "sealed block 'a' must not be re-parsed");
  assert.ok(seen.includes("b"));
  assert.ok(seen.includes("c"));
});

test("derive: an unclosed fence is synthetically closed before parsing (no swallowing)", () => {
  // The active block is an open fence. derive must hand the parser a closed
  // fence - content ending in a bare ``` marker - so marked renders a code
  // block instead of waiting for a close that swallows everything after it.
  const seen: string[] = [];
  const renderer = createStreamingRenderer((content) => {
    seen.push(content);
    return `<pre>${content}</pre>`;
  });
  renderer.derive("```js\nconst x = 1", DEPS);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /```js/);
  // The synthetic close is a bare fence marker on its own trailing line.
  assert.match(seen[0], /\n```$/);
});

test("derive: a sealed paragraph followed by an open fence keeps them separate", () => {
  const seen: string[] = [];
  const renderer = createStreamingRenderer((content) => {
    seen.push(content);
    return `<p>${content}</p>`;
  });
  const blocks = renderer.derive("intro\n\n```js\ncode here", DEPS);
  assert.equal(blocks.length, 2);
  assert.equal(seen[0], "intro");
  // The active fence block was closed before parsing.
  assert.match(seen[1], /\n```$/);
});

test("derive: the cache key includes the labels, so a locale change is not served stale", () => {
  // The wrap-toggle and copy labels are baked into the rendered markup, so the
  // cache key has to carry them - otherwise switching locale would hand back a
  // block rendered with the old button label. The fake parse echoes the deps,
  // which is what makes a stale serve observable.
  const renderer = createStreamingRenderer(fakeParse);
  const en = renderer.derive("para", { copyCode: "Copy", wrapLinesLabel: "Wrap" });
  const zh = renderer.derive("para", { copyCode: "复制", wrapLinesLabel: "折行" });
  assert.notEqual(en[0].html, zh[0].html);
  assert.match(zh[0].html, /复制/);
});
