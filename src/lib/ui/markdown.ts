import { marked } from "marked";

/**
 * Web Markdown renderer. The output is untrusted by definition: it is built
 * from model answers and injected with `{@html}`.
 *
 * The sanitizer below is deliberately DOM-free. The old version walked a
 * browser DOM template but returned the raw HTML on the server, which meant
 * SSR emitted un-sanitized markup and the client hydrated something
 * different. Both paths now run the same pure function and produce
 * byte-identical output, which also makes it testable in Node.
 *
 * Security invariant: NO attribute from the input is ever forwarded. Every
 * attribute in the output is reconstructed here from a value that passed a
 * check, so event handlers, `style`, `srcdoc`, `formaction` and
 * `javascript:` URLs cannot ride along even when the input is malformed.
 */
const ALLOWED_TAGS = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "EM",
  "FIGCAPTION",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "IMG",
  "INPUT",
  "LI",
  "MARK",
  "OL",
  "P",
  "PRE",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL"
]);

const VOID_TAGS = new Set(["BR", "HR", "IMG", "INPUT"]);

// Their text content is not prose (CSS, JS, fallback markup). Drop it along
// with the tag so a stray <style> from an answer cannot become visible noise.
const DROP_CONTENT_TAGS = new Set([
  "EMBED",
  "IFRAME",
  "NOSCRIPT",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "TEXTAREA"
]);

const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s([^>]*))?>/g;

function isSafeUrl(value: string | null): boolean {
  if (!value) return false;
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttribute(value: string): string {
  return decodeEntities(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i"
  );
  const match = pattern.exec(attributes);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function hasAttribute(attributes: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?=\\s|=|$)`, "i").test(attributes);
}

function renderOpenTag(name: string, attributes: string): string {
  switch (name) {
    case "A": {
      const href = readAttribute(attributes, "href");
      return isSafeUrl(href)
        ? `<a href="${escapeAttribute(href ?? "")}" target="_blank" rel="noreferrer">`
        : "<a>";
    }
    case "IMG": {
      const src = readAttribute(attributes, "src");
      const alt = readAttribute(attributes, "alt");
      const safeSrc = isSafeUrl(src) ? ` src="${escapeAttribute(src ?? "")}"` : "";
      const safeAlt = alt ? ` alt="${escapeAttribute(alt)}"` : "";
      return `<img${safeSrc}${safeAlt} loading="lazy" decoding="async">`;
    }
    case "INPUT": {
      // GFM task lists are plain Markdown and emit disabled checkboxes. Only
      // that exact shape survives; any other input is dropped entirely.
      if (readAttribute(attributes, "type")?.toLowerCase() !== "checkbox") return "";
      const checked = hasAttribute(attributes, "checked") ? " checked" : "";
      return `<input type="checkbox" disabled${checked}>`;
    }
    default:
      return `<${name.toLowerCase()}>`;
  }
}

function sanitizeMarkdownHtml(html: string): string {
  // Comments and declarations are not elements. Strip them first so no
  // parser-quirk payload (e.g. <!--><img onerror=...>) can reach {@html}.
  const source = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<![^>]*>/g, "");

  const open: string[] = [];
  let output = "";
  let cursor = 0;

  for (const match of source.matchAll(TAG_PATTERN)) {
    const index = match.index ?? 0;
    output += source.slice(cursor, index);
    cursor = index + match[0].length;

    const name = match[1].toUpperCase();
    const attributes = match[2] ?? "";
    const closing = match[0][1] === "/";

    if (!ALLOWED_TAGS.has(name)) {
      // Dropping the tag keeps its text, matching the old DOM walk's
      // textContent fallback. Raw-text containers lose their payload too.
      if (!closing && DROP_CONTENT_TAGS.has(name)) {
        const close = new RegExp(`</${name}\\s*>`, "i").exec(source.slice(cursor));
        if (close) cursor += close.index + close[0].length;
      }
      continue;
    }

    if (closing) {
      const depth = open.lastIndexOf(name);
      if (depth === -1) continue;
      for (let i = open.length - 1; i >= depth; i -= 1) {
        output += `</${open[i].toLowerCase()}>`;
      }
      open.length = depth;
      continue;
    }

    output += renderOpenTag(name, attributes);
    if (!VOID_TAGS.has(name) && !/\/\s*$/.test(attributes)) open.push(name);
  }

  output += source.slice(cursor);
  for (let i = open.length - 1; i >= 0; i -= 1) {
    output += `</${open[i].toLowerCase()}>`;
  }
  return output;
}

/**
 * A GFM table is the one block whose intrinsic width comes from its content.
 * The Desktop renderer wraps it in the same class so a wide table scrolls
 * locally inside the message column instead of squeezing every cell (the
 * transcript itself must never gain a horizontal scrollbar).
 */
function wrapTables(html: string): string {
  if (!html.includes("<table>")) return html;
  return html
    .replaceAll("<table>", '<div class="markdown-table-wrap"><table>')
    .replaceAll("</table>", "</table></div>");
}

/** Renders untrusted markdown to sanitized HTML for transcript surfaces. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, {
    async: false,
    // CommonMark default, matching the Desktop renderer. `breaks: true` here
    // used to make the same answer read differently in Web and Desktop.
    breaks: false,
    gfm: true
  });
  return wrapTables(sanitizeMarkdownHtml(String(html)));
}
