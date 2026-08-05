// Agent definitions settings — state + orchestration.
import { deleteDesktopAgent, installDesktopAgentTemplate, loadDesktopAgentFiles, loadDesktopAgents, loadDesktopAgentTemplates, saveDesktopAgent, saveDesktopAgentFiles, updateDesktopAgentTemplate } from "../api";
import type { DesktopAgentTemplateSummary } from "../api";
import type { DesktopAgentSaveRequest, DesktopAgentsSummary } from "@molibot/desktop-contract";
import { session, setError, notifySettingsChanged } from "./session.svelte";

export const AGENT_FILE_NAMES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;

export type AgentEditor = DesktopAgentSaveRequest & { isNew: boolean; files: Record<string, string> };

export const agentsStore = $state({
  agents: null as DesktopAgentsSummary | null,
  templates: [] as DesktopAgentTemplateSummary[],
  loading: false,
  endpoint: "",
  agentEdit: null as AgentEditor | null,
  saving: false,
  installingTemplateId: "",
  updatingTemplateId: "",
  editorLoading: false,
  actionMessage: ""
});

function emptyAgentFiles(): Record<string, string> {
  return Object.fromEntries(AGENT_FILE_NAMES.map((name) => [name, ""]));
}

export async function loadAgents(endpoint: string): Promise<void> {
  agentsStore.endpoint = endpoint;
  agentsStore.loading = true;
  session.error = "";
  try {
    const [agents, templates] = await Promise.all([
      loadDesktopAgents(endpoint),
      loadDesktopAgentTemplates(endpoint)
    ]);
    agentsStore.agents = agents;
    agentsStore.templates = templates;
  } catch (cause) {
    agentsStore.endpoint = "";
    setError(cause);
  } finally {
    agentsStore.loading = false;
  }
}

export async function installAgentFromTemplate(templateId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || agentsStore.installingTemplateId) return;
  agentsStore.installingTemplateId = templateId;
  session.error = "";
  try {
    const result = await installDesktopAgentTemplate(endpoint, templateId);
    const [agents, templates] = await Promise.all([
      loadDesktopAgents(endpoint),
      loadDesktopAgentTemplates(endpoint)
    ]);
    agentsStore.agents = agents;
    agentsStore.templates = templates;
    agentsStore.actionMessage = `${session.text.agentTemplateInstalled}: ${result.agentId}`;
    notifySettingsChanged();
  } catch (cause) {
    setError(cause);
  } finally {
    agentsStore.installingTemplateId = "";
  }
}

/**
 * Re-apply a built-in Agent's shipped files over the installed copy.
 *
 * The reload afterwards is not cosmetic: the update writes new prompt files and
 * a new recorded version, so both the template list (which drives the "update
 * available" state) and the Agent list (whose name/description follow the
 * template) are stale the moment it returns.
 */
export async function updateAgentFromTemplate(templateId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || agentsStore.updatingTemplateId || agentsStore.installingTemplateId) return;
  agentsStore.updatingTemplateId = templateId;
  session.error = "";
  try {
    const result = await updateDesktopAgentTemplate(endpoint, templateId);
    const [agents, templates] = await Promise.all([
      loadDesktopAgents(endpoint),
      loadDesktopAgentTemplates(endpoint)
    ]);
    agentsStore.agents = agents;
    agentsStore.templates = templates;
    // A backup only exists when the owner's copy had diverged. Saying so is the
    // difference between "my edits are gone" and "my edits are over there".
    agentsStore.actionMessage = result.backupDir
      ? `${session.text.agentTemplateUpdated}: ${result.agentId} · ${result.to} · ${session.text.agentTemplateBackedUp}: ${result.backupDir}`
      : `${session.text.agentTemplateUpdated}: ${result.agentId} · ${result.to}`;
    notifySettingsChanged();
  } catch (cause) {
    setError(cause);
  } finally {
    agentsStore.updatingTemplateId = "";
  }
}

export function beginNewAgent(): void {
  agentsStore.agentEdit = {
    isNew: true,
    id: `agent-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`,
    name: "",
    description: "",
    enabled: true,
    sandboxEnabled: null,
    modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" },
    files: emptyAgentFiles()
  };
  agentsStore.actionMessage = "";
}

export async function beginAgentEdit(agentId: string): Promise<void> {
  const endpoint = session.endpoint;
  const agent = agentsStore.agents?.items.find((item) => item.id === agentId);
  if (!endpoint || !agent || agentsStore.editorLoading) return;
  agentsStore.editorLoading = true;
  try {
    agentsStore.agentEdit = {
      isNew: false,
      previousId: agent.id,
      id: agent.id,
      name: agent.name,
      description: agent.description,
      enabled: agent.enabled,
      sandboxEnabled: agent.sandboxEnabled,
      modelRouting: { ...agent.modelRouting },
      files: { ...emptyAgentFiles(), ...(await loadDesktopAgentFiles(endpoint, agent.id)) }
    };
    agentsStore.actionMessage = "";
  } catch (cause) {
    setError(cause);
  } finally {
    agentsStore.editorLoading = false;
  }
}

export function updateAgentEdit(updater: (draft: AgentEditor) => AgentEditor): void {
  if (agentsStore.agentEdit) agentsStore.agentEdit = updater(agentsStore.agentEdit);
}

export async function saveAgentEditor(): Promise<void> {
  const endpoint = session.endpoint;
  const agentEdit = agentsStore.agentEdit;
  if (!endpoint || !agentEdit || agentsStore.saving || !agentEdit.id.trim()) return;
  agentsStore.saving = true;
  session.error = "";
  try {
    agentsStore.agents = await saveDesktopAgent(endpoint, {
      previousId: agentEdit.isNew ? undefined : agentEdit.previousId,
      id: agentEdit.id.trim(),
      name: agentEdit.name,
      description: agentEdit.description,
      enabled: agentEdit.enabled,
      sandboxEnabled: agentEdit.sandboxEnabled,
      modelRouting: agentEdit.modelRouting
    });
    await saveDesktopAgentFiles(endpoint, agentEdit.id.trim(), agentEdit.files);
    agentsStore.agentEdit = null;
    agentsStore.actionMessage = session.text.agentSaved;
    notifySettingsChanged();
  } catch (cause) {
    setError(cause);
  } finally {
    agentsStore.saving = false;
  }
}

export async function removeAgent(agentId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || agentsStore.saving || !window.confirm(session.text.agentDeleteConfirm)) return;
  agentsStore.saving = true;
  session.error = "";
  try {
    agentsStore.agents = await deleteDesktopAgent(endpoint, agentId);
    if (agentsStore.agentEdit?.previousId === agentId) agentsStore.agentEdit = null;
    agentsStore.actionMessage = session.text.agentDeleted;
    notifySettingsChanged();
  } catch (cause) {
    setError(cause);
  } finally {
    agentsStore.saving = false;
  }
}
