import fs from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import semver from "semver";
import { getMolibotVersion } from "$lib/server/miniapps/hostVersion.js";
import { resolveContainedPath } from "$lib/server/infra/pathSafety.js";
import { isValidPluginId } from "$lib/server/plugins/contract/paths.js";
import type {
  MolibotPluginManifest,
  PluginCapability,
  PluginCustomSettingsManifest,
  PluginLocalizedText,
  PluginManifestResult,
  PluginSchemaFieldPresentation,
  PluginSchemaSettingsManifest,
  PluginSettingsManifest,
  ValidatedPluginManifest
} from "$lib/server/plugins/contract/types.js";

/**
 * Reading and validating `package.json#molibot.plugin`.
 *
 * Validation is strict on purpose: an unknown key is an error rather than a
 * silent no-op, so a typo surfaces as a visible catalog error instead of a
 * plugin that loads with half its behaviour missing. A schema-mode settings
 * schema is compiled here, at discovery time - a schema Ajv cannot compile
 * fails the whole plugin rather than failing later, mid-save, on the first
 * submission.
 */

const MANIFEST_CONTAINER_KEYS = new Set(["plugin"]);
const ALLOWED_MANIFEST_KEYS = new Set([
  "manifestVersion",
  "id",
  "name",
  "version",
  "description",
  "engines",
  "runtime",
  "settings",
  "config",
  "capabilities"
]);

const ALLOWED_SETTINGS_KEYS = new Set(["mode", "schema", "presentation", "ui"]);
const ALLOWED_SCHEMA_FIELD_KEYS = new Set(["key", "label", "description", "secret", "placeholder"]);
const ALLOWED_UI_KEYS = new Set(["entry", "icon"]);
const ALLOWED_RUNTIME_KEYS = new Set(["entry", "actions"]);
const ACTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const PLUGIN_CAPABILITIES = new Set<PluginCapability>(["spawn", "network"]);

/** Icon formats the desktop can inline as a data URI. */
const ICON_EXTENSIONS = [".svg", ".png"] as const;
/** Icons ride along in every catalog response, so they stay small. */
const MAX_ICON_BYTES = 64 * 1024;

function fail(error: string): PluginManifestResult {
  return { ok: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateLocalizedText(raw: unknown, where: string): PluginLocalizedText | null {
  if (!isPlainObject(raw)) return null;
  const zh = typeof raw.zh === "string" ? raw.zh.trim() : "";
  const en = typeof raw.en === "string" ? raw.en.trim() : "";
  if (!zh || !en) return null;
  if (Object.keys(raw).some((key) => key !== "zh" && key !== "en")) return null;
  return { zh, en };
}

function validateSchemaPresentation(
  raw: unknown,
  schemaProperties: Record<string, unknown>
): PluginSchemaFieldPresentation[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "settings.presentation must be a non-empty array.";
  }
  const fields: PluginSchemaFieldPresentation[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) return `settings.presentation[${index}] must be an object.`;
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_SCHEMA_FIELD_KEYS.has(key)) {
        return `settings.presentation[${index}] has unknown field "${key}".`;
      }
    }
    const key = entry.key;
    if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      return `settings.presentation[${index}].key must match ^[A-Za-z][A-Za-z0-9_]{0,63}$.`;
    }
    if (seen.has(key)) return `settings.presentation declares "${key}" twice.`;
    seen.add(key);
    if (!isPlainObject(schemaProperties[key])) {
      return `settings.presentation key "${key}" is not declared in settings.schema.properties.`;
    }
    const label = validateLocalizedText(entry.label, `settings.presentation[${index}].label`);
    if (!label) {
      return `settings.presentation[${index}].label must contain only non-empty zh and en strings.`;
    }
    let description: PluginLocalizedText | undefined;
    if (entry.description !== undefined) {
      const parsed = validateLocalizedText(entry.description, "");
      if (!parsed) {
        return `settings.presentation[${index}].description must contain only non-empty zh and en strings.`;
      }
      description = parsed;
    }
    if (entry.secret === true && schemaProperties[key]?.type !== "string") {
      return `settings.presentation key "${key}" is secret, so settings.schema must declare it as a string.`;
    }
    if (entry.placeholder !== undefined && typeof entry.placeholder !== "string") {
      return `settings.presentation[${index}].placeholder must be a string.`;
    }
    fields.push({
      key,
      label,
      ...(description ? { description } : {}),
      ...(entry.secret === true ? { secret: true } : {}),
      ...(typeof entry.placeholder === "string" ? { placeholder: entry.placeholder } : {})
    });
  }
  return fields;
}

/**
 * Reads and fully validates `package.json#molibot.plugin` from `packageDir`.
 *
 * `packageDir` must already be a realpath-contained directory under the
 * packages root; `expectedId` is the directory name, which the manifest id
 * must equal.
 */
export function readMolibotPluginManifest(packageDir: string, expectedId: string): PluginManifestResult {
  let rawText: string;
  try {
    rawText = fs.readFileSync(path.join(packageDir, "package.json"), "utf8");
  } catch {
    return fail("Missing package.json.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(`Invalid package.json: ${message}`);
  }
  if (!isPlainObject(parsed)) return fail("package.json must contain an object.");

  const container = parsed.molibot;
  if (!isPlainObject(container)) return fail("package.json#molibot.plugin is missing.");
  for (const key of Object.keys(container)) {
    if (!MANIFEST_CONTAINER_KEYS.has(key)) {
      return fail(`package.json#molibot has unknown field "${key}".`);
    }
  }

  const raw = container.plugin;
  if (!isPlainObject(raw)) return fail("package.json#molibot.plugin must be an object.");

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      return fail(`molibot.plugin has unknown field "${key}".`);
    }
  }

  if (raw.manifestVersion !== 1) return fail("molibot.plugin.manifestVersion must be 1.");

  if (!isValidPluginId(raw.id)) return fail("molibot.plugin.id must match ^[a-z][a-z0-9-]{1,62}$.");
  if (raw.id !== expectedId) {
    return fail(`Manifest id "${raw.id}" does not match directory name "${expectedId}".`);
  }

  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) return fail("molibot.plugin.name is required.");

  const version = raw.version;
  if (typeof version !== "string" || !semver.valid(version)) {
    return fail("molibot.plugin.version must be a valid SemVer string.");
  }

  if (raw.description !== undefined && typeof raw.description !== "string") {
    return fail("molibot.plugin.description must be a string.");
  }

  if (!isPlainObject(raw.engines) || typeof raw.engines.molibot !== "string") {
    return fail("molibot.plugin.engines.molibot is required.");
  }
  const range = raw.engines.molibot;
  if (!semver.validRange(range)) return fail(`molibot.plugin.engines.molibot is not a valid SemVer range: ${range}`);
  const hostVersion = getMolibotVersion();
  if (hostVersion && !semver.satisfies(hostVersion, range, { includePrerelease: true })) {
    return fail(`Requires Molibot ${range}, but this host is ${hostVersion}.`);
  }

  if (!isPlainObject(raw.config) || !Number.isInteger(raw.config.schemaVersion)) {
    return fail("molibot.plugin.config.schemaVersion must be an integer.");
  }
  const configSchemaVersion = raw.config.schemaVersion as number;
  if (configSchemaVersion < 1) return fail("molibot.plugin.config.schemaVersion must be >= 1.");
  for (const key of Object.keys(raw.config)) {
    if (key !== "schemaVersion") return fail(`molibot.plugin.config has unknown field "${key}".`);
  }

  let capabilities: PluginCapability[] | undefined;
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
      return fail("molibot.plugin.capabilities must be a non-empty array.");
    }
    const seen = new Set<string>();
    for (const capability of raw.capabilities) {
      if (typeof capability !== "string" || !PLUGIN_CAPABILITIES.has(capability as PluginCapability)) {
        return fail("molibot.plugin.capabilities contains an unsupported value.");
      }
      if (seen.has(capability)) return fail(`molibot.plugin.capabilities declares "${capability}" twice.`);
      seen.add(capability);
    }
    capabilities = raw.capabilities as PluginCapability[];
  }

  // Runtime entry: required only for custom settings mode, always a .mjs ES
  // module inside the package - the settings-action worker loads it.
  let runtimeEntryPath: string | null = null;
  let runtimeEntry: string | undefined;
  let runtimeActions: string[] | undefined;
  if (raw.runtime !== undefined) {
    if (!isPlainObject(raw.runtime) || typeof raw.runtime.entry !== "string") {
      return fail("molibot.plugin.runtime.entry is required when runtime is present.");
    }
    for (const key of Object.keys(raw.runtime)) {
      if (!ALLOWED_RUNTIME_KEYS.has(key)) return fail(`molibot.plugin.runtime has unknown field "${key}".`);
    }
    if (!Array.isArray(raw.runtime.actions) || raw.runtime.actions.length === 0) {
      return fail("molibot.plugin.runtime.actions must be a non-empty array.");
    }
    const seenActions = new Set<string>();
    for (const action of raw.runtime.actions) {
      if (typeof action !== "string" || !ACTION_NAME_PATTERN.test(action)) {
        return fail("molibot.plugin.runtime.actions contains an invalid action name.");
      }
      if (seenActions.has(action)) return fail(`molibot.plugin.runtime.actions declares "${action}" twice.`);
      seenActions.add(action);
    }
    runtimeActions = [...seenActions];
    runtimeEntry = raw.runtime.entry;
    if (!runtimeEntry.endsWith(".mjs")) {
      return fail("molibot.plugin.runtime.entry must be a .mjs ES module inside the package.");
    }
    runtimeEntryPath = resolveContainedPath(packageDir, runtimeEntry, { requireFile: true });
    if (!runtimeEntryPath) return fail(`runtime.entry "${runtimeEntry}" is missing or escapes the package directory.`);
  }

  let settings: PluginSettingsManifest | undefined;
  let settingsValidator: ValidateFunction | null = null;
  let settingsUiEntryPath: string | null = null;
  let settingsUiRootPath: string | null = null;
  let iconPath: string | null = null;

  if (raw.settings !== undefined) {
    if (!isPlainObject(raw.settings)) return fail("molibot.plugin.settings must be an object.");
    for (const key of Object.keys(raw.settings)) {
      if (!ALLOWED_SETTINGS_KEYS.has(key)) {
        return fail(`molibot.plugin.settings has unknown field "${key}".`);
      }
    }
    if (raw.settings.mode === "schema") {
      const schema = raw.settings.schema;
      if (!isPlainObject(schema) || schema.type !== "object") {
        return fail("molibot.plugin.settings.schema must be an object JSON Schema.");
      }
      for (const key of Object.keys(raw.settings)) {
        if (key !== "mode" && key !== "schema" && key !== "presentation") {
          return fail(`molibot.plugin.settings has unknown field "${key}".`);
        }
      }
      try {
        settingsValidator = new Ajv({ allErrors: true, strict: false }).compile(schema);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return fail(`molibot.plugin.settings.schema failed to compile: ${message}`);
      }
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      let presentation: PluginSchemaFieldPresentation[] | undefined;
      if (raw.settings.presentation !== undefined) {
        const result = validateSchemaPresentation(raw.settings.presentation, properties);
        if (typeof result === "string") return fail(`molibot.plugin.${result}`);
        presentation = result;
      }
      settings = { mode: "schema", schema, ...(presentation ? { presentation } : {}) } satisfies PluginSchemaSettingsManifest;
    } else if (raw.settings.mode === "custom") {
      if (!isPlainObject(raw.settings.ui) || typeof raw.settings.ui.entry !== "string") {
        return fail("molibot.plugin.settings.ui.entry is required for custom mode.");
      }
      for (const key of Object.keys(raw.settings.ui)) {
        if (!ALLOWED_UI_KEYS.has(key)) {
          return fail(`molibot.plugin.settings.ui has unknown field "${key}".`);
        }
      }
      const uiEntry = raw.settings.ui.entry;
      if (!uiEntry.startsWith("ui/")) {
        return fail("molibot.plugin.settings.ui.entry must live inside the package's ui/ directory.");
      }
      settingsUiEntryPath = resolveContainedPath(packageDir, uiEntry, { requireFile: true });
      if (!settingsUiEntryPath) return fail(`settings.ui.entry "${uiEntry}" is missing or escapes the package directory.`);
      settingsUiRootPath = resolveContainedPath(packageDir, "ui");
      if (!settingsUiRootPath) return fail("ui/ directory is missing or escapes the package directory.");

      const iconEntry = raw.settings.ui.icon;
      if (iconEntry !== undefined) {
        if (typeof iconEntry !== "string") return fail("molibot.plugin.settings.ui.icon must be a string.");
        if (!iconEntry.startsWith("ui/")) return fail("molibot.plugin.settings.ui.icon must live inside the package's ui/ directory.");
        if (!ICON_EXTENSIONS.some((extension) => iconEntry.toLowerCase().endsWith(extension))) {
          return fail(`molibot.plugin.settings.ui.icon must be one of: ${ICON_EXTENSIONS.join(", ")}.`);
        }
        iconPath = resolveContainedPath(packageDir, iconEntry, { requireFile: true });
        if (!iconPath) return fail(`settings.ui.icon "${iconEntry}" is missing or escapes the package directory.`);
        let iconSize = 0;
        try {
          iconSize = fs.statSync(iconPath).size;
        } catch {
          return fail(`settings.ui.icon "${iconEntry}" could not be read.`);
        }
        if (iconSize > MAX_ICON_BYTES) {
          return fail(`settings.ui.icon must be at most ${Math.floor(MAX_ICON_BYTES / 1024)} KB.`);
        }
      }

      if (!runtimeEntryPath) {
        return fail("molibot.plugin.runtime.entry is required for custom settings mode.");
      }
      let schema: Record<string, unknown> | undefined;
      if (raw.settings.schema !== undefined) {
        if (!isPlainObject(raw.settings.schema) || raw.settings.schema.type !== "object") {
          return fail("molibot.plugin.settings.schema must be an object JSON Schema.");
        }
        schema = raw.settings.schema;
        try {
          settingsValidator = new Ajv({ allErrors: true, strict: false }).compile(schema);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          return fail(`molibot.plugin.settings.schema failed to compile: ${message}`);
        }
      }
      settings = {
        mode: "custom",
        ...(schema ? { schema } : {}),
        ui: { entry: uiEntry, ...(iconEntry !== undefined ? { icon: iconEntry as string } : {}) }
      } satisfies PluginCustomSettingsManifest;
    } else {
      return fail('molibot.plugin.settings.mode must be "schema" or "custom".');
    }
  }

  const manifest: MolibotPluginManifest = {
    manifestVersion: 1,
    id: raw.id,
    name,
    version,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    engines: { molibot: range },
    ...(runtimeEntry && runtimeActions ? { runtime: { entry: runtimeEntry, actions: runtimeActions } } : {}),
    ...(settings ? { settings } : {}),
    config: { schemaVersion: configSchemaVersion },
    ...(capabilities ? { capabilities } : {})
  };

  const value: ValidatedPluginManifest = {
    manifest,
    runtimeEntryPath,
    settingsUiEntryPath,
    settingsUiRootPath,
    iconPath,
    settingsValidator
  };
  return { ok: true, value };
}
