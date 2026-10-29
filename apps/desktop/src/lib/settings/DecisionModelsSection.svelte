<script lang="ts">
  import Play from "reicon-svelte/icons/Play";
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import ChevronDown from "reicon-svelte/icons/ChevronDown";
  import Code from "reicon-svelte/icons/Code";
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import Plus from "reicon-svelte/icons/Plus";
  import Trash from "reicon-svelte/icons/Trash";
  import { onDestroy } from "svelte";
  import type { DesktopModelOption } from "@molibot/desktop-contract";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import ProviderAvatar from "../components/ui/ProviderAvatar.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { session, notifySettingsChanged } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    loadDesktopAdaptiveThinkingSettings,
    loadDesktopModels,
    saveDesktopAdaptiveThinkingSettings,
    testDesktopDecisionModelCase,
    type DecisionTestMode,
    type DecisionTestResult,
    type DesktopAdaptiveThinkingSettings,
    type DesktopDecisionModelSettings
  } from "../api";

  type ThinkingLevel = "low" | "medium" | "high";
  type Strategy = "fixed" | "auto";
  type DecisionModelProvider = "jev" | "llm" | "cloudflare" | "siliconflow" | "custom-jev";

  let edit = $state<DesktopAdaptiveThinkingSettings | null>(null);
  let saved = $state<DesktopAdaptiveThinkingSettings | null>(null);
  let modelOptions = $state<DesktopModelOption[]>([]);
  let apiKeys = $state<Record<string, string>>({});
  let clearApiKeys = $state<string[]>([]);
  let showApiKeys = $state<Record<string, boolean>>({});
  let addOpen = $state(false);
  let openModelId = $state("");
  let removing = $state<DesktopDecisionModelSettings | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let testingProvider = $state<string>("");
  let testingCase = $state<DecisionTestMode | "">("");
  let testResults = $state<Record<string, Partial<Record<DecisionTestMode, DecisionTestResult>>>>({});
  let testFailures = $state<Record<string, Partial<Record<DecisionTestMode, string>>>>({});
  let loadedEndpoint = $state("");
  let message = $state("");
  let failure = $state("");

  const dirty = $derived(Boolean(edit && saved && (
    JSON.stringify(edit) !== JSON.stringify(saved)
    || Object.values(apiKeys).some((value) => value.trim())
    || clearApiKeys.length > 0
  )));
  const autoCanBeSelected = $derived(Boolean(edit && isAutoAvailable(edit)));
  const builtInSiliconFlowId = $derived(edit?.decisionModels.find((model) => model.provider === "siliconflow")?.id ?? "siliconflow");
  const selectedModel = $derived(edit?.decisionModels.find((model) => model.id === edit?.selectedDecisionModelId) ?? null);
  const addableProviders = $derived(([
    { value: "cloudflare" as const, label: session.text.decisionModelsCloudflare, hint: session.text.decisionModelsCloudflareHint },
    { value: "siliconflow" as const, label: session.text.decisionModelsSiliconFlow, hint: session.text.decisionModelsSiliconFlowHint },
    { value: "custom-jev" as const, label: session.text.decisionModelsCustomJev, hint: session.text.decisionModelsCustomJevHint }
  ]).filter((option) => option.value !== "cloudflare" || !edit?.decisionModels.some((model) => model.provider === option.value)));

  function providerLabel(provider: DecisionModelProvider): string {
    if (provider === "jev") return session.text.decisionModelsJev;
    if (provider === "cloudflare") return session.text.decisionModelsCloudflare;
    if (provider === "siliconflow") return session.text.decisionModelsSiliconFlow;
    if (provider === "custom-jev") return session.text.decisionModelsCustomJev;
    return session.text.decisionModelsLlm;
  }

  function displayName(model: DesktopDecisionModelSettings): string {
    return model.provider === "custom-jev" ? model.name || providerLabel(model.provider) : providerLabel(model.provider);
  }

  function providerId(model: DesktopDecisionModelSettings): string {
    if (model.provider === "cloudflare") return "cloudflare";
    if (model.provider === "siliconflow") return "siliconflow";
    if (model.provider === "custom-jev") return model.id;
    if (model.provider === "llm") return "llm";
    return "jev";
  }

  function testModeLabel(mode: DecisionTestMode): string {
    if (mode === "noul") return session.text.decisionModelsTestNoul;
    if (mode === "choice") return session.text.decisionModelsTestChoice;
    return session.text.decisionModelsTestScore;
  }

  function levelLabel(level: ThinkingLevel): string {
    return { low: session.text.thinkingLow, medium: session.text.thinkingMedium, high: session.text.thinkingHigh }[level];
  }

  function modelSummary(model: DesktopDecisionModelSettings, options: DesktopModelOption[]): string {
    if (model.provider === "jev") return model.baseUrl || session.text.modelUnconfigured;
    if (model.provider === "cloudflare") return model.accountId || session.text.modelUnconfigured;
    if (model.provider === "siliconflow") return model.modelId || session.text.modelUnconfigured;
    if (model.provider === "custom-jev") return model.modelId || session.text.modelUnconfigured;
    const option = options.find((item) => item.key === model.llmModelKey);
    return option?.alias || option?.label || session.text.modelUnconfigured;
  }

  function modelIsReady(model: DesktopDecisionModelSettings): boolean {
    if (!edit || !saved || model.enabled === false) return false;
    const savedModel = saved.decisionModels.find((item) => item.id === model.id);
    if (model.provider === "jev") {
      if (clearApiKeys.includes(model.id)) return false;
      const hasCurrentKey = model.hasApiKey && savedModel?.provider === "jev"
        && model.baseUrl.trim() === savedModel.baseUrl.trim();
      return Boolean(model.baseUrl.trim() && (apiKeys[model.id]?.trim() || hasCurrentKey));
    }
    if (model.provider === "cloudflare") {
      if (clearApiKeys.includes(model.id)) return false;
      const hasCurrentToken = model.hasApiToken && savedModel?.provider === "cloudflare"
        && model.accountId.trim() === savedModel.accountId.trim();
      return Boolean(model.accountId.trim() && !/[/?#]/.test(model.accountId) && (apiKeys[model.id]?.trim() || hasCurrentToken));
    }
    if (model.provider === "siliconflow" || model.provider === "custom-jev") {
      if (clearApiKeys.includes(model.id)) return false;
      const hasCurrentKey = model.hasApiKey && savedModel?.provider === model.provider
        && model.baseUrl.trim() === savedModel.baseUrl.trim();
      return Boolean(model.baseUrl.trim() && model.modelId.trim() && (apiKeys[model.id]?.trim() || hasCurrentKey));
    }
    return Boolean(
      model.llmModelKey
      && modelOptions.some((option) => option.key === model.llmModelKey)
      && edit.availableDecisionModelIds.includes(model.id)
      && savedModel?.provider === "llm"
      && savedModel.llmModelKey === model.llmModelKey
    );
  }

  function isAutoAvailable(value: DesktopAdaptiveThinkingSettings): boolean {
    if (!saved || !value.enabled || !value.selectedDecisionModelId) return false;
    const model = value.decisionModels.find((item) => item.id === value.selectedDecisionModelId);
    if (!model) return false;
    return modelIsReady(model);
  }

  function copyConfig(value: DesktopAdaptiveThinkingSettings): DesktopAdaptiveThinkingSettings {
    return {
      ...value,
      decisionModels: value.decisionModels.map((model) => ({ ...model })),
      availableDecisionModelIds: [...value.availableDecisionModelIds]
    };
  }

  function levelOptions(): { value: ThinkingLevel; label: string }[] {
    return [
      { value: "low", label: session.text.thinkingLow },
      { value: "medium", label: session.text.thinkingMedium },
      { value: "high", label: session.text.thinkingHigh }
    ];
  }

  $effect(() => {
    if (!session.serviceReady || !session.endpoint || session.endpoint === loadedEndpoint) return;
    loadedEndpoint = session.endpoint;
    loading = true;
    failure = "";
    Promise.all([
      loadDesktopAdaptiveThinkingSettings(session.endpoint),
      loadDesktopModels(session.endpoint, "text")
    ])
      .then(([value, models]) => {
        edit = copyConfig(value);
        saved = copyConfig(value);
        modelOptions = models.options;
        openModelId = "";
        apiKeys = {};
        clearApiKeys = [];
        showApiKeys = {};
        addOpen = false;
        message = "";
        testResults = {};
        testFailures = {};
      })
      .catch((cause) => {
        failure = cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => (loading = false));
  });

  function reset(): void {
    if (!saved) return;
    edit = copyConfig(saved);
    openModelId = "";
    apiKeys = {};
    clearApiKeys = [];
    showApiKeys = {};
    addOpen = false;
    message = "";
    failure = "";
    testResults = {};
    testFailures = {};
  }

  function updateEdit(patch: Partial<DesktopAdaptiveThinkingSettings>): void {
    if (!edit) return;
    edit = { ...edit, ...patch };
  }

  function updateModel(id: string, patch: Partial<DesktopDecisionModelSettings>): void {
    if (!edit) return;
    const decisionModels = edit.decisionModels.map((model) => model.id === id ? { ...model, ...patch } as DesktopDecisionModelSettings : model);
    updateEdit({ decisionModels });
    testResults = { ...testResults, [id]: {} };
    testFailures = { ...testFailures, [id]: {} };
  }

  function selectDecisionModel(id: string): void {
    updateEdit({ selectedDecisionModelId: id });
    openModelId = id;
  }

  function updateApiKey(id: string, value: string): void {
    apiKeys = { ...apiKeys, [id]: value };
    testResults = { ...testResults, [id]: {} };
    testFailures = { ...testFailures, [id]: {} };
  }

  function addModel(provider: Exclude<DecisionModelProvider, "jev" | "llm">): void {
    if (!edit || (provider === "cloudflare" && edit.decisionModels.some((model) => model.provider === provider))) return;
    let newId = provider === "custom-jev" ? "custom-jev-1" : "siliconflow-2";
    if (provider === "siliconflow" || provider === "custom-jev") {
      let sequence = provider === "custom-jev" ? 1 : 2;
      const prefix = provider === "custom-jev" ? "custom-jev" : "siliconflow";
      while (edit.decisionModels.some((model) => model.id === newId)) newId = `${prefix}-${++sequence}`;
    }
    const model: DesktopDecisionModelSettings = provider === "cloudflare"
      ? { id: "cloudflare-jev", provider: "cloudflare", enabled: false, accountId: "", hasApiToken: false }
      : provider === "siliconflow"
        ? { id: newId, provider: "siliconflow", enabled: false, baseUrl: "https://api.siliconflow.cn", modelId: "", hasApiKey: false }
        : { id: newId, provider: "custom-jev", enabled: false, name: "", baseUrl: "", modelId: "", hasApiKey: false };
    updateEdit({
      decisionModels: [...edit.decisionModels, model],
      selectedDecisionModelId: edit.selectedDecisionModelId || model.id
    });
    openModelId = model.id;
    addOpen = false;
  }

  function removeModel(id: string): void {
    if (!edit || ["jev", "llm", builtInSiliconFlowId].includes(id)) return;
    const decisionModels = edit.decisionModels.filter((model) => model.id !== id);
    const selectedDecisionModelId = edit.selectedDecisionModelId === id
      ? (decisionModels.find((model) => model.enabled !== false) ?? decisionModels[0])?.id ?? ""
      : edit.selectedDecisionModelId;
    if (id in apiKeys) {
      const next = { ...apiKeys };
      delete next[id];
      apiKeys = next;
    }
    clearApiKeys = clearApiKeys.filter((item) => item !== id);
    if (openModelId === id) openModelId = decisionModels[0]?.id ?? "";
    testResults = { ...testResults, [id]: {} };
    testFailures = { ...testFailures, [id]: {} };
    updateEdit({ decisionModels, selectedDecisionModelId });
    removing = null;
  }

  function toggleClearApiKey(id: string, checked: boolean): void {
    clearApiKeys = checked
      ? [...new Set([...clearApiKeys, id])]
      : clearApiKeys.filter((item) => item !== id);
    updateEdit({});
    testResults = { ...testResults, [id]: {} };
    testFailures = { ...testFailures, [id]: {} };
  }

  function canTestCase(model: DesktopDecisionModelSettings): boolean {
    if (model.provider === "jev") {
      const savedModel = saved?.decisionModels.find((item) => item.id === model.id);
      const hasSavedKey = model.hasApiKey && savedModel?.provider === "jev"
        && model.baseUrl.trim() === savedModel.baseUrl.trim()
        && !clearApiKeys.includes(model.id);
      return Boolean(model.baseUrl.trim() && (apiKeys.jev?.trim() || hasSavedKey));
    }
    if (model.provider === "cloudflare") {
      const savedModel = saved?.decisionModels.find((item) => item.id === model.id);
      const hasSavedToken = model.hasApiToken && savedModel?.provider === "cloudflare"
        && model.accountId.trim() === savedModel.accountId.trim()
        && !clearApiKeys.includes(model.id);
      return Boolean(model.accountId.trim() && (apiKeys[model.id]?.trim() || hasSavedToken));
    }
    if (model.provider === "siliconflow" || model.provider === "custom-jev") {
      const savedModel = saved?.decisionModels.find((item) => item.id === model.id);
      const hasSavedKey = model.hasApiKey && savedModel?.provider === model.provider
        && model.baseUrl.trim() === savedModel.baseUrl.trim()
        && savedModel.modelId === model.modelId
        && !clearApiKeys.includes(model.id);
      return Boolean(model.baseUrl.trim() && model.modelId.trim() && (apiKeys[model.id]?.trim() || hasSavedKey));
    }
    return Boolean(model.llmModelKey);
  }

  async function runTestCase(model: DesktopDecisionModelSettings, testCaseId: DecisionTestMode): Promise<void> {
    if (!edit || !session.endpoint || testingProvider) return;
    if (!canTestCase(model)) return;
    testingProvider = model.id;
    testingCase = testCaseId;
    message = "";
    failure = "";
    testResults = { ...testResults, [model.id]: { ...testResults[model.id], [testCaseId]: undefined } };
    testFailures = { ...testFailures, [model.id]: { ...testFailures[model.id], [testCaseId]: "" } };
    try {
      const result = await testDesktopDecisionModelCase(
        session.endpoint,
        {
          provider: model.provider,
          baseUrl: model.provider === "jev" || model.provider === "siliconflow" || model.provider === "custom-jev" ? model.baseUrl : undefined,
          apiKey: model.provider === "llm" ? undefined : apiKeys[model.id] ?? "",
          accountId: model.provider === "cloudflare" ? model.accountId : undefined,
          llmModelKey: model.provider === "llm" ? model.llmModelKey : undefined,
          modelId: model.provider === "siliconflow" || model.provider === "custom-jev" ? model.modelId : undefined,
          decisionModelId: model.id,
          testCaseId
        }
      );
      testResults = { ...testResults, [model.id]: { ...testResults[model.id], [testCaseId]: result } };
    } catch (cause) {
      testFailures = { ...testFailures, [model.id]: { ...testFailures[model.id], [testCaseId]: cause instanceof Error ? cause.message : String(cause) } };
    } finally {
      testingProvider = "";
      testingCase = "";
    }
  }

  async function save(): Promise<void> {
    if (!edit || !session.endpoint || saving) return;
    saving = true;
    message = "";
    failure = "";
    try {
      const result = await saveDesktopAdaptiveThinkingSettings(
        session.endpoint,
        edit,
        apiKeys,
        clearApiKeys
      );
      edit = copyConfig(result);
      saved = copyConfig(result);
      apiKeys = {};
      clearApiKeys = [];
      showApiKeys = {};
      message = session.text.decisionModelsSaved;
      notifySettingsChanged();
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  const policySummary = $derived.by(() => {
    if (!edit) return "";
    if (!edit.enabled || edit.defaultStrategy === "fixed") return session.text.decisionModelsPreviewFixed;
    return session.text.decisionModelsPreviewAuto
      .replace("{model}", selectedModel ? displayName(selectedModel) : session.text.decisionModelsNoSelection)
      .replace("{ceiling}", levelLabel(edit.maxThinkingLevel))
      .replace("{fallback}", levelLabel(edit.fallbackThinkingLevel));
  });

  onDestroy(trackUnsaved(() => dirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.decisionModelsUnavailable} icon="cpu" /></SettingGroup>
{:else if loading || !edit}
  <SettingGroup><SkeletonRows count={4} label={session.text.loading} /></SettingGroup>
{:else}
  <div class="decision-page">
    <section class="decision-overview" class:is-off={!edit.enabled} aria-label={session.text.decisionModelsKicker}>
      <div class="decision-overview-main">
        <span class="decision-kicker">{session.text.decisionModelsKicker}</span>
        <div class="decision-overview-title">
          <strong>{edit.enabled ? session.text.decisionModelsOnTitle : session.text.decisionModelsOffTitle}</strong>
          <span class="decision-state" data-state={edit.enabled ? "on" : "off"}><i aria-hidden="true"></i>{edit.enabled ? session.text.decisionModelsStateOn : session.text.decisionModelsStateOff}</span>
        </div>
        <p class="decision-overview-sub">{!edit.enabled ? session.text.decisionModelsOffHint : edit.defaultStrategy === "auto" ? session.text.decisionModelsOnHint : session.text.decisionModelsOnFixedHint}</p>
        <div class="decision-facts">
          <span><b>{session.text.decisionModelsModelFact}</b><em>{selectedModel ? displayName(selectedModel) : session.text.decisionModelsNoSelection}</em></span>
          <span><b>{session.text.adaptiveThinkingDefaultStrategy}</b><em>{edit.defaultStrategy === "auto" ? session.text.decisionModelsStrategyAutoShort : session.text.decisionModelsStrategyFixedShort}</em></span>
          <span><b>{session.text.adaptiveThinkingCeiling}</b><em>{levelLabel(edit.maxThinkingLevel)}</em></span>
          <span><b>{session.text.decisionModelsFallbackFact}</b><em>{levelLabel(edit.fallbackThinkingLevel)}</em></span>
        </div>
      </div>
      <div class="decision-overview-control">
        <span>{session.text.decisionModelsEnabled}</span>
        <IosSwitch checked={edit.enabled} ariaLabel={session.text.decisionModelsEnabled} onCheckedChange={(checked) => updateEdit({ enabled: checked })} />
      </div>
    </section>

    <SettingGroup title={session.text.decisionModelsList} description={session.text.decisionModelsListHint}>
      <svelte:fragment slot="action">
        <span class="decision-count">{String(edit.decisionModels.length).padStart(2, "0")}</span>
      </svelte:fragment>

      <div class="decision-models">
        {#each edit.decisionModels as model (model.id)}
          {@const isActive = model.id === edit.selectedDecisionModelId}
          {@const open = openModelId === model.id}
          {@const ready = modelIsReady(model)}
          <article class="decision-model" class:is-active={isActive} class:is-disabled={model.enabled === false} class:is-open={open}>
            {#if isActive}<span class="decision-model-rail" aria-hidden="true"></span>{/if}
            <header class="decision-model-head">
              <button class="decision-model-trigger" type="button" aria-expanded={open} onclick={() => (openModelId = open ? "" : model.id)}>
                <ProviderAvatar id={providerId(model)} name={displayName(model)} size="sm" />
                <span class="decision-model-identity">
                  <span class="decision-model-name">
                    <strong>{displayName(model)}</strong>
                    {#if isActive}<span class="decision-pill is-active">{session.text.decisionModelsSelectedForAuto}</span>{/if}
                    {#if model.enabled === false}<span class="decision-pill">{session.text.decisionModelsDisabled}</span>{/if}
                  </span>
                  <small>{modelSummary(model, modelOptions)}</small>
                </span>
                <span class="decision-model-caret"><ChevronDown size={16} aria-hidden="true" /></span>
              </button>
              <div class="decision-model-actions">
                {#if !isActive && model.enabled !== false}
                  <button class="decision-use" type="button" disabled={saving || !ready} title={ready ? session.text.decisionModelsUseForAuto : session.text.decisionModelsUseUnavailable} onclick={() => selectDecisionModel(model.id)}>
                    {session.text.decisionModelsUseForAuto}
                  </button>
                {/if}
                <IosSwitch checked={model.enabled !== false} ariaLabel={`${displayName(model)} · ${session.text.decisionModelsModelEnabled}`} onCheckedChange={(checked) => { updateModel(model.id, { enabled: checked }); if (checked) openModelId = model.id; }} />
              </div>
            </header>

            {#if open}
              <div class="decision-model-body">
                <div class="decision-model-body-head">
                  <span>{session.text.decisionModelsConnection}</span>
                  {#if !["jev", "llm", builtInSiliconFlowId].includes(model.id)}
                    <button class="decision-remove" type="button" disabled={saving || testingProvider !== ""} onclick={() => (removing = model)}>
                      <Trash size={13} aria-hidden="true" />{session.text.decisionModelsRemove}
                    </button>
                  {/if}
                </div>

                <div class="settings-form decision-form">
                  {#if model.provider === "jev"}
                    <label class="settings-field">
                      <span>{session.text.decisionModelsHost}</span>
                      <input value={model.baseUrl} oninput={(event) => updateModel(model.id, { baseUrl: event.currentTarget.value })} autocomplete="off" spellcheck="false" />
                      <small>{session.text.decisionModelsHostHint}</small>
                    </label>
                    <label class="settings-field">
                      <span>{session.text.decisionModelsApiKey}</span>
                      <div class="secret-input">
                        <input type={showApiKeys[model.id] ? "text" : "password"} value={apiKeys[model.id] ?? ""} oninput={(event) => updateApiKey(model.id, event.currentTarget.value)} placeholder={model.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" />
                        <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={() => (showApiKeys = { ...showApiKeys, [model.id]: !showApiKeys[model.id] })}>
                          {#if showApiKeys[model.id]}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
                        </button>
                      </div>
                      <small>{session.text.decisionModelsApiKeyHint}</small>
                      {#if model.hasApiKey}
                        <label class="inline-check"><input type="checkbox" checked={clearApiKeys.includes(model.id)} onchange={(event) => toggleClearApiKey(model.id, event.currentTarget.checked)} />{session.text.channelClearSecret}</label>
                      {/if}
                    </label>
                  {:else if model.provider === "cloudflare"}
                    <label class="settings-field">
                      <span>{session.text.decisionModelsCloudflareAccountId}</span>
                      <input value={model.accountId} oninput={(event) => updateModel(model.id, { accountId: event.currentTarget.value })} autocomplete="off" spellcheck="false" />
                      <small>{session.text.decisionModelsCloudflareAccountIdHint}</small>
                    </label>
                    <label class="settings-field">
                      <span>{session.text.decisionModelsApiToken}</span>
                      <div class="secret-input">
                        <input type={showApiKeys[model.id] ? "text" : "password"} value={apiKeys[model.id] ?? ""} oninput={(event) => updateApiKey(model.id, event.currentTarget.value)} placeholder={model.hasApiToken ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" />
                        <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={() => (showApiKeys = { ...showApiKeys, [model.id]: !showApiKeys[model.id] })}>
                          {#if showApiKeys[model.id]}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
                        </button>
                      </div>
                      <small>{session.text.decisionModelsApiTokenHint}</small>
                      {#if model.hasApiToken}
                        <label class="inline-check"><input type="checkbox" checked={clearApiKeys.includes(model.id)} onchange={(event) => toggleClearApiKey(model.id, event.currentTarget.checked)} />{session.text.channelClearSecret}</label>
                      {/if}
                    </label>
                  {:else if model.provider === "siliconflow" || model.provider === "custom-jev"}
                    {#if model.provider === "custom-jev"}
                      <label class="settings-field">
                        <span>{session.text.decisionModelsCustomName}</span>
                        <input value={model.name} oninput={(event) => updateModel(model.id, { name: event.currentTarget.value })} autocomplete="off" />
                      </label>
                    {/if}
                    <label class="settings-field">
                      <span>{model.provider === "custom-jev" ? session.text.decisionModelsHost : session.text.decisionModelsSiliconFlowHost}</span>
                      <input value={model.baseUrl} oninput={(event) => updateModel(model.id, { baseUrl: event.currentTarget.value })} placeholder={model.provider === "custom-jev" ? "https://example.com" : "https://api.siliconflow.cn"} autocomplete="off" spellcheck="false" />
                      <small>{model.provider === "custom-jev" ? session.text.decisionModelsCustomHostHint : session.text.decisionModelsSiliconFlowHostHint}</small>
                    </label>
                    <label class="settings-field">
                      <span>{session.text.decisionModelsSiliconFlowModelId}</span>
                      <input value={model.modelId} oninput={(event) => updateModel(model.id, { modelId: event.currentTarget.value })} placeholder="Qwen/..." autocomplete="off" spellcheck="false" />
                      <small>{model.provider === "custom-jev" ? session.text.decisionModelsCustomModelHint : session.text.decisionModelsSiliconFlowModelIdHint}</small>
                    </label>
                    <label class="settings-field settings-field-wide">
                      <span>{model.provider === "custom-jev" ? session.text.decisionModelsApiKey : session.text.decisionModelsSiliconFlowApiKey}</span>
                      <div class="secret-input">
                        <input type={showApiKeys[model.id] ? "text" : "password"} value={apiKeys[model.id] ?? ""} oninput={(event) => updateApiKey(model.id, event.currentTarget.value)} placeholder={model.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" />
                        <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={() => (showApiKeys = { ...showApiKeys, [model.id]: !showApiKeys[model.id] })}>
                          {#if showApiKeys[model.id]}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
                        </button>
                      </div>
                      <small>{model.provider === "custom-jev" ? session.text.decisionModelsApiKeyHint : session.text.decisionModelsSiliconFlowApiKeyHint}</small>
                      {#if model.hasApiKey}
                        <label class="inline-check"><input type="checkbox" checked={clearApiKeys.includes(model.id)} onchange={(event) => toggleClearApiKey(model.id, event.currentTarget.checked)} />{session.text.channelClearSecret}</label>
                      {/if}
                    </label>
                  {:else}
                    <label class="settings-field settings-field-wide"><span>{session.text.decisionModelsLlmModel}</span>
                      <SelectControl value={model.llmModelKey} ariaLabel={session.text.decisionModelsLlmModel} options={[{ value: "", label: session.text.modelUnconfigured }, ...modelOptions.map((option) => ({ value: option.key, label: option.alias || option.label }))]} onChange={(value) => updateModel(model.id, { llmModelKey: value })} />
                      <small>{session.text.decisionModelsLlmModelHint}</small>
                    </label>
                  {/if}
                </div>

                <div class="decision-evaluation">
                  <div class="decision-evaluation-head">
                    <span>{session.text.decisionModelsEvaluation}</span>
                    <small>{session.text.decisionModelsEvaluationHint}</small>
                  </div>
                  <div class="decision-evaluation-actions">
                    {#each ["noul", "choice", "score"] as mode (mode)}
                      <button class="decision-test" type="button" title={session.text.decisionModelsTestCasesHint} disabled={testingProvider !== "" || saving || !canTestCase(model)} onclick={() => void runTestCase(model, mode as DecisionTestMode)}>
                        <Play size={13} aria-hidden="true" />
                        {testingProvider === model.id && testingCase === mode ? session.text.decisionModelsTesting : testModeLabel(mode as DecisionTestMode)}
                      </button>
                    {/each}
                  </div>
                  <p class="decision-eval-note">{session.text.decisionModelsTestCasesHint}</p>
                  {#each ["noul", "choice", "score"] as mode (mode)}
                    {#if testFailures[model.id]?.[mode as DecisionTestMode]}
                      <p class="decision-test-error" role="alert"><i aria-hidden="true"></i>{testModeLabel(mode as DecisionTestMode)} · {testFailures[model.id][mode as DecisionTestMode]}</p>
                    {/if}
                    {#if testResults[model.id]?.[mode as DecisionTestMode]}
                      {@const result = testResults[model.id][mode as DecisionTestMode]!}
                      <details class="decision-test-result">
                        <summary>
                          <span class="decision-ok" aria-hidden="true"></span>
                          <span>{session.text.decisionModelsTestSuccess} · {testModeLabel(result.testCase.id)}</span>
                          <code>{result.model}</code>
                          <span class="decision-result-caret"><AngleDown size={13} aria-hidden="true" /></span>
                        </summary>
                        <div class="decision-test-detail">
                          <span>{session.text.decisionModelsTestInput}</span>
                          <pre>{JSON.stringify({ state: result.testCase.state, questions: result.testCase.questions }, null, 2)}</pre>
                          <span>{session.text.decisionModelsTestOutput}</span>
                          <pre>{JSON.stringify({ answers: result.answers }, null, 2)}</pre>
                        </div>
                      </details>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>

      <div class="decision-add">
        {#if !addOpen}
          <button class="decision-add-trigger" type="button" onclick={() => (addOpen = true)} disabled={addableProviders.length === 0 || saving}>
            <span class="decision-add-icon"><Plus size={14} aria-hidden="true" /></span>
            <span>
              <strong>{session.text.decisionModelsAdd}</strong>
              <small>{addableProviders.length > 0 ? session.text.decisionModelsAddHint : session.text.decisionModelsAddEmpty}</small>
            </span>
          </button>
        {:else}
          <div class="decision-add-panel">
            <div class="decision-add-head">
              <span>{session.text.decisionModelsAdd}</span>
              <button class="decision-add-close" type="button" aria-label={session.text.decisionModelsClose} onclick={() => (addOpen = false)}>×</button>
            </div>
            <div class="decision-add-options">
              {#each addableProviders as option (option.value)}
                <button class="decision-add-option" type="button" onclick={() => addModel(option.value)}>
                  {#if option.value === "custom-jev"}
                    <span class="decision-add-glyph" aria-hidden="true"><Code size={15} /></span>
                  {:else}
                    <ProviderAvatar id={option.value} name={option.label} size="sm" />
                  {/if}
                  <span class="decision-add-copy">
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </span>
                  <span class="decision-add-plus"><Plus size={14} aria-hidden="true" /></span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      {#if edit.enabled && !autoCanBeSelected}
        <p class="decision-inline-warning" role="status"><i aria-hidden="true"></i>{session.text.providerThinkingAutoUnavailable}</p>
      {/if}
    </SettingGroup>

    <SettingGroup title={session.text.decisionModelsPolicy} description={session.text.decisionModelsPolicyHint}>
      <div class="decision-strategy">
        <div class="decision-strategy-copy">
          <strong>{session.text.adaptiveThinkingDefaultStrategy}</strong>
          <p>{session.text.adaptiveThinkingDefaultStrategyHint}</p>
        </div>
        <div class="segmented decision-segmented" role="tablist" aria-label={session.text.adaptiveThinkingDefaultStrategy}>
          <button
            type="button"
            role="tab"
            aria-selected={edit.defaultStrategy === "fixed"}
            class="segmented-item"
            class:active={edit.defaultStrategy === "fixed"}
            onclick={() => updateEdit({ defaultStrategy: "fixed" })}
          >{session.text.adaptiveThinkingFixed}</button>
          <button
            type="button"
            role="tab"
            aria-selected={edit.defaultStrategy === "auto"}
            class="segmented-item"
            class:active={edit.defaultStrategy === "auto"}
            disabled={!autoCanBeSelected}
            onclick={() => updateEdit({ defaultStrategy: "auto" })}
          >{session.text.adaptiveThinkingAuto}</button>
        </div>
      </div>

      <div class="decision-policy-preview">
        <span>{session.text.decisionModelsPolicyPreview}</span>
        <p>{policySummary}</p>
      </div>

      <div class="decision-policy-grid">
        <label class="decision-policy-field">
          <span>{session.text.adaptiveThinkingCeiling}</span>
          <SelectControl value={edit.maxThinkingLevel} ariaLabel={session.text.adaptiveThinkingCeiling} options={levelOptions()} onChange={(value) => updateEdit({ maxThinkingLevel: value as ThinkingLevel })} />
          <small>{session.text.adaptiveThinkingCeilingHint}</small>
        </label>
        <label class="decision-policy-field">
          <span>{session.text.adaptiveThinkingFallback}</span>
          <SelectControl value={edit.fallbackThinkingLevel} ariaLabel={session.text.adaptiveThinkingFallback} options={levelOptions()} onChange={(value) => updateEdit({ fallbackThinkingLevel: value as ThinkingLevel })} />
          <small>{session.text.adaptiveThinkingFallbackHint}</small>
        </label>
        <label class="decision-policy-field">
          <span>{session.text.adaptiveThinkingThreshold}</span>
          <input type="number" min="0" max="1" step="0.01" bind:value={edit.confidenceThreshold} />
          <small>{session.text.adaptiveThinkingThresholdHint}</small>
        </label>
        <label class="decision-policy-field">
          <span>{session.text.adaptiveThinkingTimeout}</span>
          <input type="number" min="100" max="5000" step="100" bind:value={edit.timeoutMs} />
          <small>{session.text.decisionModelsTimeoutHint}</small>
        </label>
      </div>
    </SettingGroup>

    {#if failure}<p class="settings-action-message error-message" role="alert">{failure}</p>{/if}
    {#if message}<p class="settings-action-message" aria-live="polite">{message}</p>{/if}
  </div>
{/if}

{#if removing}
  <AlertDialog open={true} contentClass="modal-card" labelledBy="decision-remove-title" describedBy="decision-remove-description" onOpenChange={(next) => { if (!next) removing = null; }}>
    <header class="modal-head"><strong id="decision-remove-title">{session.text.decisionModelsRemove}</strong></header>
    <div class="modal-body">
      <p id="decision-remove-description"><strong>{displayName(removing)}</strong> · {modelSummary(removing, modelOptions)}</p>
      <p>{session.text.decisionModelsRemoveHint}</p>
    </div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={() => (removing = null)}>{session.text.cancel}</button>
      <button class="primary-button danger-action" type="button" onclick={() => removing && removeModel(removing.id)}>{session.text.decisionModelsRemove}</button>
    </footer>
  </AlertDialog>
{/if}

{#if dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={saving} onclick={reset}>{session.text.cancel}</button>
      <button class="primary-button" type="button" disabled={saving} onclick={() => void save()}>{saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}

<style>
  .decision-page { display: block; }

  .decision-kicker {
    display: inline-block;
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    font-weight: 600;
    letter-spacing: var(--tracking-caps);
    line-height: 14px;
    text-transform: uppercase;
  }

  .decision-overview {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    width: var(--settings-col);
    margin: 2px auto 24px;
    padding: 20px 20px 0;
    overflow: hidden;
    border: 1px solid var(--hairline);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
  }
  .decision-overview.is-off { background: color-mix(in srgb, var(--label-primary) 1.5%, var(--card-bg)); }
  .decision-overview-main { display: grid; min-width: 0; flex: 1; gap: 4px; }
  .decision-overview-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .decision-overview-title strong { color: var(--label-primary); font-size: var(--fs-section); font-weight: 600; line-height: var(--lh-section); }
  .decision-overview-sub { max-width: 52ch; margin: 0; color: var(--label-secondary); font-size: var(--fs-label); line-height: 19px; }
  .decision-overview-control { display: flex; flex: none; align-items: center; gap: 9px; padding-top: 1px; color: var(--label-secondary); font-size: var(--fs-meta); }
  .decision-state { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 6px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 500; line-height: 16px; white-space: nowrap; }
  .decision-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--label-tertiary); }
  .decision-state[data-state="on"] { border-color: color-mix(in srgb, var(--online, #279141) 32%, var(--control-border)); color: var(--online, #279141); }
  .decision-state[data-state="on"] i { background: var(--online, #279141); box-shadow: 0 0 0 3px color-mix(in srgb, var(--online, #279141) 12%, transparent); }
  .decision-state[data-state="off"] i { background: var(--label-tertiary); }

  .decision-facts { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 22px; margin: 14px -20px 0; padding: 11px 20px 12px; border-top: 1px solid var(--hairline); }
  .decision-facts span { display: inline-flex; align-items: baseline; gap: 7px; min-width: 0; }
  .decision-facts b { color: var(--label-tertiary); font-size: var(--fs-meta); font-weight: 400; line-height: 16px; white-space: nowrap; }
  .decision-facts em { color: var(--label-primary); font-size: var(--fs-label); font-style: normal; font-weight: 500; line-height: 18px; }
  .decision-overview.is-off .decision-facts { opacity: .78; }

  .decision-count { color: var(--label-tertiary); font-family: var(--font-mono); font-size: var(--fs-meta); font-variant-numeric: tabular-nums; }

  .decision-models { display: grid; }
  .decision-model { position: relative; }
  .decision-model + .decision-model { border-top: 1px solid var(--hairline); }
  .decision-model.is-active { background: color-mix(in srgb, var(--accent) 3.5%, transparent); }
  .decision-model, .decision-use, .decision-test, .decision-add-trigger, .decision-add-option, .decision-remove, .decision-add-close { transition: background var(--duration-instant) var(--ease-standard), color var(--duration-instant) var(--ease-standard), border-color var(--duration-instant) var(--ease-standard); }
  .decision-model.is-disabled { opacity: .72; }
  .decision-model.is-open { background: color-mix(in srgb, var(--label-primary) 1.2%, var(--card-bg)); }
  .decision-model.is-active.is-open { background: color-mix(in srgb, var(--accent) 3.5%, var(--card-bg)); }
  .decision-model-rail { position: absolute; top: 12px; bottom: 12px; left: 0; width: 2px; border-radius: 2px; background: var(--accent); }
  .decision-model-head { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 16px; }
  .decision-model-trigger { display: flex; align-items: center; flex: 1; gap: 11px; min-width: 0; padding: 4px 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .decision-model-identity { display: grid; min-width: 0; flex: 1; gap: 1px; }
  .decision-model-name { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
  .decision-model-name strong { overflow: hidden; color: var(--label-primary); font-size: var(--fs-body); font-weight: 550; line-height: var(--lh-label); text-overflow: ellipsis; white-space: nowrap; }
  .decision-model-identity small { overflow: hidden; color: var(--label-secondary); font-family: var(--font-mono); font-size: var(--fs-meta); line-height: 15px; text-overflow: ellipsis; white-space: nowrap; }
  .decision-pill { padding: 1px 7px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); color: var(--label-secondary); font-size: 10px; font-weight: 600; letter-spacing: .02em; line-height: 15px; text-transform: uppercase; }
  .decision-pill.is-active { border-color: color-mix(in srgb, var(--accent) 34%, var(--control-border)); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent); }
  .decision-model-caret { display: inline-flex; flex: none; color: var(--label-tertiary); transition: transform var(--duration-fast) var(--ease-standard); }
  .decision-model-trigger[aria-expanded="true"] .decision-model-caret { transform: rotate(180deg); }
  .decision-model-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: var(--rounded-sm); }
  .decision-model-actions { display: flex; flex: none; align-items: center; gap: 7px; }
  .decision-use { height: var(--control-h-compact); padding: 0 8px; border: 1px solid var(--control-border); border-radius: var(--rounded-sm); background: var(--card-bg); color: var(--label-primary); font-size: var(--fs-meta); font-weight: 500; white-space: nowrap; cursor: pointer; }
  .decision-use:hover:not(:disabled) { background: var(--control-bg-hover); border-color: var(--control-border-strong); }
  .decision-use:disabled { opacity: .4; cursor: default; }

  .decision-model-body { padding: 0 16px 16px 53px; }
  .decision-model-body-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0 11px; border-top: 1px solid var(--hairline); }
  .decision-model-body-head > span { padding-top: 11px; color: var(--label-tertiary); font-size: var(--fs-meta); font-weight: 600; letter-spacing: var(--tracking-caps); text-transform: uppercase; }
  .decision-remove { display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; padding: 2px 6px; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--danger); font-size: var(--fs-meta); cursor: pointer; }
  .decision-remove:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .decision-form { padding: 0; gap: 12px 16px; }

  .decision-evaluation { display: grid; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--hairline); }
  .decision-evaluation-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .decision-evaluation-head > span { color: var(--label-primary); font-size: var(--fs-label); font-weight: 600; }
  .decision-evaluation-head small { max-width: 60ch; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 1.45; }
  .decision-evaluation-actions { display: flex; flex-wrap: wrap; gap: 5px; }
  .decision-test { display: inline-flex; align-items: center; gap: 5px; height: var(--control-h-compact); padding: 0 8px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); background: var(--card-bg); color: var(--label-secondary); font-size: var(--fs-meta); cursor: pointer; }
  .decision-test:hover:not(:disabled) { color: var(--label-primary); border-color: var(--control-border-strong); background: var(--control-bg-hover); }
  .decision-test:disabled { opacity: .42; cursor: default; }
  .decision-eval-note { max-width: 68ch; margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 1.5; }
  .decision-test-error { display: flex; align-items: flex-start; gap: 6px; margin: 2px 0 0; color: var(--danger); font-size: var(--fs-meta); line-height: 1.45; }
  .decision-test-error i { flex: none; width: 5px; height: 5px; margin-top: 5px; border-radius: 0; background: currentColor; transform: rotate(45deg); }
  .decision-test-result { border: 1px solid var(--hairline); border-radius: var(--rounded-sm); background: var(--card-bg); }
  .decision-test-result summary { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 10px; color: var(--label-primary); font-size: var(--fs-meta); list-style: none; cursor: pointer; }
  .decision-test-result summary::-webkit-details-marker { display: none; }
  .decision-test-result summary > span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .decision-test-result summary code { overflow: hidden; max-width: 42%; color: var(--label-secondary); font-family: var(--font-mono); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .decision-result-caret { display: inline-flex; flex: none; color: var(--label-tertiary); transition: transform var(--duration-fast) var(--ease-standard); }
  .decision-test-result[open] .decision-result-caret { transform: rotate(180deg); }
  .decision-ok { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--online, #279141); box-shadow: 0 0 0 3px color-mix(in srgb, var(--online, #279141) 12%, transparent); }
  .decision-test-detail { display: grid; gap: 5px; padding: 0 10px 10px; }
  .decision-test-detail > span { color: var(--label-tertiary); font-size: var(--fs-meta); font-weight: 600; }
  .decision-test-detail pre { max-height: 220px; margin: 0 0 4px; padding: 9px 10px; overflow: auto; border-radius: var(--rounded-sm); background: var(--fill); color: var(--label-primary); font: 11px/1.55 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }

  .decision-add { border-top: 1px solid var(--hairline); }
  .decision-add-trigger { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .decision-add-trigger:hover:not(:disabled) { background: var(--fill); }
  .decision-add-trigger:disabled { cursor: default; }
  .decision-add-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px dashed var(--control-border-strong); border-radius: var(--rounded-full); color: var(--label-secondary); }
  .decision-add-trigger > span:last-child { display: grid; gap: 1px; }
  .decision-add-trigger strong { color: var(--label-primary); font-size: var(--fs-label); font-weight: 500; line-height: 17px; }
  .decision-add-trigger small { color: var(--label-secondary); font-size: var(--fs-meta); line-height: 15px; }
  .decision-add-panel { padding: 12px 16px 16px; }
  .decision-add-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 9px; color: var(--label-primary); font-size: var(--fs-label); font-weight: 600; }
  .decision-add-close { width: 24px; height: 24px; border: 0; border-radius: 50%; background: var(--fill); color: var(--label-secondary); font-size: 16px; line-height: 1; cursor: pointer; }
  .decision-add-options { display: grid; gap: 6px; }
  .decision-add-option { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 1px solid var(--hairline); border-radius: var(--rounded-sm); background: var(--card-bg); color: inherit; text-align: left; cursor: pointer; }
  .decision-add-option:hover { border-color: var(--control-border-strong); background: var(--control-bg-hover); }
  .decision-add-glyph { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); color: var(--label-secondary); }
  .decision-add-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }
  .decision-add-copy strong { color: var(--label-primary); font-size: var(--fs-label); font-weight: 550; }
  .decision-add-copy small { color: var(--label-secondary); font-size: var(--fs-meta); line-height: 1.4; }
  .decision-add-plus { display: inline-flex; flex: none; color: var(--label-tertiary); }
  .decision-inline-warning { display: flex; align-items: center; gap: 7px; margin: 0; padding: 10px 16px; border-top: 1px solid var(--hairline); color: var(--warning-text, #8a5a00); font-size: var(--fs-meta); line-height: 1.45; }
  .decision-inline-warning i { flex: none; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

  .decision-strategy { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 16px; }
  .decision-strategy-copy { display: grid; gap: 2px; }
  .decision-strategy-copy strong { color: var(--label-primary); font-size: var(--fs-label); font-weight: 550; line-height: 18px; }
  .decision-strategy-copy p { margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 1.45; }
  .decision-segmented { flex: none; }
  .decision-segmented .segmented-item:disabled { opacity: .42; cursor: default; }
  .decision-policy-preview { display: grid; gap: 3px; margin: 0 16px 2px; padding: 10px 12px; border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); background: color-mix(in srgb, var(--accent) 4%, transparent); }
  .decision-policy-preview > span { color: var(--label-tertiary); font-size: 10px; font-weight: 600; letter-spacing: var(--tracking-caps); text-transform: uppercase; }
  .decision-policy-preview p { margin: 0; color: var(--label-primary); font-size: var(--fs-label); line-height: 18px; }
  .decision-policy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; padding: 16px; border-top: 1px solid var(--hairline); }
  .decision-policy-field { display: grid; gap: 5px; min-width: 0; color: var(--label-secondary); font-size: var(--fs-label); font-weight: 600; }
  .decision-policy-field small { color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 400; line-height: 1.45; }
  .decision-policy-field > input { width: 100%; height: var(--control-h); padding: 0 9px; border: 1px solid var(--control-border); border-radius: var(--rounded-sm); background: var(--control-bg); color: var(--label-primary); font: 400 var(--fs-label)/1 var(--font-ui); }
  .decision-policy-field > input:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--accent); border-color: var(--accent); }
  .decision-policy-field :global(.select-control), .decision-policy-field :global(.select-control .select-control-trigger) { width: 100%; max-width: 100%; }

  @media (max-width: 640px) {
    .decision-overview { flex-direction: column; gap: 14px; }
    .decision-overview-control { align-self: flex-start; }
    .decision-facts { gap: 5px 16px; }
    .decision-model-head { align-items: flex-start; flex-wrap: wrap; }
    .decision-model-actions { width: 100%; padding-left: 37px; justify-content: flex-end; }
    .decision-model-body { padding-left: 16px; }
    .decision-strategy { align-items: flex-start; flex-direction: column; }
    .decision-policy-grid { grid-template-columns: 1fr; }
    .decision-test-result summary code { display: none; }
  }
</style>
