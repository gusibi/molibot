/**
 * Resolving a markdown file's sibling resources (its images) to loadable URLs.
 *
 * A leaf-bundle markdown file references its images relatively
 * (`![alt](cloudflare-error-1102.png)` sits next to `index.md`), but the
 * preview renders in the app's own document, where a relative `src` resolves
 * against the app origin and loads nothing. The fix is to resolve the
 * reference against the markdown file's own directory and stream the bytes
 * through the same file routes the panel already uses.
 */

/** `https:`, `data:`, `blob:`, any other scheme, and protocol-relative `//`. */
const NON_RELATIVE_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Resolves a markdown resource reference against the directory of the file
 * that contains it, returning a slash path relative to that file's root
 * (Project-relative in Project scope, workspace-relative in Session scope) —
 * the same root the file routes serve.
 *
 * Anything that is not a relative reference — an absolute URL, `data:`/
 * `blob:`, a root-absolute `/path`, or a reference that climbs above the root
 * — returns `null`, and the caller leaves the original href untouched.
 */
export function resolveRelativeResourcePath(baseDirectory: string, src: string): string | null {
  const value = String(src ?? "").trim();
  if (!value || value.startsWith("/") || NON_RELATIVE_PATTERN.test(value)) return null;
  const segments: string[] = [];
  for (const segment of `${baseDirectory}/${value}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/") || null;
}
