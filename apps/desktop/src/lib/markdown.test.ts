import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown";

// Node has no DOM for DOMPurify, so every case runs the real marked pipeline
// (GFM config, KaTeX extension, renderer overrides, table wrapping) with an
// identity sanitizer. The sanitizer config itself is pinned by structural
// assertions in src/chat-ui.test.mjs, which is where the DOM-free guard lives.
const identity = (html: string): string => html;

function render(source: string, options: Partial<Parameters<typeof renderMarkdown>[2]> = {}): string {
  return renderMarkdown(source, "Copy code", {
    labels: { wrapLines: "Wrap lines", openTable: "Open table" },
    sanitize: identity,
    ...options
  });
}

test("dollar amounts on one line are not parsed as math (the price regression)", () => {
  const output = render("订阅费每月 $10，一年 $120。");
  assert.doesNotMatch(output, /katex/);
  assert.ok(output.includes("$10"), output);
  assert.ok(output.includes("$120"), output);
});

test("English dollar amounts on one line are not parsed as math", () => {
  const output = render("Plan A costs $100 vs Plan B $200 per year.");
  assert.doesNotMatch(output, /katex/);
  assert.ok(output.includes("$100"), output);
  assert.ok(output.includes("$200"), output);
});

test("dollar amounts inside a table cell are not parsed as math", () => {
  const output = render("| 项目 | 价格 |\n| --- | --- |\n| A | $10/月，年付 $100 |");
  assert.doesNotMatch(output, /katex/);
  assert.ok(output.includes("$10/月，年付 $100"), output);
  assert.match(output, /<table>/);
});

test("a single stray dollar sign stays literal", () => {
  const output = render("总共花费 $100。");
  assert.doesNotMatch(output, /katex/);
  assert.ok(output.includes("$100"), output);
});

test("standard inline math still renders through KaTeX", () => {
  const output = render("勾股定理 $a^2 + b^2 = c^2$ 很有用。");
  assert.match(output, /katex/);
});

test("display math still renders through KaTeX", () => {
  const output = render("$$\nE = mc^2\n$$");
  assert.match(output, /katex-display/);
});

test("inline double-dollar math still renders through KaTeX", () => {
  const output = render("间隔 $$x$$ 之间。");
  assert.match(output, /katex/);
});

test("known edge: a bare closing dollar followed by whitespace is still math (library rule boundary)", () => {
  // The standard rule requires the closing `$` to sit against
  // whitespace/punctuation, so "to $" before a space still reads as math.
  // Every realistic price shape (closing `$` before a digit, `$` after
  // punctuation) is covered as plain above. This pins the residual boundary
  // documented at the markedKatex call so any change here is a conscious one.
  const output = render("涨幅在 $10 到 $ 之间。");
  assert.match(output, /katex/);
});

test("an opening dollar after punctuation is not proposed as math", () => {
  const output = render("他说 \"$a 和 $b\" 都对。");
  assert.doesNotMatch(output, /katex/);
});

test("code blocks keep their chrome (language label and copy button)", () => {
  const output = render("```js\nconst a = 1;\n```");
  assert.match(output, /class="code-block"/);
  assert.match(output, /data-copy-code/);
  assert.match(output, /language-js/);
});

test("tables are wrapped with the viewer affordance", () => {
  const output = render("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.match(output, /markdown-table-wrap/);
  assert.match(output, /data-open-table/);
});

test("heading ids stay namespaced by segment", () => {
  const output = render("## 标题", { headingPrefix: "answer-0" });
  assert.match(output, /id="answer-0-1"/);
  assert.match(output, /data-answer-heading/);
});
