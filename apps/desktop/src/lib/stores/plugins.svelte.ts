// Plugin settings — state + orchestration.
import { loadDesktopPlugins, saveDesktopPlugins } from "../api";
import type { DesktopPluginsSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export type PluginsEditor = { memoryEnabled: boolean; memoryBackend: string; memoryEmbeddingProviderId: string; memoryEmbeddingModel: string; memoryReflectionTime: string; memoryReflectionNotifications: boolean; memoryDailyMaterials: { enabled: boolean; time: string; projectId: string; dir: string; promptPath: string; notifications: boolean; scanTokenBudget: number; scanModelKey: string }; values: Record<string, Record<string, string | boolean>>; secretValues: Record<string, Record<string, string>>; clearSecrets: Record<string, string[]> };

export const pluginsStore = $state({
  plugins: null as DesktopPluginsSummary | null,
  loading: false,
  endpoint: "",
  pluginsEdit: null as PluginsEditor | null,
  saving: false,
  // Pristine snapshot so the sticky save bar only appears on real changes.
  pristine: "",
  actionMessage: ""
});

function editorFromSummary(plugins: DesktopPluginsSummary): PluginsEditor {
  return {
    memoryEnabled: plugins.memory.enabled,
    memoryBackend: plugins.memory.backend,
    memoryEmbeddingProviderId: plugins.memory.embeddingProviderId,
    memoryEmbeddingModel: plugins.memory.embeddingModel,
    memoryReflectionTime: plugins.memory.reflectionTime,
    memoryReflectionNotifications: plugins.memory.reflectionNotifications,
    memoryDailyMaterials: { ...plugins.memory.dailyMaterials },
    values: Object.fromEntries(plugins.featureSettings.map((plugin) => [plugin.pluginKey, Object.fromEntries(plugin.fields.filter((field) => field.type !== "password").map((field) => [field.key, field.value]))])),
    secretValues: {},
    clearSecrets: {}
  };
}

export async function loadPlugins(endpoint: string): Promise<void> {
  pluginsStore.endpoint = endpoint;
  pluginsStore.loading = true;
  session.error = "";
  try {
    pluginsStore.plugins = await loadDesktopPlugins(endpoint);
    pluginsStore.pluginsEdit = editorFromSummary(pluginsStore.plugins);
    pluginsStore.pristine = JSON.stringify(pluginsStore.pluginsEdit);
  } catch (cause) {
    pluginsStore.endpoint = "";
    setError(cause);
  } finally {
    pluginsStore.loading = false;
  }
}

export function updatePluginValue(pluginKey: string, key: string, value: string | boolean): void {
  const edit = pluginsStore.pluginsEdit;
  if (!edit) return;
  pluginsStore.pluginsEdit = { ...edit, values: { ...edit.values, [pluginKey]: { ...(edit.values[pluginKey] ?? {}), [key]: value } } };
}

export function updatePluginSecret(pluginKey: string, key: string, value: string): void {
  const edit = pluginsStore.pluginsEdit;
  if (!edit) return;
  pluginsStore.pluginsEdit = { ...edit, secretValues: { ...edit.secretValues, [pluginKey]: { ...(edit.secretValues[pluginKey] ?? {}), [key]: value } } };
}

export function togglePluginSecretClear(pluginKey: string, key: string): void {
  const edit = pluginsStore.pluginsEdit;
  if (!edit) return;
  const current = edit.clearSecrets[pluginKey] ?? [];
  pluginsStore.pluginsEdit = { ...edit, clearSecrets: { ...edit.clearSecrets, [pluginKey]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key] } };
}

export async function savePluginsEditor(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !pluginsStore.pluginsEdit || pluginsStore.saving) return;
  pluginsStore.saving = true;
  session.error = "";
  try {
    pluginsStore.plugins = await saveDesktopPlugins(endpoint, pluginsStore.pluginsEdit);
    pluginsStore.pluginsEdit = editorFromSummary(pluginsStore.plugins);
    pluginsStore.pristine = JSON.stringify(pluginsStore.pluginsEdit);
    pluginsStore.actionMessage = session.text.pluginsSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    pluginsStore.saving = false;
  }
}

export function discardPlugins(): void {
  if (pluginsStore.pristine) pluginsStore.pluginsEdit = JSON.parse(pluginsStore.pristine);
  pluginsStore.actionMessage = "";
}
