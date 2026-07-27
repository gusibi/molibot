import hljs from "highlight.js/lib/common";

/**
 * Extension → highlight.js language. Only names that exist in the `common`
 * bundle are worth mapping; `resolveLanguage` verifies before returning one, so
 * an unknown extension degrades to unhighlighted (but still escaped) text.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", json5: "json", jsonc: "json",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml", svelte: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  yml: "yaml", yaml: "yaml",
  py: "python", pyw: "python",
  rb: "ruby", php: "php", go: "go", rs: "rust", swift: "swift", kt: "kotlin", kts: "kotlin",
  java: "java", c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", sql: "sql", lua: "lua", pl: "perl", r: "r", dart: "dart",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ini: "ini", cfg: "ini", conf: "ini", toml: "ini", env: "ini",
  diff: "diff", patch: "diff"
};

const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".gitignore": "plaintext",
  ".env": "ini"
};

export function resolveLanguage(filePath: string): string {
  const name = (filePath.split("/").pop() ?? "").toLowerCase();
  const byName = FILENAME_LANGUAGE[name];
  if (byName && hljs.getLanguage(byName)) return byName;
  const extension = name.includes(".") ? name.split(".").pop()! : "";
  const candidate = LANGUAGE_BY_EXTENSION[extension];
  return candidate && hljs.getLanguage(candidate) ? candidate : "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * highlight.js emits one HTML blob whose `<span>`s freely cross newlines (block
 * comments, template literals). Rendering one DOM row per line therefore needs
 * the open spans re-opened at the start of each line and closed at its end.
 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openTags: string[] = [];
  let current = "";
  const tokens = html.split(/(<[^>]+>)/);

  const pushLine = () => {
    lines.push(current + "</span>".repeat(openTags.length));
    current = openTags.join("");
  };

  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith("<")) {
      if (token.startsWith("</")) openTags.pop();
      else if (!token.endsWith("/>")) openTags.push(token);
      current += token;
      continue;
    }
    const parts = token.split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) pushLine();
      current += parts[index];
    }
  }
  lines.push(current + "</span>".repeat(openTags.length));
  return lines;
}

/** Highlights `content` and returns it as one ready-to-render HTML string per line. */
export function highlightLines(content: string, filePath: string): string[] {
  const language = resolveLanguage(filePath);
  if (!language) return content.split("\n").map(escapeHtml);
  try {
    const { value } = hljs.highlight(content, { language, ignoreIllegals: true });
    return splitHighlightedLines(value);
  } catch {
    return content.split("\n").map(escapeHtml);
  }
}

/**
 * Wraps every occurrence of `query` in `<mark>` without disturbing the
 * highlight markup, by rewriting only the text runs between tags.
 */
export function markMatches(lineHtml: string, query: string, caseSensitive: boolean): string {
  if (!query) return lineHtml;
  // Text runs inside the highlight markup are HTML-escaped, so the needle must be too.
  const escapedNeedle = caseSensitive ? escapeHtml(query) : escapeHtml(query).toLowerCase();
  if (!escapedNeedle) return lineHtml;

  return lineHtml.split(/(<[^>]+>)/).map((token) => {
    if (!token || token.startsWith("<")) return token;
    const haystack = caseSensitive ? token : token.toLowerCase();
    let cursor = 0;
    let output = "";
    for (;;) {
      const at = haystack.indexOf(escapedNeedle, cursor);
      if (at < 0 || !escapedNeedle) break;
      output += token.slice(cursor, at) + `<mark>${token.slice(at, at + escapedNeedle.length)}</mark>`;
      cursor = at + escapedNeedle.length;
    }
    return output + token.slice(cursor);
  }).join("");
}

/** Counts literal occurrences of `query` across the raw (unescaped) content lines. */
export function countMatchingLines(lines: string[], query: string, caseSensitive: boolean): number[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
    if (haystack.includes(needle)) matches.push(index);
  }
  return matches;
}
