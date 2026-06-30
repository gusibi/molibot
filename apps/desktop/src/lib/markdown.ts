import DOMPurify from "dompurify";
import { marked } from "marked";

marked.use({ gfm: true, breaks: true });

export function renderMarkdown(source: string): string {
  const html = marked.parse(String(source ?? ""), { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style"],
    FORBID_ATTR: ["style"]
  });
}
