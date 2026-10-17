// Shared skill management and search settings state.
import { loadDesktopSkills, updateDesktopSkills } from "../api";
import type { DesktopSkillsSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const skillsStore = $state({
  skills: null as DesktopSkillsSummary | null,
  loading: false,
  error: "",
  endpoint: "",
  searchDraft: null as DesktopSkillsSummary["search"] | null,
  saving: false,
  savingId: "",
  updatingBuiltinId: "",
  // Pristine snapshot so the sticky save bar only appears on real changes.
  searchPristine: "",
  actionResult: null as { kind: "skill" | "builtin"; id: string } | null,
  searchSaved: false
});

export async function loadSkills(endpoint: string): Promise<void> {
  skillsStore.endpoint = endpoint;
  skillsStore.loading = true;
  skillsStore.searchSaved = false;
  skillsStore.actionResult = null;
  skillsStore.error = "";
  session.error = "";
  try {
    skillsStore.skills = await loadDesktopSkills(endpoint);
    skillsStore.searchDraft = { ...skillsStore.skills.search, providers: skillsStore.skills.search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
    skillsStore.searchPristine = JSON.stringify(skillsStore.searchDraft);
  } catch (cause) {
    skillsStore.endpoint = "";
    setError(cause);
    skillsStore.error = session.error;
  } finally {
    skillsStore.loading = false;
  }
}

export async function toggleSkill(id: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || skillsStore.savingId) return;
  skillsStore.savingId = id;
  skillsStore.error = "";
  skillsStore.actionResult = null;
  session.error = "";
  try {
    skillsStore.skills = await updateDesktopSkills(endpoint, { kind: "skill", id, enabled });
    skillsStore.actionResult = { kind: "skill", id };
  } catch (cause) {
    setError(cause);
    skillsStore.error = session.error;
  } finally {
    skillsStore.savingId = "";
  }
}

/**
 * Write the shipped copy of a built-in Skill over the installed one.
 *
 * The response is the refreshed summary, so the version state and the skill
 * list both come back from the same request that performed the update — there
 * is no window where the row still advertises the old version.
 */
export async function updateBuiltinSkill(id: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || skillsStore.updatingBuiltinId) return;
  skillsStore.updatingBuiltinId = id;
  skillsStore.error = "";
  skillsStore.actionResult = null;
  session.error = "";
  try {
    skillsStore.skills = await updateDesktopSkills(endpoint, { kind: "builtin", id });
    skillsStore.actionResult = { kind: "builtin", id };
  } catch (cause) {
    setError(cause);
    skillsStore.error = session.error;
  } finally {
    skillsStore.updatingBuiltinId = "";
  }
}

export async function saveSkillsSearch(): Promise<void> {
  const endpoint = session.endpoint;
  const draft = skillsStore.searchDraft;
  if (!endpoint || !draft || skillsStore.saving) return;
  skillsStore.saving = true;
  skillsStore.searchSaved = false;
  session.error = "";
  try {
    skillsStore.skills = await updateDesktopSkills(endpoint, { kind: "search", localEnabled: draft.localEnabled, apiEnabled: draft.apiEnabled, apiProvider: draft.apiProvider, apiModel: draft.apiModel, maxTokens: draft.maxTokens, temperature: draft.temperature, timeoutMs: draft.timeoutMs, minConfidence: draft.minConfidence });
    skillsStore.searchDraft = { ...skillsStore.skills.search, providers: skillsStore.skills.search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
    skillsStore.searchPristine = JSON.stringify(skillsStore.searchDraft);
    skillsStore.searchSaved = true;
  } catch (cause) {
    setError(cause);
    skillsStore.error = session.error;
  } finally {
    skillsStore.saving = false;
  }
}

export function discardSkillsSearch(): void {
  if (skillsStore.searchPristine) skillsStore.searchDraft = JSON.parse(skillsStore.searchPristine);
  skillsStore.searchSaved = false;
}
