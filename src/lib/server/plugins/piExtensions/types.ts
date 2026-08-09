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

export interface PiExtensionProcessClient {
  request(method: string, input: unknown, signal?: AbortSignal): Promise<any>;
  setFlags(flags: Record<string, unknown>): void;
  onFault(listener: (error: Error) => void): void;
  dispose(): void;
}

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
