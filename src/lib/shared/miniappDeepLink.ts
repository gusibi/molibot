/**
 * Mini App deep links — `molibot://miniapp/<appId>/<path>`.
 *
 * The host's whole contract is "open that app's panel and hand `<path>` to its
 * UI". The path has no host-side meaning: it is an App-defined locator (an
 * entry id, a filter, a route), so this module validates *shape* and never
 * interprets it. That is what keeps the roadmap's "语义归 App" true in code
 * rather than only in prose.
 *
 * Deliberately not a URL the WebView can navigate to. It is parsed into an
 * intent and routed in-process, so a link can never become a page load, a new
 * origin, or a way to reach a path outside the panel.
 */

export const MINIAPP_DEEP_LINK_SCHEME = "molibot" as const;
export const MINIAPP_DEEP_LINK_HOST = "miniapp" as const;

/** Longer than any locator an app should need, short enough to stay a link. */
export const MINIAPP_DEEP_LINK_MAX_PATH_LENGTH = 512;

const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface MiniAppDeepLink {
  appId: string;
  /** App-defined locator without a leading slash; empty means "just open it". */
  path: string;
}

/**
 * Builds a deep link for an app-defined locator.
 *
 * Each path segment is percent-encoded, so an app may put arbitrary text in a
 * locator without having to know it will land in a URL.
 */
export function formatMiniAppDeepLink(appId: string, path = ""): string {
  const base = `${MINIAPP_DEEP_LINK_SCHEME}://${MINIAPP_DEEP_LINK_HOST}/${appId}`;
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed) return base;
  const encoded = trimmed.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${base}/${encoded}`;
}

/**
 * Parses a deep link, or returns null for anything that is not one.
 *
 * Returns null rather than throwing because every caller is handling untrusted
 * input (a tool result, an App message, an OS-delivered URL) where "not a deep
 * link" is an ordinary outcome, not an error.
 */
const LINK_PREFIX = `${MINIAPP_DEEP_LINK_SCHEME}://${MINIAPP_DEEP_LINK_HOST}/`;

export function parseMiniAppDeepLink(value: unknown): MiniAppDeepLink | null {
  if (typeof value !== "string" || value.length > MINIAPP_DEEP_LINK_MAX_PATH_LENGTH * 2) return null;

  // Parsed off the RAW string rather than through `new URL()`. The URL parser
  // resolves `..` inside the path before anything can inspect it, so
  // `molibot://miniapp/notes/../../etc/passwd` would arrive here already
  // rewritten to app `etc` — a link claiming one app silently addressing
  // another. Refusing traversal outright requires seeing the path unnormalized.
  if (!value.startsWith(LINK_PREFIX)) return null;

  // A query or fragment carries no meaning here; anything after them is not
  // part of the locator.
  const rest = value.slice(LINK_PREFIX.length).split(/[?#]/)[0];
  const segments = rest.split("/");
  const appId = decodeSegment(segments.shift() ?? "");
  if (!appId || !APP_ID_PATTERN.test(appId)) return null;

  const decoded: string[] = [];
  for (const segment of segments) {
    // A trailing slash produces an empty tail segment; anything else empty (or
    // a traversal step) means the link is malformed rather than merely odd.
    if (segment === "") continue;
    const part = decodeSegment(segment);
    if (part === null || part === "." || part === "..") return null;
    // One segment in, one segment out. A `%2F` would otherwise decode into a
    // separator and turn a single segment into two — including a `/../` that
    // reads as traversal to whatever the App does with the locator. The host
    // never treats this as a filesystem path, but an App author should never
    // have to defend against the host handing them a shape they did not send.
    if (part.includes("/") || part.includes("\\")) return null;
    decoded.push(part);
  }

  const path = decoded.join("/");
  if (path.length > MINIAPP_DEEP_LINK_MAX_PATH_LENGTH) return null;
  return { appId, path };
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed percent-escape is not a link we should guess at.
    return null;
  }
}

/** True when `value` is a deep link addressing `appId` and nothing else. */
export function isMiniAppDeepLinkFor(value: unknown, appId: string): boolean {
  const parsed = parseMiniAppDeepLink(value);
  return parsed !== null && parsed.appId === appId;
}
