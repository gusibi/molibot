// Custom / built-in provider settings — state + orchestration.
import {
  createDesktopProvider,
  deleteDesktopProvider,
  discoverDesktopProviderModels,
  loadDesktopProviders,
  providerItemToUpdateRequest,
  testDesktopProvider,
  updateDesktopProvider,
  updateDesktopProviderGlobals
} from "../api";
import type {
  DesktopProviderCreateRequest,
  DesktopProviderGlobalsRequest,
  DesktopProviderModel,
  DesktopProviderModelRole,
  DesktopProviderModelTag,
  DesktopProvidersSummary,
  DesktopProviderUpdateRequest
} from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const PROVIDER_MODEL_TAGS: DesktopProviderModelTag[] = ["text", "vision", "audio_input", "stt", "tts", "tool"];
export const PROVIDER_MODEL_ROLES: DesktopProviderModelRole[] = ["system", "user", "assistant", "tool", "developer"];
export const PROVIDER_THINKING_FORMATS = ["openai", "openrouter", "anthropic", "deepseek", "zai", "qwen", "qwen-chat-template"] as const;

export type ProviderEditor = DesktopProviderUpdateRequest & { isNew: boolean };

export const providersStore = $state({
  providers: null as DesktopProvidersSummary | null,
  loading: false,
  endpoint: "",
  saving: false,
  testingId: null as string | null,
  actionMessage: "",
  actionFailed: false,
  providerEdit: null as ProviderEditor | null,
  editApiKey: "",
  editClearApiKey: false,
  discoveredModels: [] as string[],
  discovering: false,
  globals: { providerMode: "pi", piProvider: "", piModel: "", defaultCustomProviderId: "" } as DesktopProviderGlobalsRequest,
  globalsDirty: false
});

export function defaultProviderPath(protocol: "openai-compatible" | "anthropic"): string {
  return protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
}

function createProviderId(): string {
  return `custom-${Date.now().toString(36)}`;
}

export async function loadProviders(endpoint: string): Promise<void> {
  providersStore.endpoint = endpoint;
  providersStore.loading = true;
  session.error = "";
  try {
    providersStore.providers = await loadDesktopProviders(endpoint);
    if (!providersStore.providerEdit && !providersStore.globalsDirty) {
      providersStore.globals = {
        providerMode: providersStore.providers.providerMode,
        piProvider: providersStore.providers.piProvider,
        piModel: providersStore.providers.piModel,
        defaultCustomProviderId: providersStore.providers.defaultCustomProviderId
      };
    }
  } catch (cause) {
    providersStore.endpoint = "";
    setError(cause);
  } finally {
    providersStore.loading = false;
  }
}

export function beginNewProvider(): void {
  providersStore.providerEdit = {
    isNew: true,
    id: createProviderId(),
    name: "",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "",
    models: [],
    defaultModel: "",
    path: "/v1/chat/completions",
    supportsThinking: null,
    thinkingFormat: null,
    reasoningEffortMap: {}
  };
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
  providersStore.actionMessage = "";
}

export async function verifyProvider(providerId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || providersStore.testingId) return;
  providersStore.testingId = providerId;
  providersStore.actionMessage = "";
  providersStore.actionFailed = false;
  try {
    const result = await testDesktopProvider(endpoint, providerId);
    providersStore.actionFailed = !result.ok;
    providersStore.actionMessage = result.ok
      ? session.text.onboardingProviderTestOk
      : `${session.text.onboardingProviderTestFail}: ${result.error || result.message || session.text.unknownValue}`;
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.testingId = null;
  }
}

export function beginProviderEdit(providerId: string): void {
  const provider = providersStore.providers?.customProviders.find((item) => item.id === providerId);
  if (!provider) return;
  providersStore.providerEdit = { ...providerItemToUpdateRequest(provider), isNew: false };
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
  providersStore.actionMessage = "";
}

export function closeProviderEdit(): void {
  providersStore.providerEdit = null;
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
}

export function onProviderOverlayKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !providersStore.saving) closeProviderEdit();
}

export function updateProviderEdit(updater: (draft: ProviderEditor) => ProviderEditor): void {
  if (!providersStore.providerEdit) return;
  providersStore.providerEdit = updater(providersStore.providerEdit);
}

export function addProviderModel(modelId = ""): void {
  if (!providersStore.providerEdit) return;
  const id = modelId.trim();
  if (id && providersStore.providerEdit.models.some((model) => model.id === id)) return;
  const model: DesktopProviderModel = {
    id,
    tags: ["text"],
    supportedRoles: ["system", "user", "assistant", "tool"],
    enabled: true,
    verification: {}
  };
  updateProviderEdit((draft) => ({ ...draft, models: [...draft.models, model] }));
}

export function removeProviderModel(index: number): void {
  updateProviderEdit((draft) => {
    const models = draft.models.filter((_, modelIndex) => modelIndex !== index);
    return { ...draft, models, defaultModel: draft.defaultModel === draft.models[index]?.id ? models[0]?.id ?? "" : draft.defaultModel };
  });
}

export function updateProviderModel(index: number, patch: Partial<DesktopProviderModel>): void {
  updateProviderEdit((draft) => ({
    ...draft,
    models: draft.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model)
  }));
}

export function toggleProviderModelTag(index: number, tag: DesktopProviderModelTag): void {
  if (!providersStore.providerEdit) return;
  const model = providersStore.providerEdit.models[index];
  if (!model) return;
  const tags = model.tags.includes(tag) ? model.tags.filter((item) => item !== tag) : [...model.tags, tag];
  updateProviderModel(index, { tags: tags.length > 0 ? tags : ["text"] });
}

export function toggleProviderModelRole(index: number, role: DesktopProviderModelRole): void {
  if (!providersStore.providerEdit) return;
  const model = providersStore.providerEdit.models[index];
  if (!model) return;
  const roles = model.supportedRoles ?? [];
  const next = roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role];
  updateProviderModel(index, { supportedRoles: next });
}

export async function saveProviderEdit(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !providersStore.providerEdit || providersStore.saving) return;
  providersStore.saving = true;
  providersStore.actionMessage = "";
  providersStore.actionFailed = false;
  try {
    const { isNew, ...draft } = providersStore.providerEdit;
    if (isNew) {
      const request: DesktopProviderCreateRequest = {
        ...draft,
        apiKey: providersStore.editApiKey.trim()
      };
      const result = await createDesktopProvider(endpoint, request);
      if (!result.ok) throw new Error(result.error || "Provider save failed");
      closeProviderEdit();
      providersStore.endpoint = "";
      await loadProviders(endpoint);
    } else {
      providersStore.providers = await updateDesktopProvider(endpoint, {
        ...draft,
        apiKey: providersStore.editApiKey.trim() || undefined,
        clearApiKey: providersStore.editClearApiKey
      });
      providersStore.globals = { ...providersStore.globals, defaultCustomProviderId: providersStore.providers.defaultCustomProviderId };
      closeProviderEdit();
    }
    providersStore.actionMessage = session.text.providerSaved;
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.saving = false;
  }
}

export async function removeProvider(providerId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || providersStore.saving || !window.confirm(session.text.providerDeleteConfirm)) return;
  providersStore.saving = true;
  try {
    providersStore.providers = await deleteDesktopProvider(endpoint, providerId);
    providersStore.globals = { ...providersStore.globals, defaultCustomProviderId: providersStore.providers.defaultCustomProviderId };
    if (providersStore.providerEdit?.id === providerId) closeProviderEdit();
    providersStore.actionFailed = false;
    providersStore.actionMessage = session.text.providerDeleted;
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.saving = false;
  }
}

export async function saveProviderGlobals(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || providersStore.saving) return;
  providersStore.saving = true;
  try {
    providersStore.providers = await updateDesktopProviderGlobals(endpoint, providersStore.globals);
    providersStore.globals = {
      providerMode: providersStore.providers.providerMode,
      piProvider: providersStore.providers.piProvider,
      piModel: providersStore.providers.piModel,
      defaultCustomProviderId: providersStore.providers.defaultCustomProviderId
    };
    providersStore.globalsDirty = false;
    providersStore.actionFailed = false;
    providersStore.actionMessage = session.text.providerGlobalsSaved;
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.saving = false;
  }
}

export async function setProviderAsDefault(providerId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || providersStore.saving) return;
  providersStore.globals = { ...providersStore.globals, defaultCustomProviderId: providerId };
  await saveProviderGlobals();
}

export async function discoverProviderModels(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !providersStore.providerEdit || providersStore.providerEdit.isNew || providersStore.discovering) return;
  providersStore.discovering = true;
  try {
    providersStore.discoveredModels = await discoverDesktopProviderModels(endpoint, providersStore.providerEdit.id);
    providersStore.actionFailed = false;
    providersStore.actionMessage = session.text.providerModelsDiscovered.replace("{count}", String(providersStore.discoveredModels.length));
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.discovering = false;
  }
}

export async function verifyProviderModel(index: number): Promise<void> {
  const endpoint = session.endpoint;
  const model = providersStore.providerEdit?.models[index];
  if (!endpoint || !providersStore.providerEdit || providersStore.providerEdit.isNew || !model?.id.trim() || providersStore.testingId) return;
  providersStore.testingId = `${providersStore.providerEdit.id}:${model.id}`;
  try {
    const result = await testDesktopProvider(endpoint, providersStore.providerEdit.id, model.id);
    if (result.supportedRoles || result.verification) {
      updateProviderModel(index, {
        supportedRoles: result.supportedRoles ?? model.supportedRoles,
        verification: { ...model.verification, ...(result.verification ?? {}) }
      });
    }
    providersStore.actionFailed = !result.ok;
    providersStore.actionMessage = result.ok ? session.text.onboardingProviderTestOk : `${session.text.onboardingProviderTestFail}: ${result.error || result.message || session.text.unknownValue}`;
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.testingId = null;
  }
}
