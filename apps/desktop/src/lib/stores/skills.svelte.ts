// Skills settings — state + orchestration.
import { loadDesktopSkills, updateDesktopSkills } from "../api";
import type { DesktopSkillsSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const skillsStore = $state({
  skills: null as DesktopSkillsSummary | null,
  loading: false,
  endpoint: "",
  searchDraft: null as DesktopSkillsSummary["search"] | null,
  saving: false,
  savingId: "",
  // Pristine snapshot so the sticky save bar only appears on real changes.
  searchPristine: "",
  actionMessage: ""
});

export async function loadSkills(endpoint: string): Promise<void> {
  skillsStore.endpoint = endpoint;
  skillsStore.loading = true;
  session.error = "";
  try {
    skillsStore.skills = await loadDesktopSkills(endpoint);
    skillsStore.searchDraft = { ...skillsStore.skills.search, providers: skillsStore.skills.search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
    skillsStore.searchPristine = JSON.stringify(skillsStore.searchDraft);
  } catch (cause) {
    skillsStore.endpoint = "";
    setError(cause);
  } finally {
    skillsStore.loading = false;
  }
}

export async function toggleSkill(id: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || skillsStore.savingId) return;
  skillsStore.savingId = id;
  session.error = "";
  try {
    skillsStore.skills = await updateDesktopSkills(endpoint, { kind: "skill", id, enabled });
    skillsStore.actionMessage = session.text.skillsStatusSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    skillsStore.savingId = "";
  }
}

export async function saveSkillsSearch(): Promise<void> {
  const endpoint = session.endpoint;
  const draft = skillsStore.searchDraft;
  if (!endpoint || !draft || skillsStore.saving) return;
  skillsStore.saving = true;
  session.error = "";
  try {
    skillsStore.skills = await updateDesktopSkills(endpoint, { kind: "search", localEnabled: draft.localEnabled, apiEnabled: draft.apiEnabled, apiProvider: draft.apiProvider, apiModel: draft.apiModel, maxTokens: draft.maxTokens, temperature: draft.temperature, timeoutMs: draft.timeoutMs, minConfidence: draft.minConfidence });
    skillsStore.searchDraft = { ...skillsStore.skills.search, providers: skillsStore.skills.search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
    skillsStore.searchPristine = JSON.stringify(skillsStore.searchDraft);
    skillsStore.actionMessage = session.text.skillsSearchSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    skillsStore.saving = false;
  }
}

export function discardSkillsSearch(): void {
  if (skillsStore.searchPristine) skillsStore.searchDraft = JSON.parse(skillsStore.searchPristine);
  skillsStore.actionMessage = "";
}
