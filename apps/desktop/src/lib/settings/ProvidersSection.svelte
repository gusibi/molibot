<script lang="ts">
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Component from "reicon-svelte/icons/Component";
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import Gear from "reicon-svelte/icons/Gear";
  import Globe from "reicon-svelte/icons/Globe";
  import Loader from "reicon-svelte/icons/Loader";
  import Login from "reicon-svelte/icons/Login";
  import Microphone from "reicon-svelte/icons/Microphone";
  import Minus from "reicon-svelte/icons/Minus";
  import PenLine from "reicon-svelte/icons/PenLine";
  import PlugCircle from "reicon-svelte/icons/PlugCircle";
  import Plus from "reicon-svelte/icons/Plus";
  import Refresh from "reicon-svelte/icons/Refresh";
  import SortDesc from "reicon-svelte/icons/SortDesc";
  import Soundwave from "reicon-svelte/icons/Soundwave";
  import Speaker from "reicon-svelte/icons/Speaker";
  import Sparkle from "reicon-svelte/icons/Sparkle";
  import SquareArrowUp from "reicon-svelte/icons/SquareArrowUp";
  import Star from "reicon-svelte/icons/Star";
  import Text from "reicon-svelte/icons/Text";
  import Timer from "reicon-svelte/icons/Timer";
  import Trash from "reicon-svelte/icons/Trash";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import Tuning from "reicon-svelte/icons/Tuning";
  import X from "reicon-svelte/icons/X";
  import XCircle from "reicon-svelte/icons/XCircle";
  import type { ReiconComponent } from "../components/ui/iconTypes";
  import {
    type DesktopProviderItem,
    type DesktopProviderModel,
    type DesktopProviderModelTag,
    type DesktopProvidersSummary,
    type DesktopProviderUpdateRequest
  } from "@molibot/desktop-contract";
  import { matchModelCapabilities, type InferredModelMatchResponse } from "../api";
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import { humanizeProviderName } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { tablist } from "../a11y/tablist";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    beginProviderAuth,
    closeProviderAuth,
    loadProviderAuth,
    resetProviderAuthRequest,
    logoutProviderAuth,
    providerAuthIsTerminal,
    providerAuthStore,
    submitProviderAuthAnswer,
    verifyProviderAuth
  } from "../stores/providerAuth.svelte";
  import {
    providersStore,
    PROVIDER_MODEL_ROLES,
    PROVIDER_MODEL_TAGS,
    PROVIDER_THINKING_FORMATS,
    addProviderModel,
    beginBuiltinProviderEdit,
    beginNewProvider,
    beginProviderEdit,
    closeProviderEdit,
    defaultProviderPath,
    discoverProviderModels,
    loadProviders,
    providerEditDirty,
    removeProvider,
    removeProviderModel,
    retryLoadProviders,
    saveProviderEdit,
    saveProviderGlobals,
    setProviderAsDefault,
    updateProviderEdit,
    updateProviderModel,
    verifyProvider,
    verifyProviderModel
  } from "../stores/providers.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== providersStore.endpoint) {
      void loadProviders(session.endpoint);
    }
  });

  $effect(() => {
    if (session.serviceReady && session.endpoint) void loadProviderAuth();
    else resetProviderAuthRequest();
  });

  let providerSearch = $state("");
  let providerTab = $state<"builtin" | "custom">("builtin");
  let providerSortActive = $state(true);
  let selectedProviderId = $state("");
  let pendingDeleteProviderId = $state("");
  let pendingSwitchProviderId = $state("");
  let apiKeyVisible = $state(false);
  let modelEditorIndex = $state<number | null>(null);
  let modelEditorDraft = $state<DesktopProviderModel | null>(null);
  let modelSamplingDraft = $state("");
  let modelSamplingError = $state("");
  let modelVerificationMessage = $state("");
  let modelVerificationFailed = $state(false);
  let modelDiscoveryOpen = $state(false);
  let modelDiscoveryQuery = $state("");
  let modelDiscoveryFilter = $state<"all" | "added" | "new">("all");
  let modelSearch = $state("");
  let sortActiveFirst = $state(true);
  let collapsedGroups = $state<string[]>([]);

  type ProviderBrowserItem =
    | { kind: "builtin"; provider: DesktopProvidersSummary["builtinProviders"][number]; index: number }
    | { kind: "custom"; provider: DesktopProviderItem; index: number }
    | { kind: "draft"; provider: { id: string; name: string }; index: number };

  const CAPABILITY_ICONS: Record<DesktopProviderModelTag, ReiconComponent> = {
    text: Text,
    vision: Eye,
    audio_input: Microphone,
    stt: Soundwave,
    tts: Speaker,
    tool: Component
  };

  function capabilityLabel(tag: DesktopProviderModelTag): string {
    if (tag === "text") return session.text.providerCapabilityText;
    if (tag === "vision") return session.text.providerCapabilityVision;
    if (tag === "audio_input") return session.text.providerCapabilityAudioInput;
    if (tag === "stt") return session.text.providerCapabilityStt;
    if (tag === "tts") return session.text.providerCapabilityTts;
    return session.text.providerCapabilityTool;
  }

  /** Stable per-provider hue so the rail reads as a set of distinct marks, not a wall of text. */
  function providerHue(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 360;
    return hash;
  }

  function providerInitial(name: string, id: string): string {
    const source = (name || id).trim().replace(/^\[[^\]]+\]\s*/, "");
    const first = source[0] ?? "?";
    return /[a-z0-9]/i.test(first) ? first.toUpperCase() : first;
  }

  let builtinProviderIds = $derived(new Set(providersStore.providers?.builtinProviders.map((provider) => provider.id) ?? []));

  function providerProtocolLabel(protocol: string): string {
    return protocol === "openai-compatible" ? session.text.protocolOpenaiCompatible : protocol;
  }

  function providerLabel(name: string, id: string): string {
    return humanizeProviderName(name, id).label;
  }

  let draftProvider = $derived(
    providersStore.providerEdit?.isNew && !providersStore.providerEdit.isBuiltin ? providersStore.providerEdit : null
  );

  let visibleProvidersList = $derived.by(() => {
    if (!providersStore.providers) return [] as ProviderBrowserItem[];
    let list: ProviderBrowserItem[] = providerTab === "builtin"
      ? providersStore.providers.builtinProviders.map((provider, index) => ({ kind: "builtin" as const, provider, index }))
      : providersStore.providers.customProviders
          .filter((provider) => !builtinProviderIds.has(provider.id))
          .map((provider, index) => ({ kind: "custom" as const, provider, index }));

    const query = providerSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => item.provider.name.toLowerCase().includes(query) || item.provider.id.toLowerCase().includes(query));
    }

    if (providerSortActive) {
      list = [...list].sort((a, b) => {
        const aVal = providerEnabled(a) ? 1 : 0;
        const bVal = providerEnabled(b) ? 1 : 0;
        if (aVal !== bVal) return bVal - aVal;
        return a.index - b.index;
      });
    }

    // An unsaved new provider lives in the rail like any other row so selection,
    // dirty tracking, and the detail pane all follow the same single code path.
    if (draftProvider && providerTab === "custom") {
      list = [{ kind: "draft" as const, provider: { id: draftProvider.id, name: draftProvider.name }, index: -1 }, ...list];
    }

    return list;
  });

  let selectedProvider = $derived(
    visibleProvidersList.find((item) => item.provider.id === selectedProviderId) ?? visibleProvidersList[0] ?? null
  );

  let editor = $derived(providersStore.providerEdit);
  let editorIsDirty = $derived(providerEditDirty());

  onDestroy(trackUnsaved(() => editorIsDirty));
  onDestroy(trackUnsaved(() => providersStore.globalsDirty));
  let savedSelectedProvider = $derived(
    providersStore.providers?.customProviders.find((item) => item.id === selectedProvider?.provider.id) ?? null
  );

  let selectedProviderAuth = $derived(
    selectedProvider?.kind === "builtin"
      ? providerAuthStore.providers.find((provider) => provider.id === selectedProvider.provider.id)
      : undefined
  );
  let selectedProviderAuthStatus = $derived(
    selectedProviderAuth?.credential ? session.text.providerAuthConnected : session.text.providerAuthNotConnected
  );
  let authCopiedCode = $state("");
  let selectedProviderVerification = $derived(
    selectedProviderAuth ? providerAuthStore.verified[selectedProviderAuth.id] : undefined
  );

  function providerModelCount(item: ProviderBrowserItem): number {
    if (editor && editor.id === item.provider.id) return editor.models.length;
    if (item.kind === "builtin") return item.provider.models.length;
    if (item.kind === "custom") return item.provider.modelCount;
    return 0;
  }

  function providerEnabled(item: ProviderBrowserItem): boolean {
    if (item.kind === "draft") return providersStore.providerEdit?.enabled === true;
    if (item.kind === "custom") return item.provider.enabled;
    return providersStore.providers?.customProviders.find((provider) => provider.id === item.provider.id)?.enabled === true;
  }

  function openEditorFor(item: ProviderBrowserItem): void {
    if (item.kind === "draft") return;
    if (item.kind === "builtin") beginBuiltinProviderEdit(item.provider);
    else beginProviderEdit(item.provider.id);
  }

  function applySelection(id: string): void {
    selectedProviderId = id;
    const item = visibleProvidersList.find((entry) => entry.provider.id === id);
    if (item) openEditorFor(item);
    apiKeyVisible = false;
    modelSearch = "";
    collapsedGroups = [];
  }

  function selectProvider(id: string): void {
    if (id === selectedProviderId) return;
    if (editorIsDirty) {
      pendingSwitchProviderId = id;
      return;
    }
    applySelection(id);
  }

  function switchTab(tab: "builtin" | "custom"): void {
    if (providerTab === tab) return;
    providerTab = tab;
  }

  // Keeps the rail selection and the inline draft in sync: an invalid selection
  // falls back to the first row, and a valid one always has its editor loaded.
  $effect(() => {
    const list = visibleProvidersList;
    if (list.length === 0) return;
    const current = list.find((item) => item.provider.id === selectedProviderId);
    if (!current) {
      applySelection(list[0].provider.id);
      return;
    }
    if (current.kind !== "draft" && providersStore.providerEdit?.id !== current.provider.id) openEditorFor(current);
  });

  function startNewProvider(): void {
    if (editorIsDirty) {
      pendingSwitchProviderId = "__new__";
      return;
    }
    providerTab = "custom";
    beginNewProvider();
    selectedProviderId = providersStore.providerEdit?.id ?? "";
    apiKeyVisible = true;
  }

  function resolvePendingSwitch(): void {
    const target = pendingSwitchProviderId;
    pendingSwitchProviderId = "";
    if (!target) return;
    closeProviderEdit();
    if (target === "__new__") {
      startNewProvider();
      return;
    }
    applySelection(target);
  }

  let hasEditBaseUrl = $derived(!!editor?.baseUrl.trim());
  let savedEditProvider = $derived(
    providersStore.providers?.customProviders.find((item) => item.id === editor?.id) ?? null
  );
  let hasEditApiKey = $derived(
    !!(providersStore.editApiKey.trim() || (!editor?.isNew && savedEditProvider?.hasApiKey && !providersStore.editClearApiKey))
  );
  let canDiscoverModels = $derived(
    Boolean(editor) &&
      (editor!.isBuiltin || hasEditBaseUrl) &&
      (editor!.isBuiltin || hasEditApiKey) &&
      !providersStore.discovering
  );
  let canSaveEditor = $derived(
    Boolean(editor) &&
      !providersStore.saving &&
      editor!.id.trim().length > 0 &&
      editor!.name.trim().length > 0 &&
      (editor!.isBuiltin || (editor!.baseUrl.trim().length > 0 && (!editor!.isNew || providersStore.editApiKey.trim().length > 0)))
  );

  let baseUrlPreview = $derived.by(() => {
    if (!editor) return "";
    const base = editor.baseUrl.trim().replace(/\/+$/, "");
    if (!base) return "";
    const path = editor.path.trim() || defaultProviderPath(editor.protocol);
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  });

  /** Groups a model id by the prefix before its first dash. */
  function modelGroupKey(id: string): string {
    const tail = id.split("/").at(-1)?.trim() ?? "";
    if (!tail) return session.text.providerModelGroupOther;
    const [prefix] = tail.split("-");
    return prefix || tail;
  }

  let editModelIds = $derived(new Set((editor?.models ?? []).map((model) => model.id.trim()).filter(Boolean)));

  let visibleModelsList = $derived.by(() => {
    if (!editor) return [] as Array<{ model: DesktopProviderModel; index: number }>;
    let list = editor.models.map((model, index) => ({ model, index }));
    const query = modelSearch.trim().toLowerCase();
    if (query) list = list.filter((item) => item.model.id.toLowerCase().includes(query));
    if (sortActiveFirst) {
      list = [...list].sort((a, b) => {
        const aVal = a.model.enabled ? 1 : 0;
        const bVal = b.model.enabled ? 1 : 0;
        if (aVal !== bVal) return bVal - aVal;
        return a.index - b.index;
      });
    }
    return list;
  });

  let modelGroups = $derived.by(() => {
    const groups = new Map<string, Array<{ model: DesktopProviderModel; index: number }>>();
    for (const item of visibleModelsList) {
      const key = modelGroupKey(item.model.id);
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items }));
  });

  function toggleGroup(name: string): void {
    collapsedGroups = collapsedGroups.includes(name)
      ? collapsedGroups.filter((entry) => entry !== name)
      : [...collapsedGroups, name];
  }

  let discoveryGroups = $derived.by(() => {
    const query = modelDiscoveryQuery.trim().toLowerCase();
    const groups = new Map<string, string[]>();
    for (const id of providersStore.discoveredModels) {
      if (query && !id.toLowerCase().includes(query)) continue;
      const added = editModelIds.has(id);
      if (modelDiscoveryFilter === "added" && !added) continue;
      if (modelDiscoveryFilter === "new" && added) continue;
      const key = modelGroupKey(id);
      const bucket = groups.get(key);
      if (bucket) bucket.push(id);
      else groups.set(key, [id]);
    }
    return [...groups.entries()].map(([name, ids]) => ({ name, ids }));
  });

  let discoveryVisibleCount = $derived(discoveryGroups.reduce((total, group) => total + group.ids.length, 0));

  function addDiscoveredModel(id: string): void {
    const value = id.trim();
    if (!value || editModelIds.has(value)) return;
    addProviderModel(value);
  }

  function removeModelById(id: string): void {
    const index = editor?.models.findIndex((model) => model.id === id) ?? -1;
    if (index >= 0) removeProviderModel(index);
  }

  function addDiscoveredGroup(ids: string[]): void {
    for (const id of ids) addDiscoveredModel(id);
  }

  let modelAutoDetected = $state(false);

  function openNewModelEditor(): void {
    modelEditorIndex = null;
    modelVerificationMessage = "";
    modelVerificationFailed = false;
    modelAutoDetected = false;
    modelEditorDraft = {
      id: "",
      tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool"],
      enabled: true,
      verification: {}
    };
    modelSamplingDraft = "";
    modelSamplingError = "";
  }

  function openProviderEditModel(index: number): void {
    const model = editor?.models[index];
    if (!model) return;
    modelEditorIndex = index;
    modelVerificationMessage = "";
    modelVerificationFailed = false;
    modelAutoDetected = false;
    modelEditorDraft = {
      ...model,
      tags: [...model.tags],
      supportedRoles: [...(model.supportedRoles ?? [])],
      verification: { ...(model.verification ?? {}) }
    };
    modelSamplingDraft = model.samplingParams ? JSON.stringify(model.samplingParams, null, 2) : "";
    modelSamplingError = "";
  }

  function closeModelEditor(): void {
    modelEditorIndex = null;
    modelEditorDraft = null;
    modelVerificationMessage = "";
    modelVerificationFailed = false;
    modelAutoDetected = false;
    modelSamplingDraft = "";
    modelSamplingError = "";
  }

  let modelMatchTimer: number | null = null;
  function onModelIdInput(event: Event): void {
    const id = (event.currentTarget as HTMLInputElement).value;
    if (!modelEditorDraft) return;
    modelEditorDraft = { ...modelEditorDraft, id };
    modelAutoDetected = false;

    if (!session.endpoint || !id.trim()) return;

    if (modelMatchTimer !== null) window.clearTimeout(modelMatchTimer);
    modelMatchTimer = window.setTimeout(async () => {
      if (!modelEditorDraft || modelEditorDraft.id !== id) return;
      try {
        const result = await matchModelCapabilities(session.endpoint!, id.trim());
        if (result.ok && result.matched && modelEditorDraft && modelEditorDraft.id === id) {
          modelAutoDetected = true;
          modelEditorDraft = {
            ...modelEditorDraft,
            alias: modelEditorDraft.alias || result.alias,
            contextWindow: modelEditorDraft.contextWindow || result.contextWindow,
            tags: result.tags && result.tags.length > 0 ? [...result.tags] : modelEditorDraft.tags,
            supportedRoles: result.supportedRoles && result.supportedRoles.length > 0
              ? (result.supportedRoles as any)
              : modelEditorDraft.supportedRoles
          };
        }
      } catch {
        // ignore match failure
      }
    }, 300);
  }

  async function verifyModelEditorConnection(): Promise<void> {
    if (modelEditorIndex === null || !modelEditorDraft || !editor) return;
    const index = modelEditorIndex;
    const providerId = editor.id;
    modelVerificationMessage = "";
    modelVerificationFailed = false;
    const outcome = await verifyProviderModel(index);
    // Closing the dialog or switching providers while the request is in flight
    // retires the result instead of leaking it into a different editor.
    if (!outcome || modelEditorIndex !== index || !modelEditorDraft || editor?.id !== providerId) return;
    modelVerificationMessage = outcome.message;
    modelVerificationFailed = !outcome.ok;
    modelEditorDraft = {
      ...modelEditorDraft,
      supportedRoles: outcome.model.supportedRoles ? [...outcome.model.supportedRoles] : modelEditorDraft.supportedRoles,
      verification: { ...(outcome.model.verification ?? {}) }
    };
  }

  function saveModelEditor(): void {
    if (!modelEditorDraft?.id.trim() || !providersStore.providerEdit) return;
    let samplingParams: Record<string, unknown> | undefined;
    if (modelSamplingDraft.trim()) {
      try {
        const parsed = JSON.parse(modelSamplingDraft) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        samplingParams = parsed as Record<string, unknown>;
      } catch {
        modelSamplingError = session.text.providerModelSamplingInvalid;
        return;
      }
    }
    const draft = { ...modelEditorDraft, id: modelEditorDraft.id.trim(), samplingParams };
    if (modelEditorIndex === null) {
      const index = providersStore.providerEdit.models.length;
      addProviderModel(draft.id);
      updateProviderModel(index, draft);
    } else {
      const previousId = providersStore.providerEdit.models[modelEditorIndex]?.id;
      updateProviderModel(modelEditorIndex, draft);
      if (previousId && providersStore.providerEdit.defaultModel === previousId && previousId !== draft.id) {
        updateProviderEdit((provider) => ({ ...provider, defaultModel: draft.id }));
      }
    }
    closeModelEditor();
  }

  function toggleModelEditorTag(tag: DesktopProviderModel["tags"][number]): void {
    if (!modelEditorDraft) return;
    const tags = modelEditorDraft.tags.includes(tag)
      ? modelEditorDraft.tags.filter((item) => item !== tag)
      : [...modelEditorDraft.tags, tag];
    modelEditorDraft = { ...modelEditorDraft, tags: tags.length > 0 ? tags : ["text"] };
  }

  function toggleModelEditorRole(role: NonNullable<DesktopProviderModel["supportedRoles"]>[number]): void {
    if (!modelEditorDraft) return;
    const roles = modelEditorDraft.supportedRoles ?? [];
    modelEditorDraft = {
      ...modelEditorDraft,
      supportedRoles: roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role]
    };
  }

  async function openModelDiscovery(): Promise<void> {
    modelDiscoveryOpen = true;
    modelDiscoveryQuery = "";
    modelDiscoveryFilter = "all";
    await discoverProviderModels();
  }

  async function openProviderAuthUrl(value: string): Promise<void> {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported URL scheme");
      if ("__TAURI_INTERNALS__" in window) {
        await invoke("open_external_url", { url: url.href });
      } else {
        window.open(url.href, "_blank", "noopener,noreferrer");
      }
    } catch (cause) {
      providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function copyProviderAuthCode(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      // Keyed on the code itself: a device code that gets refreshed mid-flow
      // must not inherit the previous code's "copied" state.
      authCopiedCode = value;
      window.setTimeout(() => {
        if (authCopiedCode === value) authCopiedCode = "";
      }, 1800);
    } catch (cause) {
      providerAuthStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.providersUnavailable} icon="cloud-slash" /></SettingGroup>
{:else if providersStore.loading && !providersStore.providers}
  <SettingGroup><SkeletonRows count={4} label={session.text.loading} /></SettingGroup>
{:else if !providersStore.providers}
  <div class="settings-card" role="alert">
    <div class="settings-row">
      <div><p>{session.text.workspaceLoadFailed}</p>{#if providersStore.loadError}<small>{providersStore.loadError}</small>{/if}</div>
      <button class="secondary-button" type="button" disabled={providersStore.loading} onclick={retryLoadProviders}>{session.text.retryLoading}</button>
    </div>
  </div>
{:else}
  {#if providersStore.loadError}
    <div class="settings-card" role="alert">
      <div class="settings-row">
        <div><p>{session.text.workspaceLoadFailed}</p><small>{providersStore.loadError}</small></div>
        <button class="secondary-button" type="button" disabled={providersStore.loading} onclick={retryLoadProviders}>{session.text.retryLoading}</button>
      </div>
    </div>
  {/if}
  <SettingGroup title={session.text.providerGlobalSettings}>
    <SettingRow title={session.text.providersMode}>
      <div class="segmented" role="tablist" aria-label={session.text.providersMode} use:tablist>
        <button
          type="button"
          role="tab"
          id="providers-mode-pi-tab"
          aria-selected={providersStore.globals.providerMode !== "custom"}
          aria-controls="providers-mode-pi-panel"
          class="segmented-item"
          class:active={providersStore.globals.providerMode !== "custom"}
          onclick={() => {
            providersStore.globals = { ...providersStore.globals, providerMode: "pi" };
            providersStore.globalsDirty = true;
          }}
        >{session.text.providersModePi}</button>
        <button
          type="button"
          role="tab"
          id="providers-mode-custom-tab"
          aria-selected={providersStore.globals.providerMode === "custom"}
          aria-controls="providers-mode-custom-panel"
          class="segmented-item"
          class:active={providersStore.globals.providerMode === "custom"}
          onclick={() => {
            providersStore.globals = { ...providersStore.globals, providerMode: "custom" };
            providersStore.globalsDirty = true;
          }}
        >{session.text.providersModeCustom}</button>
      </div>
    </SettingRow>
    {#if providersStore.globals.providerMode !== "custom"}
      <div id="providers-mode-pi-panel" role="tabpanel" aria-labelledby="providers-mode-pi-tab">
      <SettingRow title={session.text.providersPiProvider}>
        <SelectControl
          value={providersStore.globals.piProvider}
          ariaLabel={session.text.providersPiProvider}
          options={[
            { value: "", label: "—" },
            ...providersStore.providers.builtinProviders.map((provider) => ({
              value: provider.id,
              label: providerLabel(provider.name, provider.id)
            }))
          ]}
          technicalId={providersStore.globals.piProvider}
          technicalLabel={session.text.technicalDetails}
          onChange={(piProvider) => {
            const piModel = providersStore.providers?.builtinProviders.find((provider) => provider.id === piProvider)?.models[0] ?? "";
            providersStore.globals = { ...providersStore.globals, piProvider, piModel };
            providersStore.globalsDirty = true;
          }}
        />
      </SettingRow>
      <SettingRow title={session.text.providersPiModel}>
        <SelectControl
          value={providersStore.globals.piModel}
          ariaLabel={session.text.providersPiModel}
          options={[
            { value: "", label: "—" },
            ...(providersStore.providers.builtinProviders.find((provider) => provider.id === providersStore.globals.piProvider)?.models ?? []).map((model) => ({
              value: model,
              label: humanizeProviderName(model.split("/").at(-1) ?? model, model).label
            }))
          ]}
          technicalId={providersStore.globals.piModel}
          technicalLabel={session.text.technicalDetails}
          onChange={(piModel) => {
            providersStore.globals = { ...providersStore.globals, piModel };
            providersStore.globalsDirty = true;
          }}
        />
      </SettingRow>
      </div>
    {:else}
      <div id="providers-mode-custom-panel" role="tabpanel" aria-labelledby="providers-mode-custom-tab">
      <SettingRow title={session.text.providerSetDefault}>
        <SelectControl
          value={providersStore.globals.defaultCustomProviderId}
          ariaLabel={session.text.providerSetDefault}
          options={[
            { value: "", label: "—" },
            ...providersStore.providers.customProviders.filter((provider) => provider.enabled).map((provider) => ({
              value: provider.id,
              label: providerLabel(provider.name, provider.id)
            }))
          ]}
          onChange={(defaultCustomProviderId) => {
            providersStore.globals = { ...providersStore.globals, defaultCustomProviderId };
            providersStore.globalsDirty = true;
          }}
        />
      </SettingRow>
      </div>
    {/if}
  </SettingGroup>

  <section class="provider-workbench" aria-label={session.text.providerListTitle}>
    <aside class="provider-rail">
      <div class="provider-rail-head">
        <SearchField
          value={providerSearch}
          label={session.text.providersFilterTitle}
          placeholder={session.text.providersFilterTitle}
          onInput={(value) => (providerSearch = value)}
        />
        <div class="provider-rail-tabs" role="tablist" aria-orientation="vertical" aria-label={session.text.providersCategoryTitle} use:tablist>
          <button type="button" role="tab" id="provider-rail-tab-builtin" aria-selected={providerTab === "builtin"} aria-controls="provider-rail-list-panel" class="provider-rail-tab" class:active={providerTab === "builtin"} onclick={() => switchTab("builtin")}>{session.text.providerBuiltinTitle}</button>
          <button type="button" role="tab" id="provider-rail-tab-custom" aria-selected={providerTab === "custom"} aria-controls="provider-rail-list-panel" class="provider-rail-tab" class:active={providerTab === "custom"} onclick={() => switchTab("custom")}>{session.text.providerSelfHostedTitle}</button>
          <button
            type="button"
            class="provider-rail-sort"
            class:active={providerSortActive}
            aria-pressed={providerSortActive}
            title={session.text.modelSortActive}
            aria-label={session.text.modelSortActive}
            onclick={() => (providerSortActive = !providerSortActive)}
          ><SortDesc size={13} aria-hidden="true" /></button>
        </div>
      </div>

      <div class="provider-rail-list" id="provider-rail-list-panel" role="tabpanel" aria-labelledby={`provider-rail-tab-${providerTab}`}>
        {#if visibleProvidersList.length === 0}
          <EmptyState title={session.text.providersEmpty} icon="plugs" />
        {:else}
          {#each visibleProvidersList as item (item.provider.id)}
            {@const provider = item.provider}
            {@const label = item.kind === "draft" ? provider.name.trim() || session.text.providerNewDraft : providerLabel(provider.name, provider.id)}
            <button
              type="button"
              class="provider-rail-row"
              class:selected={selectedProvider?.provider.id === provider.id}
              onclick={() => selectProvider(provider.id)}
            >
              <span class="provider-avatar" style={`--provider-hue: ${providerHue(provider.id)}`} aria-hidden="true">{providerInitial(provider.name, provider.id)}</span>
              <span class="provider-rail-copy">
                <strong>{label}</strong>
                <small>{item.kind === "draft" ? session.text.providerUnsaved : `${providerModelCount(item)} ${session.text.providerModels}`}</small>
              </span>
              <span class="provider-state-pill" class:on={providerEnabled(item)}>{providerEnabled(item) ? session.text.providerStateOn : session.text.providerStateOff}</span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="provider-rail-foot">
        <button class="provider-rail-add" type="button" onclick={startNewProvider}>
          <Plus size={11} aria-hidden="true" />{session.text.providerAdd}
        </button>
      </div>
    </aside>

    {#if !editor || !selectedProvider}
      <section class="provider-pane provider-pane-empty" aria-label={session.text.providerListTitle}>
        <EmptyState title={session.text.providerWorkbenchEmpty} description={session.text.providerWorkbenchEmptyHint} icon="plugs" />
      </section>
    {:else}
      {@const providerName = editor.name.trim() || (editor.isNew && !editor.isBuiltin ? session.text.providerNewDraft : providerLabel(editor.name, editor.id))}
      <section class="provider-pane" aria-label={providerName}>
        <header class="provider-pane-head">
          <span class="provider-avatar large" style={`--provider-hue: ${providerHue(editor.id)}`} aria-hidden="true">{providerInitial(editor.name, editor.id)}</span>
          <div class="provider-pane-title">
            <h3>{providerName}</h3>
            <div class="provider-pane-meta">
              <code>{editor.id}</code>
              <span class="provider-chip">{editor.isBuiltin ? "Pi" : providerProtocolLabel(editor.protocol)}</span>
              {#if savedSelectedProvider?.isDefault}<span class="provider-chip accent">{session.text.providersDefault}</span>{/if}
              <span class="provider-chip">{editor.models.length} {session.text.providerModels}</span>
            </div>
          </div>
          <div class="provider-pane-head-actions">
            {#if !editor.isNew}
              <OverflowMenu label={session.text.more}>
                <button role="menuitem" type="button" disabled={savedSelectedProvider?.isDefault || providersStore.saving} onclick={() => void setProviderAsDefault(editor.id)}><Star size={14} aria-hidden="true" />{session.text.providersSetDefault}</button>
                <button role="menuitem" type="button" disabled={providersStore.testingId !== null || !savedSelectedProvider?.hasApiKey} onclick={() => void verifyProvider(editor.id)}><PlugCircle size={14} aria-hidden="true" />{providersStore.testingId === editor.id ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button>
                {#if !editor.isBuiltin}
                  <button role="menuitem" class="danger-action" type="button" disabled={providersStore.saving} onclick={() => (pendingDeleteProviderId = editor.id)}><Trash size={14} aria-hidden="true" />{session.text.providerDelete}</button>
                {/if}
              </OverflowMenu>
            {/if}
            <IosSwitch checked={editor.enabled} ariaLabel={session.text.providerEnabledLabel} onCheckedChange={(checked) => updateProviderEdit((draft) => ({ ...draft, enabled: checked }))} />
          </div>
        </header>

        <div class="provider-pane-body">
          {#if selectedProviderAuth && !selectedProviderAuth.credential}
            <section class="provider-login-card">
              <span class="provider-avatar xlarge" style={`--provider-hue: ${providerHue(editor.id)}`} aria-hidden="true">{providerInitial(editor.name, editor.id)}</span>
              <button class="primary-button provider-login-button" type="button" disabled={Boolean(providerAuthStore.actionProviderId)} onclick={() => void beginProviderAuth(editor.id)}>
                <Login size={13} aria-hidden="true" />{providerAuthStore.actionProviderId === editor.id ? session.text.loading : selectedProviderAuth.loginLabel || session.text.providerAuthSignIn}
              </button>
              <p>{session.text.providerAuthHint}</p>
            </section>
          {:else if selectedProviderAuth}
            <section class="provider-auth-connected">
              <div class="provider-auth-connected-copy">
                <strong>{session.text.providerAuthTitle}</strong>
                <small>{selectedProviderAuth.effectiveAuth?.source ? session.text.providerAuthEffective.replace("{source}", selectedProviderAuth.effectiveAuth.source) : session.text.providerAuthHint}</small>
              </div>
              <StatusBadge label={selectedProviderAuthStatus} state="ready" />
              <div class="provider-auth-connected-actions">
                <button class="secondary-button" type="button" disabled={Boolean(providerAuthStore.verifying)} onclick={() => void verifyProviderAuth(editor.id)}>{providerAuthStore.verifying === editor.id ? session.text.providerAuthVerifying : session.text.providerAuthVerify}</button>
                <button class="secondary-button" type="button" disabled={Boolean(providerAuthStore.actionProviderId)} onclick={() => void logoutProviderAuth(editor.id)}>{session.text.providerAuthSignOut}</button>
              </div>
              {#if selectedProviderVerification}
                <p class="provider-auth-card-verdict" class:ok={selectedProviderVerification.ok}>
                  {#if selectedProviderVerification.ok}
                    <i aria-hidden="true"><CheckCircle size={11} /></i>{session.text.providerAuthVerifyOk.replace("{model}", selectedProviderVerification.modelId).replace("{ms}", String(selectedProviderVerification.elapsedMs))}
                  {:else}
                    <i aria-hidden="true"><TriangleWarning size={11} /></i>{session.text.providerAuthVerifyFailed.replace("{model}", selectedProviderVerification.modelId)}<span>{selectedProviderVerification.error}</span>
                  {/if}
                </p>
              {/if}
              {#if selectedProviderAuth.apiKeyOverride}
                <p class="provider-auth-card-warning">{session.text.providerAuthOverrideWarning}</p>
              {/if}
            </section>
          {/if}

          {#if editor.isNew && !editor.isBuiltin}
            <div class="provider-field-grid">
              <label class="provider-field">
                <span class="provider-field-label">{session.text.onboardingProviderName}</span>
                <input class="provider-input" value={editor.name} autocomplete="off" placeholder={session.text.providerNewNamePlaceholder} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} />
              </label>
              <label class="provider-field">
                <span class="provider-field-label">{session.text.providerId}</span>
                <input class="provider-input" value={editor.id} autocomplete="off" spellcheck="false" oninput={(event) => updateProviderEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} />
              </label>
            </div>
          {/if}

          <section class="provider-field">
            <div class="provider-field-head">
              <span class="provider-field-label">{session.text.providerApiKey}</span>
              {#if !editor.isNew && savedEditProvider?.hasApiKey}
                <label class="provider-field-toggle"><input type="checkbox" bind:checked={providersStore.editClearApiKey} />{session.text.providerClearApiKey}</label>
              {/if}
            </div>
            <div class="provider-input-group">
              <input
                class="provider-input"
                type={apiKeyVisible ? "text" : "password"}
                bind:value={providersStore.editApiKey}
                placeholder={savedEditProvider?.hasApiKey && !providersStore.editClearApiKey ? "••••••••••••••••" : session.text.providerApiKeyPlaceholder}
                autocomplete="new-password"
                spellcheck="false"
              />
              <button
                class="provider-input-icon"
                type="button"
                aria-label={apiKeyVisible ? session.text.providerApiKeyHide : session.text.providerApiKeyShow}
                title={apiKeyVisible ? session.text.providerApiKeyHide : session.text.providerApiKeyShow}
                onclick={() => (apiKeyVisible = !apiKeyVisible)}
              >{#if apiKeyVisible}<EyeSlash size={15} aria-hidden="true" />{:else}<Eye size={15} aria-hidden="true" />{/if}</button>
              <button
                class="provider-input-action"
                type="button"
                disabled={editor.isNew || providersStore.testingId !== null || !savedEditProvider?.hasApiKey}
                title={editor.isNew ? session.text.providerSaveBeforeRemote : undefined}
                onclick={() => void verifyProvider(editor.id)}
              >{providersStore.testingId === editor.id ? session.text.onboardingProviderTesting : session.text.providerApiKeyCheck}</button>
            </div>
            <p class="provider-field-hint">{savedEditProvider?.hasApiKey ? session.text.providerApiKeySaved : session.text.providerCreateKeyHint}</p>
          </section>

          {#if !editor.isBuiltin}
            <section class="provider-field">
              <div class="provider-field-head"><span class="provider-field-label">{session.text.providerBaseUrlLabel}</span></div>
              <input class="provider-input" value={editor.baseUrl} autocomplete="off" aria-label={session.text.providerBaseUrlLabel} placeholder="https://…" spellcheck="false" oninput={(event) => updateProviderEdit((draft) => ({ ...draft, baseUrl: (event.currentTarget as HTMLInputElement).value }))} />
              <p class="provider-field-hint">{baseUrlPreview ? session.text.providerBaseUrlPreview.replace("{url}", baseUrlPreview) : session.text.providerSelfHostedHint}</p>
            </section>
          {/if}

          <section class="provider-models-block" aria-label={session.text.providerModelsSectionTitle}>
            <header class="provider-models-head">
              <div class="provider-models-title">
                <strong>{session.text.providerModelsSectionTitle}</strong>
                <span class="provider-count">{editor.models.length}</span>
              </div>
              <div class="provider-models-tools">
                <button
                  class="secondary-button"
                  type="button"
                  disabled={!canDiscoverModels}
                  title={canDiscoverModels ? undefined : session.text.providerSaveBeforeRemote}
                  onclick={() => void openModelDiscovery()}
                >
                  {#if providersStore.discovering}
                    <Loader class="spin" size={14} aria-hidden="true" />{session.text.loading}
                  {:else}
                    <Refresh size={14} aria-hidden="true" />{session.text.providerPullModels}
                  {/if}
                </button>
                <button class="provider-icon-button" type="button" aria-label={session.text.providerAddModel} title={session.text.providerAddModel} onclick={openNewModelEditor}><Plus size={14} aria-hidden="true" /></button>
              </div>
            </header>

            {#if editor.models.length > 4}
              <div class="provider-models-filter">
                <SearchField value={modelSearch} label={session.text.modelSearchPlaceholder} placeholder={session.text.modelSearchPlaceholder} onInput={(value) => (modelSearch = value)} />
                <button type="button" class="provider-icon-button" class:active={sortActiveFirst} aria-pressed={sortActiveFirst} aria-label={session.text.modelSortActive} title={sortActiveFirst ? session.text.modelSortActive : session.text.modelSortDefault} onclick={() => (sortActiveFirst = !sortActiveFirst)}><SortDesc size={14} aria-hidden="true" /></button>
              </div>
            {/if}

            {#if visibleModelsList.length === 0}
              <EmptyState title={editor.models.length === 0 ? session.text.providerModelPickEmpty : session.text.providerModelPickNoMatch} icon="cube" />
            {:else}
              <div class="provider-model-groups">
                {#each modelGroups as group (group.name)}
                  {@const collapsed = collapsedGroups.includes(group.name)}
                  <div class="provider-model-group">
                    <button type="button" class="provider-model-group-head" aria-expanded={!collapsed} onclick={() => toggleGroup(group.name)}>
                      <i aria-hidden="true">{#if collapsed}<CaretRight size={11} />{:else}<AngleDown size={11} />{/if}</i>
                      <strong>{group.name}</strong>
                      <span class="provider-count">{group.items.length}</span>
                    </button>
                    {#if !collapsed}
                      <div class="provider-model-rows">
                        {#each group.items as item (item.index)}
                          {@const model = item.model}
                          <div class="provider-model-row" class:off={!model.enabled}>
                            <span class="provider-model-name">
                              {model.alias || model.id || session.text.providerModelId}
                              {#if model.alias}<small class="provider-model-alias-id" title={model.id}>{model.id}</small>{/if}
                            </span>
                            <span class="provider-model-caps">
                              {#each model.tags as tag (tag)}
                                {@const CapIcon = CAPABILITY_ICONS[tag]}
                                <span class="provider-cap" data-tag={tag} title={capabilityLabel(tag)}><CapIcon size={11} aria-hidden="true" /><span class="sr-only">{capabilityLabel(tag)}</span></span>
                              {/each}
                              {#if model.contextWindow}<span class="provider-model-context">{Math.round(model.contextWindow / 1000)}K</span>{/if}
                            </span>
                            <IosSwitch checked={model.enabled} ariaLabel={`${session.text.providerModelEnabled}: ${model.id}`} onCheckedChange={(enabled) => updateProviderModel(item.index, { enabled })} />
                            <button class="provider-icon-button" type="button" aria-label={`${session.text.providerModelEditTitle}: ${model.id}`} title={session.text.providerModelEditTitle} onclick={() => openProviderEditModel(item.index)}><Gear size={14} aria-hidden="true" /></button>
                            <button class="provider-icon-button danger-action" type="button" aria-label={`${session.text.providerModelRemove}: ${model.id}`} title={session.text.providerModelRemove} onclick={() => removeProviderModel(item.index)}><Minus size={14} aria-hidden="true" /></button>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <details class="provider-advanced">
            <summary><CaretRight class="provider-advanced-caret" size={13} aria-hidden="true" /><Tuning class="provider-advanced-sliders" size={15} aria-hidden="true" /><span>{session.text.providerAdvanced}</span></summary>
            <div class="provider-advanced-body">
              <div class="provider-field-grid">
                <label class="provider-field">
                  <span class="provider-field-label">{session.text.providerDefaultModel}</span>
                  <SelectControl value={editor.defaultModel} ariaLabel={session.text.providerDefaultModel} options={[{ value: "", label: "—" }, ...editor.models.map((model) => ({ value: model.id, label: model.id || session.text.providerModelId }))]} onChange={(value) => updateProviderEdit((draft) => ({ ...draft, defaultModel: value }))} />
                </label>
                <label class="provider-field">
                  <span class="provider-field-label">{session.text.providerThinkingFormat}</span>
                  <SelectControl value={editor.thinkingFormat ?? ""} ariaLabel={session.text.providerThinkingFormat} options={[{ value: "", label: session.text.providerThinkingAuto }, ...PROVIDER_THINKING_FORMATS.map((format) => ({ value: format, label: format }))]} onChange={(value) => updateProviderEdit((draft) => ({ ...draft, thinkingFormat: (value || null) as DesktopProviderUpdateRequest["thinkingFormat"] }))} />
                </label>
                {#if !editor.isBuiltin}
                  <label class="provider-field">
                    <span class="provider-field-label">{session.text.onboardingProviderProtocol}</span>
                    <SelectControl value={editor.protocol} ariaLabel={session.text.onboardingProviderProtocol} options={[{ value: "openai-compatible", label: session.text.protocolOpenaiCompatible }, { value: "anthropic", label: session.text.protocolAnthropic }]} onChange={(value) => updateProviderEdit((draft) => {
                      const protocol = value === "anthropic" ? "anthropic" : "openai-compatible";
                      const oldDefaultPath = defaultProviderPath(draft.protocol);
                      return { ...draft, protocol, path: !draft.path.trim() || draft.path === oldDefaultPath ? defaultProviderPath(protocol) : draft.path };
                    })} />
                  </label>
                  <label class="provider-field">
                    <span class="provider-field-label">{session.text.providerPath}</span>
                    <input class="provider-input" value={editor.path} autocomplete="off" spellcheck="false" oninput={(event) => updateProviderEdit((draft) => ({ ...draft, path: (event.currentTarget as HTMLInputElement).value }))} />
                  </label>
                {/if}
              </div>
            </div>
          </details>

          {#if providersStore.actionMessage && !modelEditorDraft}
            <p class:run-history-failed={providersStore.actionFailed} class="settings-action-message provider-pane-message" aria-live="polite">{providersStore.actionMessage}</p>
          {/if}
        </div>

        {#if editorIsDirty || editor.isNew}
          <footer class="provider-pane-foot">
            <span class="provider-pane-foot-label"><i aria-hidden="true"><PenLine size={11} /></i>{session.text.providerUnsaved}</span>
            <div class="provider-pane-foot-actions">
              <button class="secondary-button" type="button" disabled={providersStore.saving} onclick={() => { const item = visibleProvidersList.find((entry) => entry.provider.id === selectedProviderId); closeProviderEdit(); if (item && item.kind !== "draft") applySelection(item.provider.id); else selectedProviderId = ""; }}>{session.text.providerDiscard}</button>
              <button class="primary-button" type="button" disabled={!canSaveEditor} onclick={() => void saveProviderEdit()}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
            </div>
          </footer>
        {/if}
      </section>
    {/if}
  </section>

  {#if modelEditorDraft}
    <Dialog open={true} contentClass="provider-model-edit-dialog" labelledBy="provider-model-edit-title" describedBy="provider-model-edit-description" onOpenChange={(next) => { if (!next) closeModelEditor(); }}>
      <form class="provider-model-edit-form" onsubmit={(event) => { event.preventDefault(); saveModelEditor(); }}>
        <header class="modal-head">
          <div>
            <strong id="provider-model-edit-title">{modelEditorIndex === null ? session.text.providerAddModel : session.text.providerModelEditTitle}</strong>
            <p id="provider-model-edit-description">{session.text.providerModelEditHint}</p>
          </div>
          <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={closeModelEditor}><X size={16} aria-hidden="true" /></button>
        </header>
        <div class="modal-body provider-model-edit-body">
          <label class="provider-field">
            <span class="provider-field-label">{session.text.providerModelId}</span>
            <input class="provider-input" value={modelEditorDraft.id} autocomplete="off" placeholder="gpt-5" spellcheck="false" oninput={onModelIdInput} />
            {#if modelAutoDetected}
              <p class="provider-field-hint" style="color: var(--accent); display: flex; align-items: center; gap: 4px;">
                <Sparkle size={11} aria-hidden="true" /> {session.text.providerModelDetectedHint}
              </p>
            {/if}
          </label>
          <label class="provider-field">
            <span class="provider-field-label">{session.text.providerModelAlias}</span>
            <input class="provider-input" value={modelEditorDraft.alias ?? ""} autocomplete="off" placeholder={session.text.providerModelAliasHint} spellcheck="false" oninput={(event) => { const value = (event.currentTarget as HTMLInputElement).value; modelEditorDraft = modelEditorDraft ? { ...modelEditorDraft, alias: value.trim() ? value : undefined } : null; }} />
          </label>
          <label class="provider-field">
            <span class="provider-field-label">{session.text.providerModelContext}</span>
            <input class="provider-input" type="number" min="1" autocomplete="off" value={modelEditorDraft.contextWindow ?? ""} placeholder="200000" oninput={(event) => { const value = Number((event.currentTarget as HTMLInputElement).value); modelEditorDraft = modelEditorDraft ? { ...modelEditorDraft, contextWindow: Number.isFinite(value) && value > 0 ? value : undefined } : null; }} />
          </label>
          <label class="provider-field">
            <span class="provider-field-label">{session.text.providerModelSampling}</span>
            <textarea class="provider-input" rows="5" value={modelSamplingDraft} placeholder={'{\n  "top_p": 0.9,\n  "top_k": 40\n}'} oninput={(event) => { modelSamplingDraft = (event.currentTarget as HTMLTextAreaElement).value; modelSamplingError = ""; }}></textarea>
            <small>{session.text.providerModelSamplingHint}</small>
            {#if modelSamplingError}<small class="provider-field-error" role="alert">{modelSamplingError}</small>{/if}
          </label>
          <div class="provider-model-edit-switch">
            <div><strong>{session.text.providerModelEnabled}</strong><small>{modelEditorDraft.id || session.text.providerModelId}</small></div>
            <IosSwitch checked={modelEditorDraft.enabled} ariaLabel={session.text.providerModelEnabled} onCheckedChange={(enabled) => (modelEditorDraft = modelEditorDraft ? { ...modelEditorDraft, enabled } : null)} />
          </div>
          <fieldset class="provider-model-edit-options">
            <legend>{session.text.providerModelTags}</legend>
            <div>
              {#each PROVIDER_MODEL_TAGS as tag (tag)}
                {@const CapIcon = CAPABILITY_ICONS[tag]}
                <button type="button" class:active={modelEditorDraft.tags.includes(tag)} class="model-chip" onclick={() => toggleModelEditorTag(tag)}><CapIcon size={11} aria-hidden="true" />{capabilityLabel(tag)}</button>
              {/each}
            </div>
          </fieldset>
          <fieldset class="provider-model-edit-options">
            <legend>{session.text.providerModelRoles}</legend>
            <div>
              {#each PROVIDER_MODEL_ROLES as role (role)}
                <button type="button" class:active={(modelEditorDraft.supportedRoles ?? []).includes(role)} class="model-chip" onclick={() => toggleModelEditorRole(role)}>{role}</button>
              {/each}
            </div>
          </fieldset>
          {#if Object.keys(modelEditorDraft.verification ?? {}).length > 0}
            <div class="provider-model-verify">
              {#each PROVIDER_MODEL_TAGS as tag (tag)}
                {#if modelEditorDraft.verification?.[tag]}
                  <span class="model-chip verify-{modelEditorDraft.verification[tag]}">{capabilityLabel(tag)} · {modelEditorDraft.verification[tag] === "passed" ? session.text.providerModelVerifyPassed : modelEditorDraft.verification[tag] === "failed" ? session.text.providerModelVerifyFailed : session.text.providerModelVerifyUntested}</span>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
        <footer class="provider-modal-foot">
          {#if modelEditorIndex !== null && editor && !editor.isNew}
            <div class="provider-modal-foot-leading">
              {#if modelVerificationMessage}
                <span class:failed={modelVerificationFailed} class="provider-model-test-result" role="status" aria-live="polite" title={modelVerificationMessage}>{modelVerificationMessage}</span>
              {/if}
              <button class="secondary-button" type="button" disabled={providersStore.testingId !== null} onclick={() => void verifyModelEditorConnection()}>{providersStore.testingId === `${editor.id}:${modelEditorDraft.id}` ? session.text.onboardingProviderTesting : session.text.onboardingProviderTest}</button>
            </div>
          {/if}
          <button class="secondary-button" type="button" onclick={closeModelEditor}>{session.text.cancel}</button>
          <button class="primary-button" type="submit" disabled={!modelEditorDraft.id.trim()}>{session.text.save}</button>
        </footer>
      </form>
    </Dialog>
  {/if}

  {#if modelDiscoveryOpen}
    <Dialog open={true} contentClass="provider-model-discovery-dialog" labelledBy="provider-model-discovery-title" describedBy="provider-model-discovery-description" onOpenChange={(next) => { if (!next) modelDiscoveryOpen = false; }}>
      <header class="modal-head">
        <div>
          <strong id="provider-model-discovery-title">{session.text.providerModelDialogTitle.replace("{provider}", editor ? providerLabel(editor.name, editor.id) : "")}</strong>
          <p id="provider-model-discovery-description">{session.text.providerModelsAvailableHint.replace("{count}", String(providersStore.discoveredModels.length))}</p>
        </div>
        <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => (modelDiscoveryOpen = false)}><X size={16} aria-hidden="true" /></button>
      </header>
      <div class="modal-body provider-model-discovery-body">
        <div class="provider-discovery-toolbar">
          <SearchField value={modelDiscoveryQuery} label={session.text.modelSearchPlaceholder} placeholder={session.text.modelSearchPlaceholder} onInput={(value) => (modelDiscoveryQuery = value)} />
          <button class="provider-icon-button" type="button" disabled={providersStore.discovering} aria-label={session.text.providerModelRefresh} title={session.text.providerModelRefresh} onclick={() => void discoverProviderModels()}><Refresh class={providersStore.discovering ? "spin" : ""} size={14} aria-hidden="true" /></button>
        </div>
        <div class="provider-discovery-tabs" role="tablist" aria-label={session.text.providerModelsAvailableTitle} use:tablist>
          {#each [["all", session.text.providerModelFilterAll], ["new", session.text.providerModelFilterNew], ["added", session.text.providerModelFilterAdded]] as option (option[0])}
            <button type="button" role="tab" id={`provider-discovery-tab-${option[0]}`} aria-selected={modelDiscoveryFilter === option[0]} aria-controls="provider-discovery-panel" class="provider-discovery-tab" class:active={modelDiscoveryFilter === option[0]} onclick={() => (modelDiscoveryFilter = option[0] as "all" | "added" | "new")}>{option[1]}</button>
          {/each}
        </div>

        <div id="provider-discovery-panel" role="tabpanel" aria-labelledby={`provider-discovery-tab-${modelDiscoveryFilter}`}>
        {#if providersStore.discovering}
          <SkeletonRows count={5} />
        {:else if discoveryVisibleCount === 0}
          <EmptyState title={providersStore.discoveredModels.length === 0 ? session.text.providerModelPickEmpty : session.text.providerModelPickNoMatch} icon="magnifying-glass" />
        {:else}
          <div class="provider-model-groups">
            {#each discoveryGroups as group (group.name)}
              {@const pending = group.ids.filter((id) => !editModelIds.has(id))}
              <div class="provider-model-group">
                <div class="provider-model-group-head static">
                  <strong>{group.name}</strong>
                  <span class="provider-count">{group.ids.length}</span>
                  <button class="provider-icon-button" type="button" disabled={pending.length === 0} aria-label={session.text.providerModelGroupAddAll} title={session.text.providerModelGroupAddAll} onclick={() => addDiscoveredGroup(pending)}><Plus size={14} aria-hidden="true" /></button>
                </div>
                <div class="provider-model-rows">
                  {#each group.ids as id (id)}
                    {@const added = editModelIds.has(id)}
                    {@const info = providersStore.discoveredItems[id]}
                    <div class="provider-model-row" class:added>
                      <span class="provider-model-name">
                        {info?.alias || id}
                        {#if info?.alias}<small class="provider-model-alias-id" title={id}>{id}</small>{/if}
                      </span>
                      {#if info}
                        <span class="provider-model-caps">
                          {#each (info.tags ?? []) as tag (tag)}
                            {@const CapIcon = CAPABILITY_ICONS[tag]}
                            <span class="provider-cap" data-tag={tag} title={capabilityLabel(tag)}><CapIcon size={11} aria-hidden="true" /></span>
                          {/each}
                          {#if info.contextWindow}<span class="provider-model-context">{Math.round(info.contextWindow / 1000)}K</span>{/if}
                        </span>
                      {/if}
                      {#if added}
                        <span class="provider-model-added">{session.text.providerModelAdded}</span>
                        <button class="provider-icon-button danger-action" type="button" aria-label={`${session.text.providerModelRemove}: ${id}`} title={session.text.providerModelRemove} onclick={() => removeModelById(id)}><Minus size={14} aria-hidden="true" /></button>
                      {:else}
                        <button class="provider-icon-button accent" type="button" aria-label={`${session.text.providerAddModel}: ${id}`} title={session.text.providerAddModel} onclick={() => addDiscoveredModel(id)}><Plus size={14} aria-hidden="true" /></button>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
        </div>
      </div>
      <footer class="provider-modal-foot">
        <button class="primary-button" type="button" onclick={() => (modelDiscoveryOpen = false)}>{session.text.providerAuthClose}</button>
      </footer>
    </Dialog>
  {/if}

  {#if providersStore.actionMessage && !editor}
    <p class:run-history-failed={providersStore.actionFailed} class="settings-action-message" aria-live="polite">{providersStore.actionMessage}</p>
  {/if}
{/if}

{#if pendingSwitchProviderId}
  <AlertDialog open={true} contentClass="confirm-dialog" labelledBy="provider-switch-title" describedBy="provider-switch-description" onOpenChange={(next) => { if (!next) pendingSwitchProviderId = ""; }}>
    <h3 id="provider-switch-title">{session.text.providerSwitchUnsavedTitle}</h3>
    <p id="provider-switch-description">{session.text.providerSwitchUnsavedHint}</p>
    <div class="confirm-dialog-actions">
      <button class="secondary-button" type="button" onclick={() => (pendingSwitchProviderId = "")}>{session.text.cancel}</button>
      <button class="primary-button danger-button" type="button" onclick={resolvePendingSwitch}>{session.text.providerDiscard}</button>
    </div>
  </AlertDialog>
{/if}

{#if pendingDeleteProviderId}
  <AlertDialog open={Boolean(pendingDeleteProviderId)} busy={providersStore.saving} contentClass="confirm-dialog" labelledBy="provider-delete-title" describedBy="provider-delete-description" onOpenChange={(next) => { if (!next) pendingDeleteProviderId = ""; }}>
    <h3 id="provider-delete-title">{session.text.providerDelete}</h3>
    <p id="provider-delete-description">{session.text.providerDeleteConfirm}</p>
    <div class="confirm-dialog-actions">
      <button class="secondary-button" type="button" disabled={providersStore.saving} onclick={() => (pendingDeleteProviderId = "")}>{session.text.cancel}</button>
      <button class="primary-button danger-button" type="button" disabled={providersStore.saving} onclick={async () => { const providerId = pendingDeleteProviderId; await removeProvider(providerId); pendingDeleteProviderId = ""; selectedProviderId = ""; }}>{session.text.providerDelete}</button>
    </div>
  </AlertDialog>
{/if}

{#if providerAuthStore.active}
  {@const authSession = providerAuthStore.active}
  <Dialog open={true} contentClass="provider-auth-dialog" labelledBy="provider-auth-title" describedBy="provider-auth-description" onOpenChange={(next) => { if (!next) void closeProviderAuth(); }}>
    <header class="modal-head provider-auth-dialog-head">
      <div>
        <strong id="provider-auth-title">{providerAuthStore.providers.find((provider) => provider.id === authSession.providerId)?.loginLabel ?? session.text.providerAuthTitle}</strong>
        <p id="provider-auth-description">{session.text.providerAuthDialogHint}</p>
      </div>
      <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => void closeProviderAuth()}><X size={16} aria-hidden="true" /></button>
    </header>
    <div class="modal-body provider-auth-dialog-body">
      {#if authSession.state === "done"}
        <div class="provider-auth-terminal success"><i aria-hidden="true"><CheckCircle size={30} /></i><strong>{session.text.providerAuthDone}</strong></div>
      {:else if authSession.state === "failed"}
        <div class="provider-auth-terminal danger"><i aria-hidden="true"><TriangleWarning size={30} /></i><strong>{session.text.providerAuthFailed}</strong><span>{authSession.error ?? providerAuthStore.error}</span></div>
      {:else if authSession.state === "cancelled"}
        <div class="provider-auth-terminal"><i aria-hidden="true"><XCircle size={30} /></i><strong>{session.text.providerAuthCancelled}</strong></div>
      {:else if authSession.state === "expired"}
        <div class="provider-auth-terminal danger"><i aria-hidden="true"><Timer size={30} /></i><strong>{session.text.providerAuthExpired}</strong></div>
      {:else}
        <div class="provider-auth-progress-head"><span class="provider-auth-pulse" aria-hidden="true"></span><strong>{session.text.providerAuthWaiting}</strong></div>

        {#if authSession.authUrl}
          <section class="provider-auth-step">
            <div><i aria-hidden="true"><Globe size={15} /></i><span>{authSession.authUrl.instructions ?? session.text.providerAuthOpenBrowser}</span></div>
            <button class="primary-button" type="button" onclick={() => void openProviderAuthUrl(authSession.authUrl!.url)}>{session.text.providerAuthOpenBrowser}<SquareArrowUp size={13} aria-hidden="true" /></button>
          </section>
        {/if}

        {#if authSession.deviceCode}
          <section class="provider-auth-device">
            <span>{session.text.providerAuthDeviceCode}</span>
            <code>{authSession.deviceCode.userCode}</code>
            <div>
              <button class="secondary-button" type="button" onclick={() => void copyProviderAuthCode(authSession.deviceCode!.userCode)}>{authCopiedCode === authSession.deviceCode.userCode ? session.text.providerAuthCodeCopied : session.text.providerAuthCopyCode}</button>
              <button class="primary-button" type="button" onclick={() => void openProviderAuthUrl(authSession.deviceCode!.verificationUri)}>{session.text.providerAuthOpenBrowser}<SquareArrowUp size={13} aria-hidden="true" /></button>
            </div>
          </section>
        {/if}

        {#if authSession.prompt}
          <section class="provider-auth-prompt">
            <strong>{authSession.prompt.message}</strong>
            {#if authSession.prompt.type === "select"}
              <div class="provider-auth-options">
                {#each authSession.prompt.options ?? [] as option (option.id)}
                  <button class="provider-auth-option" type="button" disabled={Boolean(providerAuthStore.actionProviderId)} onclick={() => void submitProviderAuthAnswer(option.id)}><span>{option.label}</span>{#if option.description}<small>{option.description}</small>{/if}<CaretRight size={14} aria-hidden="true" /></button>
                {/each}
              </div>
            {:else}
              <form class="provider-auth-answer" onsubmit={(event) => { event.preventDefault(); void submitProviderAuthAnswer(); }}>
                <input type={authSession.prompt.type === "secret" ? "password" : "text"} bind:value={providerAuthStore.answer} aria-label={authSession.prompt.message || session.text.providerAuthAnswerPlaceholder} placeholder={authSession.prompt.placeholder ?? session.text.providerAuthAnswerPlaceholder} autocomplete="off" spellcheck="false" />
                <button class="primary-button" type="submit" disabled={Boolean(providerAuthStore.actionProviderId) || (authSession.prompt.type !== "text" && !providerAuthStore.answer.trim())}>{session.text.providerAuthContinue}</button>
              </form>
            {/if}
          </section>
        {/if}

        {#if authSession.messages.length > 0}
          <div class="provider-auth-messages" aria-live="polite">
            {#each authSession.messages.slice(-4) as message (message.id)}
              <p>{message.message}</p>
            {/each}
          </div>
        {/if}
      {/if}
      {#if providerAuthStore.error}<p class="settings-action-message run-history-failed" aria-live="polite">{providerAuthStore.error}</p>{/if}
    </div>
    <footer class="provider-auth-dialog-foot">
      <button class="secondary-button" type="button" onclick={() => void closeProviderAuth()}>{providerAuthIsTerminal(authSession.state) ? session.text.providerAuthClose : session.text.cancel}</button>
    </footer>
  </Dialog>
{/if}

{#if providersStore.globalsDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={providersStore.saving} onclick={() => void saveProviderGlobals()}>{providersStore.saving ? session.text.onboardingProviderSaving : session.text.providerSaveGlobal}</button>
    </div>
  </footer>
{/if}
