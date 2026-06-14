import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownToFeishuMarkdown } from "$lib/server/channels/feishu/formatting.js";

describe("markdownToFeishuMarkdown", () => {
  it("converts headers to bold", () => {
    const input = "# Heading 1\n\n## Heading 2";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /\*\*Heading 1\*\*/);
    assert.match(result, /\*\*Heading 2\*\*/);
  });

  it("converts unordered lists to bullets", () => {
    const input = "- Item 1\n* Item 2";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /• Item 1/);
    assert.match(result, /• Item 2/);
  });

  it("preserves code blocks", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /```typescript/);
    assert.match(result, /const x = 1;/);
  });

  it("does not rewrite markdown-looking content inside code blocks", () => {
    const input = [
      "Before",
      "",
      "```markdown",
      "# Keep this heading literal",
      "- Keep this list literal",
      "> Keep this quote literal",
      "```",
      "",
      "# Convert this heading"
    ].join("\n");

    const result = markdownToFeishuMarkdown(input);

    assert.match(result, /# Keep this heading literal/);
    assert.match(result, /- Keep this list literal/);
    assert.match(result, /> Keep this quote literal/);
    assert.match(result, /\*\*Convert this heading\*\*/);
  });

  it("preserves bold and italic", () => {
    const input = "**bold** and *italic* and _italic2_";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /\*\*bold\*\*/);
    assert.match(result, /_italic_/);
    assert.match(result, /_italic2_/);
  });

  it("preserves links", () => {
    const input = "[link text](https://example.com)";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /\[link text\]\(https:\/\/example\.com\)/);
  });

  it("converts blockquotes to italic", () => {
    const input = "> This is a quote";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /_This is a quote_/);
  });

  it("normalizes line endings", () => {
    const input = "Line 1\r\nLine 2\rLine 3";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /Line 1\nLine 2\nLine 3/);
  });

  it("converts horizontal rules", () => {
    const input = "---";
    const result = markdownToFeishuMarkdown(input);
    assert.match(result, /---/);
  });

  it("handles complex markdown document", () => {
    const input = `
# Project README

This is a **bold** and *italic* example.

## Features

- Feature 1
- Feature 2

### Code Example

\`\`\`typescript
const greeting = "Hello World";
console.log(greeting);
\`\`\`

## Links

Visit [our website](https://example.com) for more info.

> Important note
    `.trim();

    const result = markdownToFeishuMarkdown(input);

    // Verify key elements are present
    assert.match(result, /\*\*Project README\*\*/);
    assert.match(result, /\*\*Features\*\*/);
    assert.match(result, /• Feature 1/);
    assert.match(result, /• Feature 2/);
    assert.match(result, /```typescript/);
    assert.match(result, /\[our website\]\(https:\/\/example\.com\)/);
    assert.match(result, /_Important note_/);
  });
});
