import type { ValidateFunction } from "ajv";

/**
 * The Molibot plugin manifest contract (issue #34).
 *
 * An installed package declares its Molibot contribution in
 * `package.json#molibot.plugin`, alongside whatever pi package metadata it
 * already carries. There is deliberately no second `molibot.plugin.json`
 * format - one package, one manifest.
 *
 * Validation lives in `manifest.ts` and is strict on purpose: an unknown key
 * is a catalog error, not a silent no-op, so a typo surfaces as a diagnosable
 * entry instead of a plugin that loads with half its behaviour missing.
 */

/** `^[a-z][a-z0-9-]{1,62}$` - also the on-disk package directory name. */
export type PluginId = string;

/** Localized display text. Both locales are required, no partial labels. */
export interface PluginLocalizedText {
  zh: string;
  en: string;
}

/** Presentation metadata for one schema-mode settings field. */
export interface PluginSchemaFieldPresentation {
  key: string;
  label: PluginLocalizedText;
  description?: PluginLocalizedText;
  /** Secret fields round-trip as presence metadata only (replace or clear). */
  secret?: boolean;
  placeholder?: string;
}

export interface PluginSchemaSettingsManifest {
  mode: "schema";
  /** Plugin-owned JSON Schema (type object) the host renders natively. */
  schema: Record<string, unknown>;
  presentation?: PluginSchemaFieldPresentation[];
}

export interface PluginCustomSettingsManifest {
  mode: "custom";
  /** Optional plugin-owned validation schema for values saved by its UI. */
  schema?: Record<string, unknown>;
  /** Settings UI entry (an HTML document inside the package's `ui/` dir). */
  ui: {
    entry: string;
    icon?: string;
  };
}

export type PluginSettingsManifest =
  | PluginSchemaSettingsManifest
  | PluginCustomSettingsManifest;

/**
 * Capabilities a plugin's settings actions may rely on. Declared, validated
 * metadata in V1 - process isolation is a reliability boundary, not a
 * permission sandbox, so these inform the catalog and host logging rather than
 * gating syscalls.
 */
export type PluginCapability = "spawn" | "network";

export interface MolibotPluginManifest {
  manifestVersion: 1;
  id: PluginId;
  name: string;
  version: string;
  description?: string;
  /** Host engine range, checked against the running Molibot version. */
  engines: { molibot: string };
  /**
   * Settings-action runtime entry (.mjs ES module inside the package), loaded
   * in the plugin fault domain. Required for custom settings mode, unused
   * otherwise.
   */
  runtime?: {
    entry: string;
    /** Explicit public action surface exported by the runtime module. */
    actions: string[];
  };
  settings?: PluginSettingsManifest;
  /** Version of the plugin's configuration document. */
  config: { schemaVersion: number };
  capabilities?: PluginCapability[];
}

export interface ValidatedPluginManifest {
  manifest: MolibotPluginManifest;
  /** Absolute, realpath-contained path to the runtime entry (custom mode). */
  runtimeEntryPath: string | null;
  /** Absolute, realpath-contained path to the settings UI entry (custom mode). */
  settingsUiEntryPath: string | null;
  /** Absolute path to the package's `ui/` directory (asset serving root). */
  settingsUiRootPath: string | null;
  /** Absolute path to the declared icon, when the manifest declares a valid one. */
  iconPath: string | null;
  /** Compiled Ajv validator for schema-mode settings values. */
  settingsValidator: ValidateFunction | null;
}

export type PluginManifestResult =
  | { ok: true; value: ValidatedPluginManifest }
  | { ok: false; error: string };

/** Result of reading a plugin's persisted configuration document. */
export type PluginConfigReadResult =
  | { status: "missing" }
  | { status: "ok"; schemaVersion: number; values: Record<string, unknown> }
  | {
      status: "incompatible";
      /** The schemaVersion found on disk, unsupported by the package. */
      foundSchemaVersion: number;
    };

/** A write rejected before persistence - the previous file stays intact. */
export interface PluginConfigWriteError {
  code:
    | "invalid_id"
    | "validation_failed"
    | "too_large"
    | "write_failed";
  message: string;
}
