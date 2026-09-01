import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { reiconSvg } from "./reiconSvg";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);

marked.use({ gfm: true, breaks: false });
marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

export interface RenderMarkdownOptions {
  /**
   * Rendering an in-flight streamed reply: skip syntax highlighting (its cost
   * is paid again on every streamed frame and `highlightAuto` tries every
   * registered language) and skip the cache (the source grows each frame, so
   * entries would never be hit again). The final render after completion does
   * full highlighting.
   */
  streaming?: boolean;
  /** Labels for the controls the renderer emits into code blocks. */
  labels?: { copyCode?: string; wrapLines?: string; previewArtifact?: string; openTable?: string };
  headingPrefix?: string;
}

/**
 * A GFM table is the one block whose intrinsic width comes from its content, so
 * it is the one block that must be allowed to overflow its column and scroll
 * rather than be squeezed into it (`table-layout: fixed` on a narrow column
 * turns an 8-column table into eight stacks of one character). `marked` emits
 * no wrapper of its own and GFM tables cannot nest, so wrapping the emitted
 * markup is exact — and it keeps a renderer override, which in marked 16 means
 * re-implementing header, row and cell parsing, out of the picture entirely.
 *
 * The viewer affordance rides in the table's own header row (last cell, icon
 * only): a separate button above the first row reads as an unrelated control.
 * The button must sit inside a cell — a `<button>` between cells is foster-
 * parented out of the table by the HTML parser — and the header row's end is
 * the one seam every GFM table emits (`</th> </tr> </thead>`).
 */
function wrapTables(html: string, label: string): string {
  if (!html.includes("<table")) return html;
  let result = html
    .replaceAll("<table>", `<div class="markdown-table-wrap"><table>`)
    .replaceAll("</table>", "</table></div>");
  if (label) {
    const action = `<button type="button" class="markdown-artifact-action" data-open-table aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${reiconSvg("grid", 14)}</button>`;
    result = result.replaceAll(/<\/th>(\s*<\/tr>\s*<\/thead>)/g, (_match, tail: string) => `${action}</th>${tail}`);
  }
  return result;
}

// Completed messages re-render whenever the transcript updates; memoize so
// history is parsed and highlighted once, not on every turn.
const RENDER_CACHE_LIMIT = 300;
const renderCache = new Map<string, string>();

export function renderMarkdown(source: string, copyCodeLabel = "Copy code", options: RenderMarkdownOptions = {}): string {
  const streaming = options.streaming === true;
  const wrapLinesLabel = options.labels?.wrapLines ?? "";
  const previewArtifactLabel = options.labels?.previewArtifact ?? "";
  const openTableLabel = options.labels?.openTable ?? "";
  const headingPrefix = options.headingPrefix ?? "";
  const cacheKey = streaming ? null : `${copyCodeLabel}\u0000${wrapLinesLabel}\u0000${previewArtifactLabel}\u0000${openTableLabel}\u0000${headingPrefix}\u0000${source}`;
  if (cacheKey !== null) {
    const cached = renderCache.get(cacheKey);
    if (cached !== undefined) {
      // Re-insert for LRU recency.
      renderCache.delete(cacheKey);
      renderCache.set(cacheKey, cached);
      return cached;
    }
  }
  const renderer = new marked.Renderer();
  let headingIndex = 0;
  renderer.heading = function ({ tokens, depth }): string {
    const inner = this.parser.parseInline(tokens);
    headingIndex += 1;
    const id = headingPrefix ? `${headingPrefix}-${headingIndex}` : "";
    return `<h${depth}${id ? ` id="${escapeHtml(id)}" data-answer-heading` : ""}>${inner}</h${depth}>`;
  };
  renderer.code = ({ text, lang }: { text: string; lang?: string }): string => {
      const language = String(lang ?? "").trim().split(/\s+/)[0];
      const highlighted = streaming
        ? escapeHtml(text)
        : language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
      const languageLabel = language || "code";
      // The block scrolls horizontally by default so indentation survives; the
      // toggle is what makes that recoverable for prose-shaped output (a long
      // log line, a URL) without forcing every code block to lose its shape.
      const wrapButton = wrapLinesLabel
        ? `<button type="button" data-wrap-code aria-pressed="false" aria-label="${escapeHtml(wrapLinesLabel)}" title="${escapeHtml(wrapLinesLabel)}">${escapeHtml(wrapLinesLabel)}</button>`
        : "";
      const previewButton = previewArtifactLabel && ["html", "svg", "xml"].includes(language)
        ? `<button type="button" data-preview-artifact>${escapeHtml(previewArtifactLabel)}</button>`
        : "";
      return `<div class="code-block"><div class="code-block-head"><span>${escapeHtml(languageLabel)}</span>${previewButton}${wrapButton}<button type="button" data-copy-code aria-label="${escapeHtml(copyCodeLabel)}">${escapeHtml(copyCodeLabel)}</button></div><pre><code class="hljs${language ? ` language-${escapeHtml(language)}` : ""}">${highlighted}</code></pre></div>`;
  };
  const html = marked.parse(String(source ?? ""), { async: false, renderer }) as string;
  const sanitized = wrapTables(DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style"],
    FORBID_ATTR: ["style"]
  }), openTableLabel);
  if (cacheKey !== null) {
    renderCache.set(cacheKey, sanitized);
    if (renderCache.size > RENDER_CACHE_LIMIT) {
      const oldest = renderCache.keys().next().value;
      if (oldest !== undefined) renderCache.delete(oldest);
    }
  }
  return sanitized;
}
