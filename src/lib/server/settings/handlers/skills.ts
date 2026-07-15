import { sanitizeSkillSearchSettings } from "../sanitize.js";
import type { RuntimeSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export function readSkillsConfig(runtime: SettingsAccessor): {
  disabledSkillPaths: RuntimeSettings["disabledSkillPaths"];
  skillSearch: RuntimeSettings["skillSearch"];
} {
  const s = runtime.getSettings();
  return {
    disabledSkillPaths: s.disabledSkillPaths ?? [],
    skillSearch: s.skillSearch
  };
}

export interface SkillsPatch {
  disabledSkillPaths?: unknown;
  skillSearch?: unknown;
}

export function updateSkillsConfig(runtime: SettingsAccessor, patch: SkillsPatch): {
  disabledSkillPaths: RuntimeSettings["disabledSkillPaths"];
  skillSearch: RuntimeSettings["skillSearch"];
} {
  const current = runtime.getSettings();
  const settingsPatch: Partial<RuntimeSettings> = {};
  if ("disabledSkillPaths" in patch) {
    const paths = patch.disabledSkillPaths;
    settingsPatch.disabledSkillPaths = Array.isArray(paths)
      ? paths.map((v) => String(v).trim()).filter(Boolean)
      : current.disabledSkillPaths;
  }
  if ("skillSearch" in patch && patch.skillSearch !== undefined) {
    settingsPatch.skillSearch = sanitizeSkillSearchSettings(patch.skillSearch, current.skillSearch);
  }
  const updated = runtime.updateSettings(settingsPatch);
  return {
    disabledSkillPaths: updated.disabledSkillPaths,
    skillSearch: updated.skillSearch
  };
}
