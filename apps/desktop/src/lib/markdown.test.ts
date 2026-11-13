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

test("bold closing after CJK punctuation followed directly by a CJK character still renders (commonmark-spec#650)", () => {
  // Stock CommonMark refuses a closing `**` preceded by CJK punctuation and
  // followed by a CJK character, so the "**标签：**正文" shape model replies
  // are full of rendered literal asterisks. marked-cjk-friendly implements the
  // proposed spec fix; these are the exact shapes seen in a real reply.
  const output = render("o **特点：**典型秋高气爽。");
  assert.match(output, /<strong>特点：<\/strong>典型秋高气爽/);

  const nested = render("- **华南沿海（广东、海南、福建南部）：**仍偏闷热（30°C+）");
  assert.match(nested, /<strong>华南沿海（广东、海南、福建南部）：<\/strong>仍偏闷热/);
});

test("opening-side and plain CJK emphasis still render", () => {
  assert.match(render("特点：**秋高气爽**是常态。"), /特点：<strong>秋高气爽<\/strong>是常态/);
  assert.match(render("**华北平原、西北大部**和东北南部。"), /<strong>华北平原、西北大部<\/strong>和东北南部/);
});

test("cjk-friendly does not change non-CJK emphasis behavior", () => {
  assert.match(render("He said **\"no\"**, loudly."), /<strong>&quot;no&quot;<\/strong>, loudly/);
  assert.match(render("foo**bar**baz"), /foo<strong>bar<\/strong>baz/);
  // Spaced and unmatched asterisks stay literal.
  assert.doesNotMatch(render("a * b * c"), /<em>/);
  assert.ok(render("2 ** 3 = 8，** 不是粗体").includes("2 ** 3 = 8"));
  assert.match(render("用 `**特点：**` 写法"), /<code>\*\*特点：\*\*<\/code>/);
});

test("a paragraph of images becomes a figure block, not a p wrapping a figure", () => {
  const figure = render("![示意图](diagram.png)");
  assert.match(figure, /<figure class="md-figure"><img/);
  // Foster-parenting a block-level <figure> out of a <p> would leave two
  // empty paragraphs and a visible gap above and below every image.
  assert.doesNotMatch(figure, /<p><figure/);
  assert.doesNotMatch(figure, /<\/figure><\/p>/);
  assert.match(figure, /loading="lazy"/);
  assert.match(figure, /decoding="async"/);
});

test("the standard Markdown image title becomes a visible caption", () => {
  const figure = render('![趋势](trend.png "第一季度营收趋势")');
  assert.match(figure, /<figcaption class="md-figcaption">第一季度营收趋势<\/figcaption>/);
  assert.doesNotMatch(render("![趋势](trend.png)"), /md-figcaption/);
});

test("prose beside an image stays one paragraph with an inline image", () => {
  const mixed = render('如下图所示：![图](x.png "图注") 这是说明。');
  assert.match(mixed, /^<p>/);
  assert.match(mixed, /<img[^>]*src="x.png"/);
  assert.match(mixed, /<\/p>$/);
  // A block-level <figure> inside a <p> is foster-parented out by the HTML
  // parser, splitting one sentence into three blocks. The Markdown title is
  // kept as the img title attribute, but not as a block caption.
  assert.doesNotMatch(mixed, /<figure|<figcaption/);
});

test("figure context does not leak into a following mixed paragraph", () => {
  const output = render('![独占](a.png "图 1")\n\nText ![inline](b.png) after.');
  assert.equal((output.match(/<figure/g) ?? []).length, 1);
  assert.match(output, /<p>Text <img[^>]*src="b.png"[^>]*> after\.<\/p>/);
});

test("images in headings, list items and table cells stay inline", () => {
  const output = render([
    "## 标题 ![图](h.png)",
    "",
    "- 列表 ![图](l.png)",
    "",
    "| 列 |",
    "| --- |",
    "| ![图](t.png) |"
  ].join("\n"));
  assert.doesNotMatch(output, /<figure|<figcaption/);
  assert.equal((output.match(/<img/g) ?? []).length, 3);
});

test("code block actions are icon buttons that keep their data hooks", () => {
  const output = render("```js\nconst a = 1;\n```");
  assert.match(output, /data-copy-code[^>]*><svg class="reicon"/);
  assert.match(output, /data-wrap-code[^>]*><svg class="reicon"/);
  // Icon-only means the label must survive as an accessible name.
  assert.match(output, /aria-label="Copy code"/);
  assert.match(output, /aria-label="Wrap lines"/);
  assert.match(output, /language-js/);
});

test("GFM task lists stay plain Markdown and render a checkbox", () => {
  const output = render("- [x] 已完成\n- [ ] 待办");
  assert.match(output, /<input[^>]*type="checkbox"/);
  assert.match(output, /checked/);
});

/** Tag-name sequence with syntax-highlight spans removed. */
function skeleton(html: string): string {
  return (html
    .replace(/<span class="hljs-[^"]*">|<\/span>/g, "")
    .match(/<\/?[a-z][^>]*>/gi) ?? [])
    .map((tag) => tag.replace(/^<(\/?[a-z0-9]+).*/i, "$1"))
    .join(" ");
}

test("streamed and settled Markdown share the same block skeleton", () => {
  const source = [
    "## 标题", "", "正文 **加粗** 与 `代码`。", "",
    "```js", "const a = 1;", "```", "",
    "| a | b |", "| --- | --- |", "| 1 | 2 |", "",
    '![图](x.png "说明")', "", "- [ ] 待办"
  ].join("\n");
  assert.equal(skeleton(render(source, { streaming: true })), skeleton(render(source)));
});
