import { describe, it, expect } from "vitest";
import { markdownToFeishuMarkdown } from "./formatting.js";

describe("markdownToFeishuMarkdown", () => {
  it("converts headers to bold", () => {
    const input = "# Heading 1\n\n## Heading 2";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("**Heading 1**");
    expect(result).toContain("**Heading 2**");
  });

  it("converts unordered lists to bullets", () => {
    const input = "- Item 1\n* Item 2";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("• Item 1");
    expect(result).toContain("• Item 2");
  });

  it("preserves code blocks", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("```typescript");
    expect(result).toContain("const x = 1;");
  });

  it("preserves bold and italic", () => {
    const input = "**bold** and *italic* and _italic2_";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("**bold**");
    expect(result).toContain("_italic_");
    expect(result).toContain("_italic2_");
  });

  it("preserves links", () => {
    const input = "[link text](https://example.com)";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("[link text](https://example.com)");
  });

  it("converts blockquotes to italic", () => {
    const input = "> This is a quote";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("_This is a quote_");
  });

  it("normalizes line endings", () => {
    const input = "Line 1\r\nLine 2\rLine 3";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });

  it("converts horizontal rules", () => {
    const input = "---";
    const result = markdownToFeishuMarkdown(input);
    expect(result).toContain("---");
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
    expect(result).toContain("**Project README**");
    expect(result).toContain("**Features**");
    expect(result).toContain("• Feature 1");
    expect(result).toContain("• Feature 2");
    expect(result).toContain("```typescript");
    expect(result).toContain("[our website](https://example.com)");
    expect(result).toContain("_Important note_");
  });
});