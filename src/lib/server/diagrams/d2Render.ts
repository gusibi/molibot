const DEFAULT_D2_RENDER_ENDPOINT = "https://kroki.io";
export const MAX_D2_SOURCE_BYTES = 128 * 1024;
export const MAX_D2_OUTPUT_BYTES = 2 * 1024 * 1024;
export const D2_RENDER_TIMEOUT_MS = 12_000;
const D2_RENDER_CACHE_SIZE = 64;

export type D2RenderTheme = "light" | "dark";
export type D2RenderErrorCode = "renderer_unavailable" | "upstream_failed" | "invalid_renderer_output";

export class D2RenderError extends Error {
  readonly code: D2RenderErrorCode;

  constructor(code: D2RenderErrorCode) {
    super(code === "invalid_renderer_output" ? "The D2 renderer returned invalid SVG." : "The D2 renderer is unavailable.");
    this.name = "D2RenderError";
    this.code = code;
  }
}

export interface D2RenderOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const renderCache = new Map<string, string>();

function sourceByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

function normalizeEndpoint(endpoint: string): string {
  const value = endpoint.trim().replace(/\/$/, "");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("unsupported endpoint");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new D2RenderError("renderer_unavailable");
  }
}

function configuredEndpoint(explicit?: string): string {
  return normalizeEndpoint(explicit?.trim() || process.env.MOLIBOT_D2_RENDER_ENDPOINT?.trim() || DEFAULT_D2_RENDER_ENDPOINT);
}

function cacheSet(key: string, svg: string): void {
  if (renderCache.has(key)) renderCache.delete(key);
  renderCache.set(key, svg);
  while (renderCache.size > D2_RENDER_CACHE_SIZE) {
    const oldest = renderCache.keys().next().value;
    if (typeof oldest !== "string") break;
    renderCache.delete(oldest);
  }
}

export async function renderD2(source: string, theme: D2RenderTheme, options: D2RenderOptions = {}): Promise<string> {
  if (sourceByteLength(source) > MAX_D2_SOURCE_BYTES) {
    throw new D2RenderError("invalid_renderer_output");
  }

  const endpoint = configuredEndpoint(options.endpoint);
  const key = `${endpoint}\u0000${theme}\u0000${source}`;
  const cached = renderCache.get(key);
  if (cached) {
    renderCache.delete(key);
    renderCache.set(key, cached);
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? D2_RENDER_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoint}/d2/svg`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "image/svg+xml" },
        body: JSON.stringify({
          diagram_source: source,
          diagram_options: { layout: "elk", theme: theme === "dark" ? "200" : "0" }
        }),
        signal: controller.signal
      });
    } catch {
      throw new D2RenderError("upstream_failed");
    }

    if (!response.ok) throw new D2RenderError("upstream_failed");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("svg")) throw new D2RenderError("invalid_renderer_output");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_D2_OUTPUT_BYTES) throw new D2RenderError("invalid_renderer_output");
    const svg = new TextDecoder().decode(bytes);
    if (!/<svg\b[^>]*>/i.test(svg) || !/<\/svg\s*>/i.test(svg)) {
      throw new D2RenderError("invalid_renderer_output");
    }

    cacheSet(key, svg);
    return svg;
  } finally {
    clearTimeout(timeout);
  }
}
