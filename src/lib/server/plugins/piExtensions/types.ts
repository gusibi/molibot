import type {
  Extension,
  ExtensionRuntime,
  RegisteredCommand,
  RegisteredTool
} from "@earendil-works/pi-coding-agent";

/**
 * Capabilities a pi extension can register that Molibot has no surface for.
 * They are dropped silently at runtime, so the catalog carries them to the
 * settings UI instead of letting the extension look fully functional.
 */
export type UnsupportedPiCapability = "shortcuts" | "messageRenderers" | "entryRenderers";

export interface LoadedPiExtension {
  /** Install directory name below the extensions root. */
  id: string;
  /** Display name from the install dir's package.json, falling back to the id. */
  name: string;
  version: string;
  description?: string;
  /** Entry path as reported by pi's loader. */
  entryPath: string;
  /** Present only for unit-test fixtures. Production code lives in `client`'s subprocess. */
  extension?: Extension;
  client?: PiExtensionProcessClient;
  tools?: PiExtensionToolDescriptor[];
  commands?: Array<{ name: string; description?: string }>;
  toolNames: string[];
  eventNames: string[];
  eventHandlerCounts?: Record<string, number>;
  commandNames: string[];
  flagNames: string[];
  unsupported: UnsupportedPiCapability[];
}

export interface PiExtensionToolDescriptor {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  executionMode?: string;
}

export interface PiExtensionProcessDescriptor extends Omit<LoadedPiExtension, "extension" | "client"> {}

/**
 * Handles one worker-originated request (for example `executeTool`). A streaming
 * request pushes events through `emit` before returning its final value.
 */
export type PiExtensionHostRequestHandler = (method: string, input: any, emit: (event: unknown) => void) => Promise<any>;

export interface PiExtensionProcessClient {
  request(method: string, input: unknown, signal?: AbortSignal): Promise<any>;
  setFlags(flags: Record<string, unknown>): void;
  onFault(listener: (error: Error) => void): void;
  dispose(): void;
  /**
   * Bind a host session to a token so worker-originated requests during one
   * invocation route back to that run; released when the invocation settles.
   */
  registerHostSession(token: string, handler: PiExtensionHostRequestHandler): void;
  releaseHostSession(token: string): void;
}

/**
 * Serializable snapshot of the invoking run's state, handed to the extension
 * worker so its `ExtensionContext` reflects reality instead of placeholders.
 * Only what a server-side extension can legitimately read; credentials never
 * travel through it.
 */
export interface PiExtensionRuntimeSnapshot {
  cwd: string;
  systemPrompt: string;
  sessionId?: string;
  /** Serialized pi-ai `Model` (no headers), so `ctx.model.provider`/`id` are real. */
  model?: Record<string, unknown>;
  thinkingLevel?: string;
  /** Serialized `ScopedModel[]`; empty when no model scoping is configured. */
  scopedModels: Array<{ model: Record<string, unknown>; thinkingLevel?: string }>;
  isIdle: boolean;
  hasPendingMessages: boolean;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  /** Model discovery for `ctx.modelRegistry`; never carries credentials or provider objects. */
  models: PiExtensionModelCatalog;
  /** Read-only session view for `ctx.sessionManager`, from the native durable log. */
  session: PiExtensionSessionSnapshot;
}

/** One native durable entry projected for the read-only session view. */
export interface PiExtensionSessionEntry {
  id: string;
  kind: string;
  /** Model-visible messages this entry contributed to the active context. */
  messages: unknown[];
}

export interface PiExtensionSessionSnapshot {
  id?: string;
  cwd: string;
  file?: string;
  dir?: string;
  name?: string;
  entries: PiExtensionSessionEntry[];
}

export const EMPTY_PI_EXTENSION_SESSION: PiExtensionSessionSnapshot = { cwd: "", entries: [] };

/** A model as an extension sees it: identity only, no Provider object or credentials. */
export interface PiExtensionModelRef {
  provider: string;
  id: string;
  name: string;
  api: string;
}

export interface PiExtensionModelCatalog {
  chat: PiExtensionModelRef[];
  classifier: PiExtensionModelRef[];
  image: PiExtensionModelRef[];
  /** Provider id -> credentials configured. Availability, not permission. */
  providerAuth: Record<string, boolean>;
}

export const EMPTY_PI_EXTENSION_MODELS: PiExtensionModelCatalog = { chat: [], classifier: [], image: [], providerAuth: {} };

export interface PiExtensionLoadError {
  id: string;
  entryPath: string;
  error: string;
}

export interface PiExtensionLoadResult {
  extensions: LoadedPiExtension[];
  errors: PiExtensionLoadError[];
  /**
   * In-process runtime retained only for injected unit-test fixtures. Production
   * keeps pi's runtime inside `client`'s child process.
   */
  runtime: ExtensionRuntime | null;
  client?: PiExtensionProcessClient;
}

/** One row of the settings-page extension list. */
export interface PiExtensionCatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  entryPath: string;
  enabled: boolean;
  disabledBots: string[];
  toolNames: string[];
  eventNames: string[];
  commandNames: string[];
  unsupported: UnsupportedPiCapability[];
  /** Load failure, or a conflict that kept part of the extension inactive. */
  error?: string;
}

export type PiRegisteredTool = RegisteredTool;
export type PiRegisteredCommand = RegisteredCommand;
