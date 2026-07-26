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
  extension: Extension;
  toolNames: string[];
  eventNames: string[];
  commandNames: string[];
  flagNames: string[];
  unsupported: UnsupportedPiCapability[];
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
   * Shared runtime created by pi's loader. Its action methods are throwing
   * stubs; Molibot binds the ones it supports per run. `flagValues` is the
   * backing store `api.getFlag` reads from.
   */
  runtime: ExtensionRuntime | null;
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
