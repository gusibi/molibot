import { sanitizeSkillDraftSettings } from "../sanitize.js";
import type { RuntimeSettings } from "../schema.js";
import { validateSkillDraftSettings } from "../validators.js";
import type { SettingsAccessor } from "./locale.js";

export function readSkillDraftConfig(runtime: SettingsAccessor): RuntimeSettings["skillDrafts"] {
  return runtime.getSettings().skillDrafts;
}

export function updateSkillDraftConfig(runtime: SettingsAccessor, raw: unknown): RuntimeSettings["skillDrafts"] {
  const current = runtime.getSettings();
  const skillDrafts = sanitizeSkillDraftSettings(raw, current.skillDrafts);
  const validationError = validateSkillDraftSettings(current, { skillDrafts });
  if (validationError) throw new Error(validationError);
  return runtime.updateSettings({ skillDrafts }).skillDrafts;
}
