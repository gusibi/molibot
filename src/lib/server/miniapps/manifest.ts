import fs from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import semver from "semver";
import { getMolibotVersion } from "$lib/server/miniapps/hostVersion.js";
import {
  isValidMiniAppId,
  isValidMiniAppToolName,
  resolveContainedPath
} from "$lib/server/miniapps/paths.js";
import type {
  MiniAppManifest,
  MiniAppAiCapability,
  MiniAppAiManifest,
  MiniAppMessageActionAccept,
  MiniAppMessageActionManifest,
  MiniAppToolManifest
} from "$lib/server/miniapps/types.js";

/**
 * Manifest reading and validation.
 *
 * Validation is strict on purpose: an unknown top-level key is an error rather
 * than a silent no-op, so a typo in `tools` or `runtime` surfaces as a visible
 * catalog error instead of an app that loads with half its behaviour missing.
 *
 * Every tool's `inputSchema` is compiled here, at discovery time. A schema that
 * Ajv cannot compile fails the whole app rather than failing later, mid-call,
 * on the first invocation.
 */

const MANIFEST_FILENAME = "manifest.json";

/** Icon formats the desktop can inline as a data URI. */
const ICON_EXTENSIONS = [".svg", ".png"] as const;
/** Icons ride along in every catalog response, so they stay small. */
const MAX_ICON_BYTES = 64 * 1024;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "manifestVersion",
  "id",
  "name",
  "version",
  "description",
  "engines",
  "runtime",
  "ui",
  "data",
  "tools",
  "contributions",
  "ai"
]);

const ALLOWED_TOOL_KEYS = new Set([
  "name",
  "title",
  "description",
  "keywords",
  "inputSchema",
  "readOnlyHint",
  "destructiveHint"
]);

const ALLOWED_CONTRIBUTION_KEYS = new Set(["messageActions"]);
const ALLOWED_MESSAGE_ACTION_KEYS = new Set(["tool", "label", "icon", "accepts"]);
const MESSAGE_ACTION_ACCEPTS = new Set<MiniAppMessageActionAccept>(["text", "image", "file"]);
const MESSAGE_ACTION_ICON_PATTERN = /^[a-z0-9-]+$/;
const ALLOWED_AI_KEYS = new Set(["capabilities", "uploadLimits"]);
const ALLOWED_UPLOAD_LIMIT_KEYS = new Set(["path", "maxBytes"]);
const AI_CAPABILITIES = new Set<MiniAppAiCapability>(["text", "transcription"]);
const MAX_AI_UPLOAD_BYTES = 25 * 1024 * 1024;

function validateAiManifest(raw: unknown): { ok: true; value: MiniAppAiManifest } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "ai must be an object." };
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_AI_KEYS.has(key)) return { ok: false, error: `ai has unknown field "${key}".` };
  }
  if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
    return { ok: false, error: "ai.capabilities must be a non-empty array." };
  }
  const capabilities: MiniAppAiCapability[] = [];
  for (const capability of raw.capabilities) {
    if (typeof capability !== "string" || !AI_CAPABILITIES.has(capability as MiniAppAiCapability)) {
      return { ok: false, error: "ai.capabilities contains an unsupported value." };
    }
    if (!capabilities.includes(capability as MiniAppAiCapability)) capabilities.push(capability as MiniAppAiCapability);
  }
  const uploadLimitsRaw = raw.uploadLimits ?? [];
  if (!Array.isArray(uploadLimitsRaw)) return { ok: false, error: "ai.uploadLimits must be an array." };
  if (uploadLimitsRaw.length > 10) return { ok: false, error: "ai.uploadLimits may contain at most 10 routes." };
  if (uploadLimitsRaw.length > 0 && !capabilities.includes("transcription")) {
    return { ok: false, error: "ai.uploadLimits requires the transcription capability." };
  }
  const uploadLimits = [];
  const seenPaths = new Set<string>();
  for (const [index, entry] of uploadLimitsRaw.entries()) {
    if (!isPlainObject(entry)) return { ok: false, error: `ai.uploadLimits[${index}] must be an object.` };
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_UPLOAD_LIMIT_KEYS.has(key)) return { ok: false, error: `ai.uploadLimits[${index}] has unknown field "${key}".` };
    }
    const routePath = typeof entry.path === "string" ? entry.path.trim() : "";
    if (!/^\/api\/[A-Za-z0-9._~!$&'()+,;=:@%/-]+$/.test(routePath) || routePath.includes("..") || routePath.includes("//")) {
      return { ok: false, error: `ai.uploadLimits[${index}].path must be a normalized /api/* path.` };
    }
    if (seenPaths.has(routePath)) return { ok: false, error: `Duplicate upload route "${routePath}".` };
    seenPaths.add(routePath);
    if (!Number.isInteger(entry.maxBytes) || Number(entry.maxBytes) < 1 || Number(entry.maxBytes) > MAX_AI_UPLOAD_BYTES) {
      return { ok: false, error: `ai.uploadLimits[${index}].maxBytes must be between 1 and 25 MiB.` };
    }
    uploadLimits.push({ path: routePath, maxBytes: Number(entry.maxBytes) });
  }
  return { ok: true, value: { capabilities, uploadLimits } };
}

export interface ValidatedMiniAppManifest {
  manifest: MiniAppManifest;
  /** Absolute, realpath-contained path to the runtime entry module. */
  entryPath: string;
  /** Absolute, realpath-contained path to the UI entry HTML. */
  uiEntryPath: string;
  /** Absolute path to the app's `ui/` directory (asset serving root). */
  uiRootPath: string;
  /** Absolute path to the declared icon, when the manifest declares a valid one. */
  iconPath: string | null;
  /** Compiled Ajv validators, keyed by tool name. */
  validators: Map<string, ValidateFunction>;
}

export type MiniAppManifestResult =
  | { ok: true; value: ValidatedMiniAppManifest }
  | { ok: false; error: string };

function fail(error: string): MiniAppManifestResult {
  return { ok: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateToolEntry(
  raw: unknown,
  index: number,
  seen: Set<string>,
  ajv: Ajv,
  validators: Map<string, ValidateFunction>
): { ok: true; value: MiniAppToolManifest } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: `tools[${index}] must be an object.` };

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOOL_KEYS.has(key)) {
      return { ok: false, error: `tools[${index}] has unknown field "${key}".` };
    }
  }

  const name = raw.name;
  if (!isValidMiniAppToolName(name)) {
    return { ok: false, error: `tools[${index}].name must match ^[a-z][a-z0-9_-]{0,63}$.` };
  }
  if (seen.has(name)) return { ok: false, error: `Duplicate tool name "${name}".` };
  seen.add(name);

  const description = raw.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    return { ok: false, error: `tools[${index}].description is required.` };
  }

  if (raw.title !== undefined && typeof raw.title !== "string") {
    return { ok: false, error: `tools[${index}].title must be a string.` };
  }

  let keywords: string[] = [];
  if (raw.keywords !== undefined) {
    if (!Array.isArray(raw.keywords) || raw.keywords.some((word) => typeof word !== "string")) {
      return { ok: false, error: `tools[${index}].keywords must be an array of strings.` };
    }
    keywords = (raw.keywords as string[]).map((word) => word.trim()).filter(Boolean);
  }

  const inputSchema = raw.inputSchema;
  if (!isPlainObject(inputSchema) || inputSchema.type !== "object") {
    return { ok: false, error: `tools[${index}].inputSchema must be an object JSON Schema.` };
  }

  const readOnlyHint = raw.readOnlyHint;
  const destructiveHint = raw.destructiveHint;
  if (readOnlyHint !== undefined && typeof readOnlyHint !== "boolean") {
    return { ok: false, error: `tools[${index}].readOnlyHint must be a boolean.` };
  }
  if (destructiveHint !== undefined && typeof destructiveHint !== "boolean") {
    return { ok: false, error: `tools[${index}].destructiveHint must be a boolean.` };
  }
  if (readOnlyHint === true && destructiveHint === true) {
    return { ok: false, error: `tools[${index}] cannot be both readOnlyHint and destructiveHint.` };
  }

  try {
    validators.set(name, ajv.compile(inputSchema));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `tools[${index}].inputSchema failed to compile: ${message}` };
  }

  return {
    ok: true,
    value: {
      name,
      title: typeof raw.title === "string" ? raw.title : undefined,
      description,
      keywords,
      inputSchema,
      readOnlyHint: readOnlyHint === true,
      destructiveHint: destructiveHint === true
    }
  };
}

function validateMessageActions(
  raw: unknown,
  tools: MiniAppToolManifest[]
): { ok: true; value: MiniAppMessageActionManifest[] } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "contributions must be an object." };
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_CONTRIBUTION_KEYS.has(key)) {
      return { ok: false, error: `contributions has unknown field "${key}".` };
    }
  }
  if (!Array.isArray(raw.messageActions) || raw.messageActions.length === 0) {
    return { ok: false, error: "contributions.messageActions must be a non-empty array." };
  }
  if (raw.messageActions.length > 3) {
    return { ok: false, error: "contributions.messageActions may contain at most 3 actions." };
  }

  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const actions: MiniAppMessageActionManifest[] = [];
  for (const [index, entry] of raw.messageActions.entries()) {
    if (!isPlainObject(entry)) {
      return { ok: false, error: `contributions.messageActions[${index}] must be an object.` };
    }
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_MESSAGE_ACTION_KEYS.has(key)) {
        return { ok: false, error: `contributions.messageActions[${index}] has unknown field "${key}".` };
      }
    }

    const toolName = entry.tool;
    if (typeof toolName !== "string" || !toolName) {
      return { ok: false, error: `contributions.messageActions[${index}].tool is required.` };
    }
    const tool = toolsByName.get(toolName);
    if (!tool) {
      return { ok: false, error: `contributions.messageActions[${index}].tool must name a declared tool.` };
    }
    if (tool.destructiveHint) {
      return { ok: false, error: `contributions.messageActions[${index}] cannot invoke destructive tool "${toolName}".` };
    }

    if (!isPlainObject(entry.label)) {
      return { ok: false, error: `contributions.messageActions[${index}].label must contain zh and en.` };
    }
    const zh = typeof entry.label.zh === "string" ? entry.label.zh.trim() : "";
    const en = typeof entry.label.en === "string" ? entry.label.en.trim() : "";
    if (!zh || !en || Object.keys(entry.label).some((key) => key !== "zh" && key !== "en")) {
      return { ok: false, error: `contributions.messageActions[${index}].label must contain only non-empty zh and en strings.` };
    }

    const icon = entry.icon;
    if (icon !== undefined && (typeof icon !== "string" || !MESSAGE_ACTION_ICON_PATTERN.test(icon))) {
      return { ok: false, error: `contributions.messageActions[${index}].icon must match ^[a-z0-9-]+$.` };
    }

    const acceptsRaw = entry.accepts ?? ["text"];
    if (!Array.isArray(acceptsRaw) || acceptsRaw.length === 0) {
      return { ok: false, error: `contributions.messageActions[${index}].accepts must be a non-empty array.` };
    }
    const accepts: MiniAppMessageActionAccept[] = [];
    for (const accept of acceptsRaw) {
      if (typeof accept !== "string" || !MESSAGE_ACTION_ACCEPTS.has(accept as MiniAppMessageActionAccept)) {
        return { ok: false, error: `contributions.messageActions[${index}].accepts contains an unsupported value.` };
      }
      if (!accepts.includes(accept as MiniAppMessageActionAccept)) accepts.push(accept as MiniAppMessageActionAccept);
    }

    const schema = tool.inputSchema;
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    if (schema.additionalProperties === false && !Object.prototype.hasOwnProperty.call(properties, "capture")) {
      return {
        ok: false,
        error: `Tool "${toolName}" must allow a capture property in inputSchema before it can be a message action.`
      };
    }

    actions.push({
      tool: toolName,
      label: { zh, en },
      ...(typeof icon === "string" ? { icon } : {}),
      accepts
    });
  }
  return { ok: true, value: actions };
}

/**
 * True when `<appDir>/manifest.json` exists as a regular file — the cheap
 * "does this directory even claim to be a Mini App" probe used by discovery.
 *
 * Anything else in the code root (a downloaded `.zip`, a scratch folder, a
 * symlink to a file) fails this and is skipped silently: it can neither be
 * installed nor uninstalled, so surfacing it in the catalog is pure noise.
 */
export function hasMiniAppManifestFile(appDir: string): boolean {
  try {
    return fs.statSync(path.join(appDir, MANIFEST_FILENAME)).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads and fully validates `<appDir>/manifest.json`.
 *
 * `appDir` must already be a realpath-contained directory under the code root;
 * `expectedId` is the directory name, which the manifest id must equal.
 */
export function readMiniAppManifest(appDir: string, expectedId: string): MiniAppManifestResult {
  const manifestPath = path.join(appDir, MANIFEST_FILENAME);
  let rawText: string;
  try {
    rawText = fs.readFileSync(manifestPath, "utf8");
  } catch {
    return fail(`Missing ${MANIFEST_FILENAME}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(`Invalid ${MANIFEST_FILENAME}: ${message}`);
  }

  if (!isPlainObject(parsed)) return fail(`${MANIFEST_FILENAME} must contain an object.`);

  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return fail(`Unknown manifest field "${key}".`);
    }
  }

  if (parsed.manifestVersion !== 1) {
    return fail("manifestVersion must be 1.");
  }

  if (!isValidMiniAppId(parsed.id)) {
    return fail("id must match ^[a-z][a-z0-9-]{1,62}$.");
  }
  if (parsed.id !== expectedId) {
    return fail(`Manifest id "${parsed.id}" does not match directory name "${expectedId}".`);
  }

  const name = parsed.name;
  if (typeof name !== "string" || name.trim().length === 0) return fail("name is required.");

  const version = parsed.version;
  if (typeof version !== "string" || !semver.valid(version)) {
    return fail("version must be a valid SemVer string.");
  }

  if (parsed.description !== undefined && typeof parsed.description !== "string") {
    return fail("description must be a string.");
  }

  if (!isPlainObject(parsed.engines) || typeof parsed.engines.molibot !== "string") {
    return fail("engines.molibot is required.");
  }
  const range = parsed.engines.molibot;
  if (!semver.validRange(range)) return fail(`engines.molibot is not a valid SemVer range: ${range}`);
  const hostVersion = getMolibotVersion();
  if (hostVersion && !semver.satisfies(hostVersion, range, { includePrerelease: true })) {
    return fail(`Requires Molibot ${range}, but this host is ${hostVersion}.`);
  }

  if (!isPlainObject(parsed.runtime) || typeof parsed.runtime.entry !== "string") {
    return fail("runtime.entry is required.");
  }
  const runtimeEntry = parsed.runtime.entry;
  if (!runtimeEntry.endsWith(".mjs")) {
    return fail("runtime.entry must be a .mjs ES module inside the app directory.");
  }
  const entryPath = resolveContainedPath(appDir, runtimeEntry, { requireFile: true });
  if (!entryPath) return fail(`runtime.entry "${runtimeEntry}" is missing or escapes the app directory.`);

  if (!isPlainObject(parsed.ui) || typeof parsed.ui.entry !== "string") {
    return fail("ui.entry is required.");
  }
  const uiEntry = parsed.ui.entry;
  if (!uiEntry.startsWith("ui/")) {
    return fail("ui.entry must live inside the app's ui/ directory.");
  }
  const uiEntryPath = resolveContainedPath(appDir, uiEntry, { requireFile: true });
  if (!uiEntryPath) return fail(`ui.entry "${uiEntry}" is missing or escapes the app directory.`);
  const uiRootPath = resolveContainedPath(appDir, "ui");
  if (!uiRootPath) return fail("ui/ directory is missing or escapes the app directory.");

  // The icon is optional, but a *declared* icon that cannot be loaded is an
  // error rather than a silent fallback — otherwise a typo just shows the
  // default glyph forever with nothing to explain why.
  let iconPath: string | null = null;
  const iconEntry = parsed.ui.icon;
  if (iconEntry !== undefined) {
    if (typeof iconEntry !== "string") return fail("ui.icon must be a string.");
    if (!iconEntry.startsWith("ui/")) return fail("ui.icon must live inside the app's ui/ directory.");
    if (!ICON_EXTENSIONS.some((extension) => iconEntry.toLowerCase().endsWith(extension))) {
      return fail(`ui.icon must be one of: ${ICON_EXTENSIONS.join(", ")}.`);
    }
    iconPath = resolveContainedPath(appDir, iconEntry, { requireFile: true });
    if (!iconPath) return fail(`ui.icon "${iconEntry}" is missing or escapes the app directory.`);
    let iconSize = 0;
    try {
      iconSize = fs.statSync(iconPath).size;
    } catch {
      return fail(`ui.icon "${iconEntry}" could not be read.`);
    }
    // The icon is inlined into every catalog response, so an oversized one
    // would bloat a payload the desktop fetches routinely.
    if (iconSize > MAX_ICON_BYTES) {
      return fail(`ui.icon must be at most ${Math.floor(MAX_ICON_BYTES / 1024)} KB.`);
    }
  }

  if (!isPlainObject(parsed.data) || !Number.isInteger(parsed.data.schemaVersion)) {
    return fail("data.schemaVersion must be an integer.");
  }
  const schemaVersion = parsed.data.schemaVersion as number;
  if (schemaVersion < 1) return fail("data.schemaVersion must be >= 1.");

  if (!Array.isArray(parsed.tools) || parsed.tools.length === 0) {
    return fail("tools must be a non-empty array.");
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = new Map<string, ValidateFunction>();
  const seen = new Set<string>();
  const tools: MiniAppToolManifest[] = [];
  for (const [index, rawTool] of (parsed.tools as unknown[]).entries()) {
    const result = validateToolEntry(rawTool, index, seen, ajv, validators);
    if (!result.ok) return fail(result.error);
    tools.push(result.value);
  }

  const contributions = parsed.contributions === undefined
    ? undefined
    : validateMessageActions(parsed.contributions, tools);
  if (contributions && !contributions.ok) return fail(contributions.error);
  const ai = parsed.ai === undefined ? undefined : validateAiManifest(parsed.ai);
  if (ai && !ai.ok) return fail(ai.error);

  return {
    ok: true,
    value: {
      manifest: {
        manifestVersion: 1,
        id: parsed.id,
        name,
        version,
        description: typeof parsed.description === "string" ? parsed.description : undefined,
        engines: { molibot: range },
        runtime: { entry: runtimeEntry },
        ui: { entry: uiEntry, ...(iconEntry !== undefined ? { icon: iconEntry as string } : {}) },
        data: { schemaVersion },
        tools,
        ...(contributions?.ok ? { contributions: { messageActions: contributions.value } } : {}),
        ...(ai?.ok ? { ai: ai.value } : {})
      },
      entryPath,
      uiEntryPath,
      uiRootPath,
      iconPath,
      validators
    }
  };
}
