import { Marked, Renderer } from "./vendor/marked.esm.js";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function safeHref(value) {
  try {
    const url = new URL(String(value));
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

const renderer = new Renderer();

// Notes are untrusted Agent/user content. Raw HTML and remote images do not
// belong in this compact reading surface; Markdown links retain only explicit
// web/mail protocols and open outside the Mini App frame.
renderer.html = () => "";
renderer.image = ({ text }) => escapeHtml(text ?? "");
renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const safe = safeHref(href);
  if (!safe) return label;
  return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noreferrer">${label}</a>`;
};

const parser = new Marked({
  gfm: true,
  breaks: false,
  renderer
});

export function renderMarkdown(source) {
  return parser.parse(String(source ?? ""), { async: false });
}
