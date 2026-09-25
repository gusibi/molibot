<script lang="ts">
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import ChevronDown from "reicon-svelte/icons/ChevronDown";
  import { onDestroy } from "svelte";
  import type { DesktopModelOption } from "@molibot/desktop-contract";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
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
  let addProvider = $state<DecisionModelProvider | "">("");
  let openModelId = $state("");
  let openTestKey = $state("");
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
  const addableProviders = $derived(([
    { value: "cloudflare" as const, label: session.text.decisionModelsCloudflare },
    { value: "siliconflow" as const, label: session.text.decisionModelsSiliconFlow },
    { value: "custom-jev" as const, label: session.text.decisionModelsCustomJev }
  ]).filter((option) => option.value !== "cloudflare" || !edit?.decisionModels.some((model) => model.provider === option.value)));

  function providerLabel(provider: DecisionModelProvider): string {
    if (provider === "jev") return session.text.decisionModelsJev;
    if (provider === "cloudflare") return session.text.decisionModelsCloudflare;
    if (provider === "siliconflow") return session.text.decisionModelsSiliconFlow;
    if (provider === "custom-jev") return session.text.decisionModelsCustomJev;
    return session.text.decisionModelsLlm;
  }

  function testModeLabel(mode: DecisionTestMode): string {
    if (mode === "noul") return session.text.decisionModelsTestNoul;
    if (mode === "choice") return session.text.decisionModelsTestChoice;
    return session.text.decisionModelsTestScore;
  }

  function modelSummary(model: DesktopDecisionModelSettings, options: DesktopModelOption[]): string {
    if (model.provider === "jev") return model.baseUrl || session.text.modelUnconfigured;
    if (model.provider === "cloudflare") return model.accountId || session.text.modelUnconfigured;
    if (model.provider === "siliconflow") return model.modelId || session.text.modelUnconfigured;
    if (model.provider === "custom-jev") return model.modelId || session.text.modelUnconfigured;
    const option = options.find((item) => item.key === model.llmModelKey);
    return option?.alias || option?.label || session.text.modelUnconfigured;
  }

  function isAutoAvailable(value: DesktopAdaptiveThinkingSettings): boolean {
    if (!saved || !value.enabled || !value.selectedDecisionModelId) return false;
    const model = value.decisionModels.find((item) => item.id === value.selectedDecisionModelId);
    const savedModel = saved.decisionModels.find((item) => item.id === value.selectedDecisionModelId);
    if (!model || model.enabled === false) return false;
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
      && value.availableDecisionModelIds.includes(model.id)
      && savedModel?.provider === "llm"
      && savedModel.llmModelKey === model.llmModelKey
    );
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
        openModelId = value.selectedDecisionModelId || value.decisionModels[0]?.id || "";
        openTestKey = "";
        apiKeys = {};
        clearApiKeys = [];
        showApiKeys = {};
        addProvider = "";
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
    openModelId = saved.selectedDecisionModelId || saved.decisionModels[0]?.id || "";
    openTestKey = "";
    apiKeys = {};
    clearApiKeys = [];
    showApiKeys = {};
    addProvider = "";
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
    openTestKey = "";
  }

  function updateApiKey(id: string, value: string): void {
    apiKeys = { ...apiKeys, [id]: value };
    testResults = { ...testResults, [id]: {} };
    testFailures = { ...testFailures, [id]: {} };
  }

  function addModel(): void {
    if (!edit || !addProvider || (addProvider === "cloudflare" && edit.decisionModels.some((model) => model.provider === addProvider))) return;
    let newId = addProvider === "custom-jev" ? "custom-jev-1" : "siliconflow-2";
    if (addProvider === "siliconflow" || addProvider === "custom-jev") {
      let sequence = addProvider === "custom-jev" ? 1 : 2;
      const prefix = addProvider === "custom-jev" ? "custom-jev" : "siliconflow";
      while (edit.decisionModels.some((model) => model.id === newId)) newId = `${prefix}-${++sequence}`;
    }
    const model: DesktopDecisionModelSettings = addProvider === "cloudflare"
      ? { id: "cloudflare-jev", provider: "cloudflare", enabled: false, accountId: "", hasApiToken: false }
      : addProvider === "siliconflow"
        ? { id: newId, provider: "siliconflow", enabled: false, baseUrl: "https://api.siliconflow.cn", modelId: "", hasApiKey: false }
        : { id: newId, provider: "custom-jev", enabled: false, name: "", baseUrl: "", modelId: "", hasApiKey: false };
    updateEdit({
      decisionModels: [...edit.decisionModels, model],
      selectedDecisionModelId: edit.selectedDecisionModelId || model.id
    });
    openModelId = model.id;
    openTestKey = "";
    addProvider = "";
  }

  function removeModel(id: string): void {
    if (!edit || ["jev", "llm", builtInSiliconFlowId].includes(id)) return;
    const decisionModels = edit.decisionModels.filter((model) => model.id !== id);
    const selectedDecisionModelId = edit.selectedDecisionModelId === id
      ? decisionModels[0]?.id ?? ""
      : edit.selectedDecisionModelId;
    if (id in apiKeys) {
      const next = { ...apiKeys };
      delete next[id];
      apiKeys = next;
    }
    clearApiKeys = clearApiKeys.filter((item) => item !== id);
    if (openModelId === id) openModelId = decisionModels[0]?.id ?? "";
    openTestKey = "";
    testResults = { ...testResults, [id]: {} };
    testFailures = { ...testFailures, [id]: {} };
    updateEdit({ decisionModels, selectedDecisionModelId });
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
      openTestKey = `${model.id}:${testCaseId}`;
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

  onDestroy(trackUnsaved(() => dirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.decisionModelsUnavailable} icon="cpu" /></SettingGroup>
{:else if loading || !edit}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup title={session.text.decisionModelsList} contentClass="decision-model-provider">
    <SettingRow title={session.text.decisionModelsEnabled} description={session.text.decisionModelsEnabledHint}>
      <IosSwitch checked={edit.enabled} ariaLabel={session.text.decisionModelsEnabled} onCheckedChange={(checked) => updateEdit({ enabled: checked })} />
    </SettingRow>

      {#each edit.decisionModels as model (model.id)}
        <section class="decision-model-entry" aria-label={providerLabel(model.provider)}>
          <header class="decision-model-entry-header">
            <button class="decision-model-entry-trigger" type="button" aria-expanded={openModelId === model.id} onclick={() => { openModelId = openModelId === model.id ? "" : model.id; openTestKey = ""; }}>
              <ChevronDown size={16} aria-hidden="true" />
              <span class="decision-model-entry-labels">
                <strong>{model.provider === "custom-jev" ? model.name || providerLabel(model.provider) : providerLabel(model.provider)}{#if model.id === edit.selectedDecisionModelId}<span class="decision-model-selected">{session.text.decisionModelsSelectedForAuto}</span>{/if}</strong>
                <small>{modelSummary(model, modelOptions)}</small>
              </span>
            </button>
            <IosSwitch checked={model.enabled !== false} ariaLabel={`${model.provider === "custom-jev" ? model.name || providerLabel(model.provider) : providerLabel(model.provider)} · ${session.text.decisionModelsModelEnabled}`} onCheckedChange={(checked) => { updateModel(model.id, { enabled: checked }); if (checked) openModelId = model.id; }} />
            {#if !["jev", "llm", builtInSiliconFlowId].includes(model.id)}
              <button class="secondary-button" type="button" disabled={saving || testingProvider !== ""} onclick={() => removeModel(model.id)}>{session.text.decisionModelsRemove}</button>
            {/if}
          </header>
          {#if openModelId === model.id}
          <div class="settings-form decision-model-form">
            {#if model.provider === "jev"}
              <label class="settings-field settings-field-wide">
                <span>{session.text.decisionModelsHost}</span>
                <input value={model.baseUrl} oninput={(event) => updateModel(model.id, { baseUrl: event.currentTarget.value })} autocomplete="off" spellcheck="false" />
                <small>{session.text.decisionModelsHostHint}</small>
              </label>
              <label class="settings-field settings-field-wide">
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
              <label class="settings-field settings-field-wide">
                <span>{session.text.decisionModelsCloudflareAccountId}</span>
                <input value={model.accountId} oninput={(event) => updateModel(model.id, { accountId: event.currentTarget.value })} autocomplete="off" spellcheck="false" />
                <small>{session.text.decisionModelsCloudflareAccountIdHint}</small>
              </label>
              <label class="settings-field settings-field-wide">
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
                <label class="settings-field settings-field-wide">
                  <span>{session.text.decisionModelsCustomName}</span>
                  <input value={model.name} oninput={(event) => updateModel(model.id, { name: event.currentTarget.value })} autocomplete="off" />
                </label>
              {/if}
              <label class="settings-field settings-field-wide">
                <span>{model.provider === "custom-jev" ? session.text.decisionModelsHost : session.text.decisionModelsSiliconFlowHost}</span>
                <input value={model.baseUrl} oninput={(event) => updateModel(model.id, { baseUrl: event.currentTarget.value })} placeholder={model.provider === "custom-jev" ? "https://example.com" : "https://api.siliconflow.cn"} autocomplete="off" spellcheck="false" />
                <small>{model.provider === "custom-jev" ? session.text.decisionModelsCustomHostHint : session.text.decisionModelsSiliconFlowHostHint}</small>
              </label>
              <label class="settings-field settings-field-wide">
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
          <div class="decision-model-tests">
            <p class="settings-section-hint">{session.text.decisionModelsTestCasesHint}</p>
            <div class="settings-row-actions">
              {#each ["noul", "choice", "score"] as mode (mode)}
                <button class="secondary-button" type="button" disabled={testingProvider !== "" || saving || !canTestCase(model)} onclick={() => void runTestCase(model, mode as DecisionTestMode)}>
                  {testingProvider === model.id && testingCase === mode ? session.text.loading : testModeLabel(mode as DecisionTestMode)}
                </button>
              {/each}
            </div>
            {#each ["noul", "choice", "score"] as mode (mode)}
              {#if testFailures[model.id]?.[mode as DecisionTestMode]}<p class="settings-action-message error-message" role="alert">{testModeLabel(mode as DecisionTestMode)} · {testFailures[model.id][mode as DecisionTestMode]}</p>{/if}
              {#if testResults[model.id]?.[mode as DecisionTestMode]}
                {@const result = testResults[model.id][mode as DecisionTestMode]!}
                <div class="decision-model-test-result" aria-live="polite">
                  <button class="decision-model-test-result-trigger" type="button" aria-expanded={openTestKey === `${model.id}:${mode}`} onclick={() => (openTestKey = openTestKey === `${model.id}:${mode}` ? "" : `${model.id}:${mode}`)}>
                    <ChevronDown size={14} aria-hidden="true" />
                    <span>{session.text.decisionModelsTestSuccess} · {testModeLabel(result.testCase.id)} · {result.model}</span>
                  </button>
                  {#if openTestKey === `${model.id}:${mode}`}
                  <span>{session.text.decisionModelsTestInput}</span>
                  <pre>{JSON.stringify({ state: result.testCase.state, questions: result.testCase.questions }, null, 2)}</pre>
                  <span>{session.text.decisionModelsTestOutput}</span>
                  <pre>{JSON.stringify({ answers: result.answers }, null, 2)}</pre>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
          {/if}
        </section>
      {/each}

    {#if addableProviders.length > 0}
      <div class="settings-form decision-model-add">
        <label class="settings-field settings-field-wide"><span>{session.text.decisionModelsAdd}</span>
          <div class="decision-model-add-row">
            <SelectControl value={addProvider} ariaLabel={session.text.decisionModelsAdd} options={[{ value: "", label: session.text.decisionModelsAddPlaceholder }, ...addableProviders]} onChange={(value) => (addProvider = value as DecisionModelProvider | "")} />
            <button class="secondary-button" type="button" disabled={!addProvider || saving} onclick={addModel}>{session.text.decisionModelsAddButton}</button>
          </div>
          <small>{session.text.decisionModelsAddHint}</small>
        </label>
      </div>
    {/if}
    {#if edit.enabled && !autoCanBeSelected}<p class="settings-section-hint" role="status">{session.text.providerThinkingAutoUnavailable}</p>{/if}
  </SettingGroup>

  <SettingGroup title={session.text.decisionModelsUseCase} description={session.text.decisionModelsUseCaseHint} contentClass="decision-model-policy">
    <SettingRow title={session.text.adaptiveThinkingDefaultStrategy} description={session.text.adaptiveThinkingDefaultStrategyHint}>
      <SelectControl value={edit.defaultStrategy} ariaLabel={session.text.adaptiveThinkingDefaultStrategy} options={[{ value: "fixed", label: session.text.adaptiveThinkingFixed }, { value: "auto", label: session.text.adaptiveThinkingAuto, disabled: !autoCanBeSelected }]} onChange={(value) => updateEdit({ defaultStrategy: value as Strategy })} />
    </SettingRow>
    <SettingRow title={session.text.decisionModelsSelect} description={session.text.decisionModelsSelectHint}>
          <SelectControl value={edit.selectedDecisionModelId} ariaLabel={session.text.decisionModelsSelect} options={[{ value: "", label: session.text.modelUnconfigured }, ...edit.decisionModels.map((model) => ({ value: model.id, label: model.provider === "custom-jev" ? model.name || providerLabel(model.provider) : model.provider === "siliconflow" ? `${providerLabel(model.provider)} · ${modelSummary(model, modelOptions)}` : providerLabel(model.provider), disabled: model.enabled === false }))]} onChange={selectDecisionModel} />
    </SettingRow>
    <div class="settings-form decision-model-form">
      <label class="settings-field"><span>{session.text.adaptiveThinkingCeiling}</span><SelectControl value={edit.maxThinkingLevel} ariaLabel={session.text.adaptiveThinkingCeiling} options={levelOptions()} onChange={(value) => updateEdit({ maxThinkingLevel: value as ThinkingLevel })} /></label>
      <label class="settings-field"><span>{session.text.adaptiveThinkingFallback}</span><SelectControl value={edit.fallbackThinkingLevel} ariaLabel={session.text.adaptiveThinkingFallback} options={levelOptions()} onChange={(value) => updateEdit({ fallbackThinkingLevel: value as ThinkingLevel })} /></label>
      <label class="settings-field"><span>{session.text.adaptiveThinkingThreshold}</span><input type="number" min="0" max="1" step="0.01" bind:value={edit.confidenceThreshold} /></label>
      <label class="settings-field"><span>{session.text.adaptiveThinkingTimeout}</span><input type="number" min="100" max="5000" step="100" bind:value={edit.timeoutMs} /></label>
    </div>
    <p class="settings-section-hint">{session.text.decisionModelsTimeoutHint}</p>
  </SettingGroup>
{/if}

{#if failure}<p class="settings-action-message error-message" role="alert">{failure}</p>{/if}
{#if message}<p class="settings-action-message" aria-live="polite">{message}</p>{/if}
{#if dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={saving} onclick={reset}>{session.text.cancel}</button>
      <button class="primary-button" type="button" disabled={saving} onclick={() => void save()}>{saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
