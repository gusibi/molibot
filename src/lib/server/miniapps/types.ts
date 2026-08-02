/**
 * Mini App platform types.
 *
 * A Mini App is an owner-installed, pluggable application living under
 * `~/.molibot/miniapps/`. It contributes Agent tools *and* a hosted UI over one
 * private data directory. Tool handlers and HTTP handlers share a single
 * runtime instance so business rules exist exactly once.
 *
 * Only the shapes a Mini App author or a host caller needs live here; loading,
 * path safety, revision tracking and lifecycle stay inside `host.ts`.
 */

/** Risk hints an app declares per tool; the host maps them to a runtime risk. */
export interface MiniAppToolManifest {
  name: string;
  title?: string;
  description: string;
  keywords?: string[];
  /** JSON Schema (object) validated with Ajv before the handler runs. */
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface MiniAppManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  engines: { molibot: string };
  runtime: { entry: string };
  ui: { entry: string; /** Optional SVG/PNG shown in the sidebar and manager. */ icon?: string };
  data: { schemaVersion: number };
  tools: MiniAppToolManifest[];
}

/**
 * Where an installed app came from.
 *
 * This is a provenance record, not a permission boundary: app server code runs
 * in-process with no sandbox regardless of source. It exists so the manager can
 * tell the owner what they are running, and so a remote install can be
 * confirmed explicitly rather than silently.
 */
export type MiniAppInstallSource =
  | { kind: "builtin" }
  | { kind: "directory"; label: string }
  | { kind: "zip"; label: string }
  | { kind: "github"; repo: string; ref: string };

export type MiniAppStatus = "active" | "disabled" | "error" | "uninstalling";

/** What Settings / the plugin catalog may see. No host paths, no runtime. */
export interface MiniAppCatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  status: MiniAppStatus;
  enabled: boolean;
  /** True for apps the host ships and bootstraps (currently only `todo`). */
  builtin: boolean;
  hasUi: boolean;
  toolNames: string[];
  /**
   * The app's icon inlined as a `data:` URI, or empty.
   *
   * Inlined rather than served as a URL on purpose: the desktop sidebar would
   * otherwise need `img-src molibot-miniapp:` in the app CSP, and the Desktop
   * contract would have to carry a resolvable asset path. A small data URI
   * keeps both closed.
   */
  iconDataUri: string;
  /** Where this app came from. Display only — see {@link MiniAppInstallSource}. */
  source: MiniAppInstallSource;
  error?: string;
}

export interface MiniAppToolDescriptor {
  /** Internal, collision-proof registration name: `miniapp__<appId>__<tool>`. */
  toolId: string;
  /** Human-readable display name: `<appId>.<tool>`. */
  label: string;
  appId: string;
  appName: string;
  toolName: string;
  description: string;
  keywords: string[];
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

export interface MiniAppToolCallContext {
  toolCallId: string;
  signal?: AbortSignal;
}

export interface MiniAppToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  /** Set by the app when the call mutated data; bumps the app's revision. */
  changed?: boolean;
}

export type MiniAppHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface MiniAppHttpRequest {
  method: MiniAppHttpMethod;
  /** App-relative path, always starting with `/` (host strips the mount). */
  path: string;
  query: Record<string, string[]>;
  body: unknown;
  signal?: AbortSignal;
}

export interface MiniAppHttpResult {
  status?: number;
  body?: unknown;
  changed?: boolean;
}

export type MiniAppToolHandler = (
  input: unknown,
  context: MiniAppToolCallContext
) => Promise<MiniAppToolResult>;

export interface MiniAppLogger {
  info(event: string, detail?: Record<string, unknown>): void;
  warn(event: string, detail?: Record<string, unknown>): void;
  error(event: string, detail?: Record<string, unknown>): void;
}

/** What the host hands an app's factory. Deliberately tiny. */
export interface MiniAppRuntimeContext {
  appId: string;
  dataDir: string;
  logger: MiniAppLogger;
}

export interface MiniAppRuntime {
  tools: Record<string, MiniAppToolHandler>;
  handleHttp(request: MiniAppHttpRequest): Promise<MiniAppHttpResult>;
  dispose?(): void | Promise<void>;
}

export interface MiniAppServerModule {
  default: (context: MiniAppRuntimeContext) => MiniAppRuntime | Promise<MiniAppRuntime>;
}

/** Thrown across the host seam so callers get a stable, leak-free message. */
export class MiniAppError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "disabled"
      | "invalid_input"
      | "load_failed"
      | "busy"
      | "bad_request"
  ) {
    super(message);
    this.name = "MiniAppError";
  }
}

/** Maps `<appId>` + `<toolName>` to the internal registration name. */
export function miniAppToolId(appId: string, toolName: string): string {
  return `miniapp__${appId}__${toolName}`;
}

/** Inverse of {@link miniAppToolId}; null when the name is not a Mini App tool. */
export function parseMiniAppToolId(toolId: string): { appId: string; toolName: string } | null {
  if (!toolId.startsWith("miniapp__")) return null;
  const rest = toolId.slice("miniapp__".length);
  const separator = rest.indexOf("__");
  if (separator <= 0) return null;
  const appId = rest.slice(0, separator);
  const toolName = rest.slice(separator + 2);
  if (!appId || !toolName) return null;
  return { appId, toolName };
}
