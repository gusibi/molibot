import {
  sanitizeBudgetSettings,
  sanitizeEventExecutionSettings
} from "../sanitize.js";
import { sanitizeToolSandboxSettings } from "../toolSandbox.js";
import { defaultRuntimeSettings } from "../defaults.js";
import type { RuntimeSettings } from "../schema.js";
import { sanitizeLocale } from "./locale.js";
import { validateTimezonePatch } from "../validators.js";
import type { SettingsAccessor } from "./locale.js";

export interface SystemConfig {
  locale: RuntimeSettings["locale"];
  timezone: RuntimeSettings["timezone"];
  budget: RuntimeSettings["budget"];
  browserAutomation: RuntimeSettings["browserAutomation"];
  display: RuntimeSettings["display"];
  toolSandbox: RuntimeSettings["toolSandbox"];
  events: RuntimeSettings["events"];
}

export function readSystemConfig(runtime: SettingsAccessor): SystemConfig {
  const s = runtime.getSettings();
  return {
    locale: s.locale,
    timezone: s.timezone,
    budget: s.budget,
    browserAutomation: s.browserAutomation,
    display: s.display,
    toolSandbox: s.toolSandbox,
    events: s.events
  };
}

type SystemPatch = {
  locale?: unknown;
  timezone?: unknown;
  budget?: unknown;
  browserAutomation?: unknown;
  display?: unknown;
  toolSandbox?: unknown;
  events?: unknown;
};

function sanitizeDisplay(input: unknown, fallback: RuntimeSettings["display"]): RuntimeSettings["display"] {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const toolProgress = String(source.toolProgress ?? fallback.toolProgress);
  const showReasoning = String(source.showReasoning ?? fallback.showReasoning);
  const gatewayRaw = Number(source.gatewayNotifyInterval);
  const runLogNoticeRaw = source.runLogNotice;
  return {
    toolProgress: ["off", "new", "all", "verbose"].includes(toolProgress)
      ? toolProgress as RuntimeSettings["display"]["toolProgress"]
      : fallback.toolProgress,
    showReasoning: ["off", "on", "stream", "new"].includes(showReasoning)
      ? showReasoning as RuntimeSettings["display"]["showReasoning"]
      : fallback.showReasoning,
    gatewayNotifyInterval: Number.isFinite(gatewayRaw)
      ? Math.max(0, Math.round(gatewayRaw))
      : fallback.gatewayNotifyInterval,
    runLogNotice: runLogNoticeRaw === undefined ? fallback.runLogNotice : Boolean(runLogNoticeRaw)
  };
}

function sanitizeBrowserAutomation(input: unknown, fallback: RuntimeSettings["browserAutomation"]): RuntimeSettings["browserAutomation"] {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const raw = Number(source.defaultTimeoutMs);
  return {
    defaultTimeoutMs: Number.isFinite(raw)
      ? Math.max(5000, Math.min(300000, Math.round(raw)))
      : fallback.defaultTimeoutMs
  };
}

export function updateSystemConfig(runtime: SettingsAccessor, patch: SystemPatch): SystemConfig {
  const current = runtime.getSettings();
  const settingsPatch: Partial<RuntimeSettings> = {};

  if (patch.locale !== undefined) settingsPatch.locale = sanitizeLocale(patch.locale);
  if (patch.timezone !== undefined) settingsPatch.timezone = String(patch.timezone ?? "").trim();
  if (patch.budget !== undefined) settingsPatch.budget = sanitizeBudgetSettings(patch.budget, current.budget);
  if (patch.browserAutomation !== undefined) settingsPatch.browserAutomation = sanitizeBrowserAutomation(patch.browserAutomation, current.browserAutomation);
  if (patch.display !== undefined) settingsPatch.display = sanitizeDisplay(patch.display, current.display ?? defaultRuntimeSettings.display);
  if (patch.toolSandbox !== undefined) settingsPatch.toolSandbox = sanitizeToolSandboxSettings(patch.toolSandbox, current.toolSandbox);
  if (patch.events !== undefined) settingsPatch.events = sanitizeEventExecutionSettings(patch.events, current.events);

  const tzError = validateTimezonePatch(current, settingsPatch);
  if (tzError) throw new Error(tzError);

  const updated = runtime.updateSettings(settingsPatch);
  return {
    locale: updated.locale,
    timezone: updated.timezone,
    budget: updated.budget,
    browserAutomation: updated.browserAutomation,
    display: updated.display,
    toolSandbox: updated.toolSandbox,
    events: updated.events
  };
}
