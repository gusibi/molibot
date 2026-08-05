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
import { session, setError, notifySettingsChanged } from "./session.svelte";

export const PROVIDER_MODEL_TAGS: DesktopProviderModelTag[] = ["text", "vision", "audio_input", "stt", "tts", "tool"];
export const PROVIDER_MODEL_ROLES: DesktopProviderModelRole[] = ["system", "user", "assistant", "tool", "developer"];
export const PROVIDER_THINKING_FORMATS = ["openai", "openrouter", "anthropic", "deepseek", "zai", "qwen", "qwen-chat-template"] as const;
export const PROVIDERS_CHANGED_EVENT = "molibot:providers-changed";

export type ProviderEditor = DesktopProviderUpdateRequest & { isNew: boolean; isBuiltin: boolean };

export const providersStore = $state({
  providers: null as DesktopProvidersSummary | null,
  loading: false,
  endpoint: "",
  /**
   * Last load failure. The section shows it with a retry button instead of
   * reloading on its own — a failed load must never re-arm the section's
   * `$effect` guard, or a service that is briefly down (which is exactly what
   * a provider write causes) turns into an endless reload loop.
   */
  loadError: "",
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
  globalsDirty: false,
  /**
   * Serialized draft as it was last loaded or saved. The provider editor is
   * inline (not a modal), so switching rows must be able to tell an untouched
   * draft from one with pending edits without a per-field dirty flag.
   */
  editSnapshot: ""
});

function serializeProviderEdit(): string {
  return JSON.stringify({
    edit: providersStore.providerEdit,
    apiKey: providersStore.editApiKey,
    clearApiKey: providersStore.editClearApiKey
  });
}

export function markProviderEditPristine(): void {
  providersStore.editSnapshot = serializeProviderEdit();
}

export function providerEditDirty(): boolean {
  if (!providersStore.providerEdit) return false;
  return serializeProviderEdit() !== providersStore.editSnapshot;
}

export function defaultProviderPath(protocol: "openai-compatible" | "anthropic"): string {
  return protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
}

function createProviderId(): string {
  return `custom-${Date.now().toString(36)}`;
}

function notifyProvidersChanged(): void {
  window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT));
  notifySettingsChanged();
}

async function runLoadProviders(endpoint: string): Promise<void> {
  providersStore.endpoint = endpoint;
  providersStore.loading = true;
  session.error = "";
  try {
    providersStore.providers = await loadDesktopProviders(endpoint);
    providersStore.loadError = "";
    if (!providersStore.providerEdit && !providersStore.globalsDirty) {
      providersStore.globals = {
        providerMode: providersStore.providers.providerMode,
        piProvider: providersStore.providers.piProvider,
        piModel: providersStore.providers.piModel,
        defaultCustomProviderId: providersStore.providers.defaultCustomProviderId
      };
    }
  } catch (cause) {
    providersStore.loadError = cause instanceof Error ? cause.message : String(cause);
    setError(cause);
  } finally {
    providersStore.loading = false;
  }
}

let inflightLoad: Promise<void> | null = null;

/**
 * The section `$effect`, the save handlers and manual retries all reach for
 * this. Plain callers share whatever request is already in flight rather than
 * racing over the single `loading` flag; `force` (used right after a write)
 * queues behind it so the caller never reads back pre-write state.
 */
export function loadProviders(endpoint: string, options: { force?: boolean } = {}): Promise<void> {
  const previous = inflightLoad;
  if (previous && !options.force) return previous;
  // runLoadProviders never rejects, so chaining onto it needs no catch.
  const run = previous ? previous.then(() => runLoadProviders(endpoint)) : runLoadProviders(endpoint);
  inflightLoad = run;
  void run.finally(() => {
    if (inflightLoad === run) inflightLoad = null;
  });
  return run;
}

export function retryLoadProviders(): void {
  if (!session.endpoint) return;
  void loadProviders(session.endpoint, { force: true });
}

export function beginNewProvider(): void {
  providersStore.providerEdit = {
    isNew: true,
    isBuiltin: false,
    id: createProviderId(),
    name: "",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "",
    models: [],
    defaultModel: "",
    path: "/v1/chat/completions",
    thinkingFormat: null
  };
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
  providersStore.actionMessage = "";
  markProviderEditPristine();
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
  providersStore.providerEdit = { ...providerItemToUpdateRequest(provider), isNew: false, isBuiltin: false };
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
  providersStore.actionMessage = "";
  markProviderEditPristine();
}

export function beginBuiltinProviderEdit(provider: { id: string; name: string; models: string[] }): void {
  const saved = providersStore.providers?.customProviders.find((item) => item.id === provider.id);
  providersStore.providerEdit = saved
    ? { ...providerItemToUpdateRequest(saved), isNew: false, isBuiltin: true }
    : {
        isNew: true,
        isBuiltin: true,
        id: provider.id,
        name: provider.name,
        enabled: false,
        protocol: "openai-compatible",
        baseUrl: "",
        models: provider.models.map((id) => ({
          id,
          tags: ["text"],
          supportedRoles: ["system", "user", "assistant", "tool"],
          enabled: true,
          verification: {}
        })),
        defaultModel: provider.models[0] ?? "",
        path: "/v1/chat/completions",
        thinkingFormat: null
      };
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
  providersStore.actionMessage = "";
  markProviderEditPristine();
}

/** Reloads the draft from the freshly saved summary so the inline pane stays open. */
export function reopenProviderEdit(providerId: string, isBuiltin: boolean): void {
  const builtin = isBuiltin
    ? providersStore.providers?.builtinProviders.find((item) => item.id === providerId)
    : undefined;
  if (builtin) beginBuiltinProviderEdit(builtin);
  else beginProviderEdit(providerId);
}

export function closeProviderEdit(): void {
  providersStore.providerEdit = null;
  providersStore.editApiKey = "";
  providersStore.editClearApiKey = false;
  providersStore.discoveredModels = [];
  providersStore.editSnapshot = "";
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
    const { isNew, isBuiltin, ...draft } = providersStore.providerEdit;
    if (isNew) {
      const request: DesktopProviderCreateRequest = {
        ...draft,
        apiKey: providersStore.editApiKey.trim()
      };
      const result = await createDesktopProvider(endpoint, request);
      if (!result.ok) throw new Error(result.error || "Provider save failed");
      await loadProviders(endpoint, { force: true });
    } else {
      providersStore.providers = await updateDesktopProvider(endpoint, {
        ...draft,
        apiKey: providersStore.editApiKey.trim() || undefined,
        clearApiKey: providersStore.editClearApiKey
      });
      providersStore.globals = { ...providersStore.globals, defaultCustomProviderId: providersStore.providers.defaultCustomProviderId };
    }
    // The editor is inline: reload the saved record in place instead of closing,
    // so the pane keeps showing the provider the user is working on.
    reopenProviderEdit(draft.id, isBuiltin);
    notifyProvidersChanged();
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
  if (!endpoint || providersStore.saving) return;
  providersStore.saving = true;
  try {
    providersStore.providers = await deleteDesktopProvider(endpoint, providerId);
    providersStore.globals = { ...providersStore.globals, defaultCustomProviderId: providersStore.providers.defaultCustomProviderId };
    if (providersStore.providerEdit?.id === providerId) closeProviderEdit();
    providersStore.actionFailed = false;
    providersStore.actionMessage = session.text.providerDeleted;
    notifyProvidersChanged();
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
    notifyProvidersChanged();
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
  if (!endpoint || !providersStore.providerEdit || providersStore.discovering) return;
  providersStore.discovering = true;
  providersStore.actionMessage = "";
  providersStore.actionFailed = false;
  try {
    const edit = providersStore.providerEdit;
    const apiKey = providersStore.editApiKey.trim() || undefined;
    providersStore.discoveredModels = await discoverDesktopProviderModels(endpoint, edit.id, {
      baseUrl: edit.baseUrl.trim(),
      apiKey,
      protocol: edit.protocol,
      path: edit.path.trim()
    });
    providersStore.actionFailed = false;
    providersStore.actionMessage = session.text.providerModelsDiscovered.replace("{count}", String(providersStore.discoveredModels.length));
  } catch (cause) {
    providersStore.actionFailed = true;
    providersStore.actionMessage = cause instanceof Error ? cause.message : String(cause);
  } finally {
    providersStore.discovering = false;
  }
}

export async function verifyProviderModel(index: number): Promise<{ ok: boolean; message: string; model: DesktopProviderModel } | null> {
  const endpoint = session.endpoint;
  const model = providersStore.providerEdit?.models[index];
  if (!endpoint || !providersStore.providerEdit || providersStore.providerEdit.isNew || !model?.id.trim() || providersStore.testingId) return null;
  providersStore.testingId = `${providersStore.providerEdit.id}:${model.id}`;
  try {
    const result = await testDesktopProvider(endpoint, providersStore.providerEdit.id, model.id);
    if (result.supportedRoles || result.verification) {
      updateProviderModel(index, {
        supportedRoles: result.supportedRoles ?? model.supportedRoles,
        verification: { ...model.verification, ...(result.verification ?? {}) }
      });
    }
    return {
      ok: result.ok,
      message: result.ok ? session.text.onboardingProviderTestOk : `${session.text.onboardingProviderTestFail}: ${result.error || result.message || session.text.unknownValue}`,
      model: providersStore.providerEdit.models[index] ?? model
    };
  } catch (cause) {
    return {
      ok: false,
      message: `${session.text.onboardingProviderTestFail}: ${cause instanceof Error ? cause.message : String(cause)}`,
      model
    };
  } finally {
    providersStore.testingId = null;
  }
}
