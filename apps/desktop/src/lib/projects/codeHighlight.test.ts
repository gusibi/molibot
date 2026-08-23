import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  highlightLines,
  MAX_LINE_CHARACTERS,
  MAX_SYNTAX_HIGHLIGHT_BYTES,
  resolveLanguage,
  safeEscapeLine
} from "./codeHighlight";

test("resolveLanguage identifies common extensions and filenames", () => {
  assert.equal(resolveLanguage("main.ts"), "typescript");
  assert.equal(resolveLanguage("app.js"), "javascript");
  assert.equal(resolveLanguage("styles.css"), "css");
  assert.equal(resolveLanguage("index.html"), "xml");
  assert.equal(resolveLanguage("readme.md"), "markdown");
  assert.equal(resolveLanguage("package.json"), "json");
  assert.equal(resolveLanguage(".gitignore"), "plaintext");
  assert.equal(resolveLanguage("unknown.xyz"), "");
});

test("safeEscapeLine escapes HTML and truncates pathological long lines", () => {
  const normal = '<script>alert("xss")</script>';
  assert.equal(safeEscapeLine(normal), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");

  const longLine = "a".repeat(MAX_LINE_CHARACTERS + 100);
  const result = safeEscapeLine(longLine);
  assert.ok(result.endsWith('<span class="code-line-truncated">…</span>'));
  assert.ok(result.length < MAX_LINE_CHARACTERS + 100);
});

test("highlightLines highlights supported languages under the size limit", () => {
  const tsCode = 'const x: number = 42;\nconsole.log("hello");';
  const lines = highlightLines(tsCode, "test.ts");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("hljs-keyword") || lines[0].includes("hljs-variable") || lines[0].includes("const"));
});

test("highlightLines falls back to safe escaped lines when content exceeds MAX_SYNTAX_HIGHLIGHT_BYTES", () => {
  const largeTs = 'const a = 1;\n'.repeat(Math.ceil((MAX_SYNTAX_HIGHLIGHT_BYTES + 1024) / 13));
  assert.ok(largeTs.length > MAX_SYNTAX_HIGHLIGHT_BYTES);

  const lines = highlightLines(largeTs, "large.ts");
  assert.ok(lines.length > 1);
  // Plain text fallback contains no highlight.js tags
  assert.ok(!lines[0].includes("hljs-"));
  assert.equal(lines[0], "const a = 1;");
});
