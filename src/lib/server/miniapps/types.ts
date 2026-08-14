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

import type { MiniAppResultCard } from "$lib/shared/miniappCard.js";

export type { MiniAppResultCard };

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

export type MiniAppMessageActionAccept = "text" | "image" | "file";

export interface MiniAppMessageActionManifest {
  tool: string;
  label: { zh: string; en: string };
  icon?: string;
  /** Message text is accepted when omitted. */
  accepts: MiniAppMessageActionAccept[];
}

export interface MiniAppContributionsManifest {
  messageActions: MiniAppMessageActionManifest[];
}

export type MiniAppAiCapability = "text" | "transcription";

export interface MiniAppUploadLimitManifest {
  path: string;
  maxBytes: number;
}

export interface MiniAppAiManifest {
  capabilities: MiniAppAiCapability[];
  uploadLimits: MiniAppUploadLimitManifest[];
}

export type MiniAppHostCapability = "audioCapture";

export interface MiniAppHostManifest {
  capabilities: MiniAppHostCapability[];
}

export interface MessageCaptureResource {
  kind: "image" | "file";
  name: string;
  mime: string;
  /** Path relative to this App's dataDir. */
  path: string;
  bytes: number;
}

export interface MessageCaptureContext {
  text: string;
  selection?: string;
  role: "assistant" | "user";
  truncated: boolean;
  capturedAt: string;
  source: {
    sessionTitle?: string;
    channel: string;
  };
  resources?: MessageCaptureResource[];
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
  contributions?: MiniAppContributionsManifest;
  ai?: MiniAppAiManifest;
  host?: MiniAppHostManifest;
}

/**
 * Where an installed app came from.
 *
 * This is a provenance record, not a permission boundary: app server code has
 * a child-process fault boundary but still runs with the owner's OS permissions
 * regardless of source. It exists so the manager can tell the owner what they
 * are running, and so a remote install can be confirmed explicitly rather than
 * silently.
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
  messageActions: MiniAppMessageActionManifest[];
  aiCapabilities: MiniAppAiCapability[];
  hostCapabilities?: MiniAppHostCapability[];
  /** Live sidebar badge; null when the app has not set one. */
  badge: MiniAppBadge;
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
  /**
   * True when this build ships a newer copy of a built-in than the one
   * installed. Always false for a non-built-in: the host has no bundled copy to
   * compare an owner-installed app against.
   */
  updateAvailable: boolean;
  /** The version the bundle carries, or empty when there is no bundled copy. */
  availableVersion: string;
  error?: string;
}

/**
 * A built-in app as the manager's built-in tab sees it.
 *
 * Deliberately not a {@link MiniAppCatalogEntry}: that describes something
 * *installed*, and the whole job here is to describe an app the owner may not
 * have — so identity, description and icon come from the bundled copy, and the
 * installed side is optional. Keeping them apart is what stops the installed
 * list from having to grow a "maybe not really installed" row.
 */
export interface MiniAppBuiltinEntry {
  id: string;
  name: string;
  description: string;
  /** The version this Molibot build ships. */
  availableVersion: string;
  iconDataUri: string;
  toolNames: string[];
  installed: boolean;
  /** The version on disk; empty when not installed. */
  installedVersion: string;
  /** True when the shipped copy is newer than the installed one. */
  updateAvailable: boolean;
  /** Enablement of the installed copy; false when not installed. */
  enabled: boolean;
  status: MiniAppStatus | "not-installed";
  /**
   * True when the owner uninstalled this built-in. Purely informational: the
   * tombstone stops *automatic* reinstallation, never a deliberate one.
   */
  removedByOwner: boolean;
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
  /**
   * Optional summary card rendered beside the result.
   *
   * Never a substitute for `content`: the text is what the *model* reads and
   * what every non-desktop surface shows, while the card is a desktop
   * presentation extra. An app that puts information only in the card has
   * hidden it from the agent.
   */
  card?: MiniAppResultCard;
}

export type MiniAppHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface MiniAppHttpRequest {
  method: MiniAppHttpMethod;
  /** App-relative path, always starting with `/` (host strips the mount). */
  path: string;
  query: Record<string, string[]>;
  body: unknown;
  /** Present for controlled raw upload routes; JSON routes omit it. */
  contentType?: string;
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

export type MiniAppAiErrorCode =
  | "capability_not_declared"
  | "capability_unavailable"
  | "invalid_request"
  | "rate_limited"
  | "provider_failed"
  | "aborted";

export class MiniAppAiError extends Error {
  constructor(readonly code: MiniAppAiErrorCode, message: string) {
    super(message);
    this.name = "MiniAppAiError";
  }
}

export interface MiniAppAiTextResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface MiniAppAiFacade {
  generateText(input: {
    prompt: string;
    system?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<MiniAppAiTextResult>;
  transcribe(input: {
    path: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; durationSeconds: number }>;
}

/**
 * The sidebar badge an app may set on its own icon.
 *
 * `count` shows a number, `dot` shows an unlabelled marker for "something
 * changed", and `null` clears it. Deliberately the whole vocabulary: the
 * roadmap keeps this small on purpose — no system notification, no interrupting
 * popup, no severity levels. An app that needs to say something in a
 * conversation uses the event seam, not a louder badge.
 */
export type MiniAppBadge = { kind: "count"; count: number } | { kind: "dot" } | null;

/** Above this the badge reads as "a lot" rather than a number worth showing. */
export const MINIAPP_BADGE_MAX_COUNT = 99;

export interface MiniAppBadgeFacade {
  /**
   * Sets or clears this app's badge. Synchronous and in-memory: a badge is
   * live state about work in progress, so it resets when the service restarts
   * rather than resurrecting a stale count the app can no longer explain
   * (pitfall #23d — a stored field is not a status).
   */
  set(badge: MiniAppBadge): void;
  get(): MiniAppBadge;
  clear(): void;
}

/** What the host hands an app's factory. Deliberately tiny. */
export interface MiniAppRuntimeContext {
  appId: string;
  dataDir: string;
  logger: MiniAppLogger;
  ai: MiniAppAiFacade;
  badge: MiniAppBadgeFacade;
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
      | "forbidden"
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
