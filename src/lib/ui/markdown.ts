import { marked } from "marked";

const ALLOWED_TAGS = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "IMG",
  "LI",
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

function sanitizeMarkdownHtml(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = child as HTMLElement;
      if (!ALLOWED_TAGS.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent ?? ""));
        continue;
      }

      const href = element.tagName === "A" ? (child as HTMLAnchorElement).getAttribute("href") : null;
      const src = element.tagName === "IMG" ? (element as HTMLImageElement).getAttribute("src") : null;
      const alt = element.tagName === "IMG" ? (element as HTMLImageElement).getAttribute("alt") : null;
      for (const attribute of Array.from(element.attributes)) {
        element.removeAttribute(attribute.name);
      }

      if (element.tagName === "A") {
        if (isSafeUrl(href)) {
          element.setAttribute("href", href ?? "#");
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noreferrer");
        }
      } else if (element.tagName === "IMG") {
        // Markdown images render like the desktop transcript: safe absolute or
        // same-origin URLs only, lazy-loaded so a long transcript does not
        // fetch every attachment up front.
        if (isSafeUrl(src)) {
          element.setAttribute("src", src ?? "");
          element.setAttribute("loading", "lazy");
          element.setAttribute("decoding", "async");
        }
        if (alt) element.setAttribute("alt", alt);
      }

      walk(element);
    }
  };

  walk(template.content);
  return template.innerHTML;
}

/** Renders untrusted markdown to sanitized HTML for transcript surfaces. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true
  });
  return sanitizeMarkdownHtml(String(html));
}
