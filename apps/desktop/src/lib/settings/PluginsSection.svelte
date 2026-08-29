<script lang="ts">
  import { onMount } from "svelte";
  import { parsePluginToHostMessage, type HostToPluginMessage } from "@molibot/shared/pluginBridge";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import NativeTimeInput from "../components/ui/NativeTimeInput.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import {
    desktopPluginSettingsFrameUrl,
    invokeDesktopContractPluginAction,
    loadDesktopContractPluginDetail,
    loadDesktopContractPlugins,
    loadDesktopCorePluginDetail,
    loadDesktopCorePlugins,
    performDesktopContractPluginLifecycle,
    saveDesktopContractPluginSettings,
    saveDesktopCorePluginSettings,
    setDesktopContractPluginEnabled,
    setDesktopCorePluginEnabled,
    type DesktopContractPluginDetail,
    type DesktopContractPluginItem,
    type DesktopCorePluginDetail,
    type DesktopCorePluginId,
    type DesktopCorePluginItem
  } from "../api";

  type ManagedPlugin = {
    id: string;
    name: string;
    version: string;
    description: string;
    sourceKind: string;
    enabled: boolean;
    status: "active" | "disabled" | "error" | "incompatible";
    hasSettings: boolean;
    iconUri?: string;
    management: "core" | "contract";
  };

  type CoreDraft = DesktopCorePluginDetail["values"];

  let corePlugins = $state<DesktopCorePluginItem[]>([]);
  let contractPlugins = $state<DesktopContractPluginItem[]>([]);
  let selectedPluginId = $state<string | null>(null);
  let coreDetail = $state<DesktopCorePluginDetail | null>(null);
  let contractDetail = $state<DesktopContractPluginDetail | null>(null);
  let coreDraft = $state<CoreDraft | null>(null);
  let loadingList = $state(false);
  let loadingDetail = $state(false);
  let listMessage = $state("");
  let detailMessage = $state("");
  let formValues = $state<Record<string, unknown>>({});
  let secretReplacements = $state<Record<string, string>>({});
  let secretClears = $state<Set<string>>(new Set());
  let savingDetail = $state(false);
  let customFrame = $state<HTMLIFrameElement | null>(null);
  let customFrameReady = $state(false);
  let customFrameHeight = $state(320);
  let pluginTheme = $state<"light" | "dark">("light");
  let pluginThemeFamily = $state("");
  let loadedEndpoint = $state("");

  let isChinese = $derived(session.locale === "zh-CN");
  let localeKey = $derived<"zh" | "en">(isChinese ? "zh" : "en");
  let copy = $derived(isChinese ? {
    installed: "已安装插件",
    installedDescription: "内置功能随 Molibot 提供；外置插件从独立插件目录加载。",
    empty: "暂无可用插件",
    loadFailed: "部分插件加载失败",
    back: "返回插件列表",
    loading: "加载插件中…",
    settings: "设置",
    details: "详情",
    builtIn: "内置",
    external: "外置目录",
    enabled: "已启用",
    disabled: "已禁用",
    memoryName: "记忆后端",
    memoryDescription: "管理记忆存储、反思时间与通知。",
    dailyName: "每日素材 / 每日回顾",
    dailyDescription: "从授权会话提取每日素材并写入指定项目。",
    configuration: "插件配置",
    isolatedConfiguration: "外置插件配置独立存储，不写入全局设置。",
    memoryBackend: "记忆后端",
    reflectionTime: "每日反思时间",
    reflectionNotifications: "反思完成后通知",
    dailyTime: "每日执行时间",
    project: "写入项目",
    noProject: "暂不选择项目",
    outputDirectory: "输出目录",
    promptPath: "提示词文件",
    scanBudget: "扫描 Token 预算",
    scanModel: "扫描模型",
    followDefaultModel: "跟随默认模型",
    notifications: "执行完成后通知",
    save: "保存设置",
    saving: "保存中…",
    saved: "插件设置已保存",
    noConfiguration: "该插件无需额外配置。",
    storageLifecycle: "存储与生命周期",
    clearCache: "清空缓存",
    clearCacheDescription: "删除可重新生成的缓存文件。",
    clear: "清空",
    deleteConfig: "删除配置",
    deleteConfigDescription: "删除插件的独立配置。",
    deleteData: "删除业务数据",
    deleteDataDescription: "删除插件持久化的数据文件。",
    remove: "删除",
    uninstall: "卸载插件",
    uninstallDescription: "移除插件代码，默认保留配置与数据。",
    uninstallAction: "卸载",
    clearSecret: "清除",
    configuredSecret: "已配置密钥（输入新值替换）"
  } : {
    installed: "Installed Plugins",
    installedDescription: "Built-ins ship with Molibot; external plugins load from isolated plugin directories.",
    empty: "No plugins available",
    loadFailed: "Some plugins failed to load",
    back: "Back to plugins",
    loading: "Loading plugins…",
    settings: "Configure",
    details: "Details",
    builtIn: "Built in",
    external: "External directory",
    enabled: "Enabled",
    disabled: "Disabled",
    memoryName: "Memory Backend",
    memoryDescription: "Manage memory storage, reflection time, and notifications.",
    dailyName: "Daily Materials / Review",
    dailyDescription: "Extract daily material from authorized conversations into a project.",
    configuration: "Plugin Configuration",
    isolatedConfiguration: "External plugin configuration is isolated from global settings.",
    memoryBackend: "Memory backend",
    reflectionTime: "Daily reflection time",
    reflectionNotifications: "Notify after reflection",
    dailyTime: "Daily run time",
    project: "Destination project",
    noProject: "No project selected",
    outputDirectory: "Output directory",
    promptPath: "Prompt file",
    scanBudget: "Scan token budget",
    scanModel: "Scan model",
    followDefaultModel: "Follow default model",
    notifications: "Notify after completion",
    save: "Save Settings",
    saving: "Saving…",
    saved: "Plugin settings saved",
    noConfiguration: "This plugin does not require additional configuration.",
    storageLifecycle: "Storage & Lifecycle",
    clearCache: "Clear Cache",
    clearCacheDescription: "Delete cache files that can be regenerated.",
    clear: "Clear",
    deleteConfig: "Delete Configuration",
    deleteConfigDescription: "Delete the plugin's isolated configuration.",
    deleteData: "Delete Domain Data",
    deleteDataDescription: "Delete the plugin's persisted data files.",
    remove: "Delete",
    uninstall: "Uninstall Plugin",
    uninstallDescription: "Remove plugin code while retaining configuration and data.",
    uninstallAction: "Uninstall",
    clearSecret: "Clear",
    configuredSecret: "Secret configured (type to replace)"
  });

  let managedPlugins = $derived<ManagedPlugin[]>([
    ...corePlugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.id === "memory" ? copy.memoryName : copy.dailyName,
      version: plugin.version,
      description: plugin.id === "memory" ? copy.memoryDescription : copy.dailyDescription,
      sourceKind: copy.builtIn,
      enabled: plugin.enabled,
      status: plugin.enabled ? "active" as const : "disabled" as const,
      hasSettings: true,
      management: "core" as const
    })),
    ...contractPlugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      sourceKind: plugin.source.kind === "directory" ? copy.external : plugin.source.kind,
      enabled: plugin.enabled,
      status: plugin.status,
      hasSettings: plugin.hasSettings,
      iconUri: plugin.iconUri,
      management: "contract" as const
    }))
  ]);
  let selectedPlugin = $derived(managedPlugins.find((plugin) => plugin.id === selectedPluginId) ?? null);

  function isCorePluginId(value: string): value is DesktopCorePluginId {
    return value === "memory" || value === "daily-materials";
  }

  function pluginIconSource(iconUri: string | undefined): string {
    if (!iconUri) return "";
    return iconUri.startsWith("/") ? `${session.endpoint}${iconUri}` : iconUri;
  }

  async function refreshPluginList(): Promise<void> {
    if (!session.endpoint || loadingList) return;
    loadingList = true;
    listMessage = "";
    const [coreResult, contractResult] = await Promise.allSettled([
      loadDesktopCorePlugins(session.endpoint),
      loadDesktopContractPlugins(session.endpoint)
    ]);
    if (coreResult.status === "fulfilled") corePlugins = coreResult.value;
    if (contractResult.status === "fulfilled") contractPlugins = contractResult.value;
    const failures = [coreResult, contractResult].filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    if (failures.length > 0) {
      listMessage = `${copy.loadFailed}: ${failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join(" · ")}`;
    }
    loadingList = false;
  }

  async function openPluginDetail(pluginId: string): Promise<void> {
    if (!session.endpoint) return;
    selectedPluginId = pluginId;
    loadingDetail = true;
    detailMessage = "";
    coreDetail = null;
    contractDetail = null;
    coreDraft = null;
    customFrameReady = false;
    try {
      if (isCorePluginId(pluginId)) {
        coreDetail = await loadDesktopCorePluginDetail(session.endpoint, pluginId);
        coreDraft = structuredClone(coreDetail.values);
      } else {
        contractDetail = await loadDesktopContractPluginDetail(session.endpoint, pluginId);
        formValues = { ...(contractDetail?.settingsValues ?? {}) };
        secretReplacements = {};
        secretClears = new Set();
      }
    } catch (error) {
      detailMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loadingDetail = false;
    }
  }

  function backToList(): void {
    selectedPluginId = null;
    coreDetail = null;
    contractDetail = null;
    coreDraft = null;
    detailMessage = "";
    void refreshPluginList();
  }

  async function togglePlugin(plugin: ManagedPlugin, enabled: boolean): Promise<void> {
    if (!session.endpoint) return;
    detailMessage = "";
    try {
      if (plugin.management === "core" && isCorePluginId(plugin.id)) {
        const persisted = await setDesktopCorePluginEnabled(session.endpoint, plugin.id, enabled);
        corePlugins = corePlugins.map((item) => item.id === plugin.id ? { ...item, enabled: persisted } : item);
        if (coreDraft && selectedPluginId === plugin.id) coreDraft = { ...coreDraft, enabled: persisted };
      } else {
        await setDesktopContractPluginEnabled(session.endpoint, plugin.id, enabled);
        contractPlugins = contractPlugins.map((item) => item.id === plugin.id ? { ...item, enabled, status: enabled ? "active" : "disabled" } : item);
        if (contractDetail?.item.id === plugin.id) contractDetail = { ...contractDetail, item: { ...contractDetail.item, enabled, status: enabled ? "active" : "disabled" } };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (selectedPluginId === null) listMessage = message;
      else detailMessage = message;
    }
  }

  async function saveCoreSettings(): Promise<void> {
    if (!session.endpoint || !selectedPluginId || !isCorePluginId(selectedPluginId) || !coreDraft || savingDetail) return;
    savingDetail = true;
    detailMessage = "";
    try {
      await saveDesktopCorePluginSettings(session.endpoint, selectedPluginId, coreDraft as Record<string, unknown>);
      await openPluginDetail(selectedPluginId);
      detailMessage = copy.saved;
      await refreshPluginList();
    } catch (error) {
      detailMessage = error instanceof Error ? error.message : String(error);
    } finally {
      savingDetail = false;
    }
  }

  async function saveContractSettings(): Promise<void> {
    if (!session.endpoint || !contractDetail || savingDetail) return;
    savingDetail = true;
    detailMessage = "";
    try {
      const patch: { values?: Record<string, unknown>; secrets?: { replace?: Record<string, string>; clear?: string[] } } = { values: formValues };
      if (Object.keys(secretReplacements).length > 0 || secretClears.size > 0) patch.secrets = { replace: secretReplacements, clear: Array.from(secretClears) };
      await saveDesktopContractPluginSettings(session.endpoint, contractDetail.item.id, patch);
      await openPluginDetail(contractDetail.item.id);
      detailMessage = copy.saved;
    } catch (error) {
      detailMessage = error instanceof Error ? error.message : String(error);
    } finally {
      savingDetail = false;
    }
  }

  async function handleLifecycleAction(action: "uninstall" | "clear-cache" | "delete-config" | "delete-data", confirmText: string): Promise<void> {
    if (!session.endpoint || !contractDetail || !confirm(confirmText)) return;
    detailMessage = "";
    try {
      await performDesktopContractPluginLifecycle(session.endpoint, contractDetail.item.id, action);
      if (action === "uninstall") backToList();
      else await openPluginDetail(contractDetail.item.id);
    } catch (error) {
      detailMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function postToCustomPlugin(message: HostToPluginMessage): void {
    customFrame?.contentWindow?.postMessage(message, "*");
  }

  function readPluginTheme(): "light" | "dark" {
    return document.documentElement.dataset.resolvedAppearance === "dark" ? "dark" : "light";
  }

  function readPluginThemeTokens(): Record<string, string> {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: styles.getPropertyValue("--card-bg").trim(),
      surface: styles.getPropertyValue("--surface-secondary").trim(),
      foreground: styles.getPropertyValue("--label-primary").trim(),
      muted: styles.getPropertyValue("--label-secondary").trim(),
      border: styles.getPropertyValue("--separator").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      danger: styles.getPropertyValue("--danger").trim(),
      success: styles.getPropertyValue("--success").trim()
    };
  }

  function postCustomPluginBootstrap(): void {
    if (!contractDetail) return;
    postToCustomPlugin({ type: "molibot:host:bootstrap", version: 1, pluginId: contractDetail.item.id, pluginVersion: contractDetail.item.version, locale: isChinese ? "zh-CN" : "en-US", theme: pluginTheme, themeTokens: readPluginThemeTokens(), enabled: contractDetail.item.enabled });
  }

  async function handleCustomPluginMessage(event: MessageEvent): Promise<void> {
    if (!customFrame?.contentWindow || event.source !== customFrame.contentWindow || !contractDetail || !session.endpoint) return;
    const message = parsePluginToHostMessage(event.data);
    if (!message) return;
    const replyError = (error: unknown) => postToCustomPlugin({ type: "molibot:host:error", correlationId: message.correlationId, error: error instanceof Error ? error.message : String(error) });
    try {
      if (message.type === "molibot:plugin:ready") customFrameReady = true;
      else if (message.type === "molibot:plugin:resize") customFrameHeight = message.height;
      else if (message.type === "molibot:plugin:get_settings") postToCustomPlugin({ type: "molibot:host:settings_data", correlationId: message.correlationId, values: $state.snapshot(contractDetail.settingsValues ?? {}) });
      else if (message.type === "molibot:plugin:get_secrets_presence") postToCustomPlugin({ type: "molibot:host:secrets_presence", correlationId: message.correlationId, presence: $state.snapshot(contractDetail.secretsPresence ?? {}) });
      else if (message.type === "molibot:plugin:save_settings") {
        await saveDesktopContractPluginSettings(session.endpoint, contractDetail.item.id, { values: message.values });
        postToCustomPlugin({ type: "molibot:host:saved", correlationId: message.correlationId });
        await openPluginDetail(contractDetail.item.id);
      } else if (message.type === "molibot:plugin:save_secrets") {
        await saveDesktopContractPluginSettings(session.endpoint, contractDetail.item.id, { secrets: { replace: message.replace, clear: message.clear } });
        postToCustomPlugin({ type: "molibot:host:saved", correlationId: message.correlationId });
        await openPluginDetail(contractDetail.item.id);
      } else if (message.type === "molibot:plugin:invoke_action") {
        const result = await invokeDesktopContractPluginAction(session.endpoint, contractDetail.item.id, message.action, message.input);
        postToCustomPlugin({ type: "molibot:host:action_result", correlationId: message.correlationId, result });
      }
    } catch (error) {
      replyError(error);
    }
  }

  onMount(() => {
    window.addEventListener("message", handleCustomPluginMessage);
    pluginTheme = readPluginTheme();
    pluginThemeFamily = document.documentElement.dataset.themeFamily ?? "";
    const themeObserver = new MutationObserver(() => {
      pluginTheme = readPluginTheme();
      pluginThemeFamily = document.documentElement.dataset.themeFamily ?? "";
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-resolved-appearance", "data-theme-family"] });
    return () => {
      window.removeEventListener("message", handleCustomPluginMessage);
      themeObserver.disconnect();
    };
  });

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : "";
    if (!endpoint) {
      loadedEndpoint = "";
      return;
    }
    if (endpoint === loadedEndpoint) return;
    loadedEndpoint = endpoint;
    void refreshPluginList();
  });

  $effect(() => {
    const locale = session.locale;
    const enabled = contractDetail?.item.enabled;
    const themeFamily = pluginThemeFamily;
    if (customFrameReady && contractDetail && locale && enabled !== undefined && themeFamily !== undefined) postCustomPluginBootstrap();
  });
</script>

<div class="plugin-settings-page">
  {#if selectedPluginId === null}
    <SettingGroup title={copy.installed} description={copy.installedDescription} contentClass="plugin-catalog-card">
      {#if listMessage}<p class="plugin-page-message error" aria-live="polite">{listMessage}</p>{/if}
      {#if loadingList && managedPlugins.length === 0}
        <p class="plugin-empty-state">{copy.loading}</p>
      {:else if managedPlugins.length === 0}
        <p class="plugin-empty-state">{copy.empty}</p>
      {:else}
        {#each managedPlugins as plugin (plugin.id)}
          <div class="plugin-catalog-row">
            <button class="plugin-identity-button" type="button" onclick={() => openPluginDetail(plugin.id)}>
              <span class="plugin-icon" aria-hidden="true">{#if plugin.iconUri}<img src={pluginIconSource(plugin.iconUri)} alt="" width="24" height="24" />{:else}{plugin.name.charAt(0).toUpperCase()}{/if}</span>
              <span class="plugin-copy"><span class="plugin-title-line"><strong>{plugin.name}</strong><small>{plugin.version === "built-in" ? plugin.sourceKind : `v${plugin.version} · ${plugin.sourceKind}`}</small></span><span class="plugin-description">{plugin.description}</span></span>
            </button>
            <span class="plugin-row-actions"><IosSwitch checked={plugin.enabled} ariaLabel={plugin.name} onCheckedChange={(enabled) => togglePlugin(plugin, enabled)} /><button class="secondary-button" type="button" onclick={() => openPluginDetail(plugin.id)}>{plugin.hasSettings ? copy.settings : copy.details}</button></span>
          </div>
        {/each}
      {/if}
    </SettingGroup>
  {:else}
    <div class="plugin-detail-toolbar"><button class="tertiary-button" type="button" onclick={backToList}><i class="ph ph-arrow-left" aria-hidden="true"></i>{copy.back}</button>{#if detailMessage}<span class="plugin-detail-message" aria-live="polite">{detailMessage}</span>{/if}</div>

    {#if loadingDetail}
      <div class="settings-card"><p class="plugin-empty-state">{copy.loading}</p></div>
    {:else if selectedPlugin}
      <SettingGroup contentClass="plugin-summary-card">
        <div class="plugin-summary">
          <span class="plugin-icon large" aria-hidden="true">{#if selectedPlugin.iconUri}<img src={pluginIconSource(selectedPlugin.iconUri)} alt="" width="40" height="40" />{:else}{selectedPlugin.name.charAt(0).toUpperCase()}{/if}</span>
          <span class="plugin-copy"><span class="plugin-title-line"><strong>{selectedPlugin.name}</strong><small>{selectedPlugin.version === "built-in" ? selectedPlugin.sourceKind : `v${selectedPlugin.version} · ${selectedPlugin.sourceKind}`}</small></span><span class="plugin-description">{selectedPlugin.description}</span></span>
          <span class="plugin-summary-toggle"><small>{selectedPlugin.enabled ? copy.enabled : copy.disabled}</small><IosSwitch checked={selectedPlugin.enabled} ariaLabel={selectedPlugin.name} onCheckedChange={(enabled) => togglePlugin(selectedPlugin, enabled)} /></span>
        </div>
      </SettingGroup>

      {#if coreDetail?.id === "memory" && coreDraft && "backend" in coreDraft}
        <SettingGroup title={copy.configuration}>
          <SettingRow title={copy.memoryBackend}><SelectControl value={coreDraft.backend} ariaLabel={copy.memoryBackend} options={coreDetail.backends} onChange={(backend) => coreDraft = { ...coreDraft!, backend }} /></SettingRow>
          <SettingRow title={copy.reflectionTime}><NativeTimeInput bind:value={coreDraft.reflectionTime} ariaLabel={copy.reflectionTime} /></SettingRow>
          <SettingRow title={copy.reflectionNotifications}><IosSwitch checked={coreDraft.reflectionNotifications} ariaLabel={copy.reflectionNotifications} onCheckedChange={(reflectionNotifications) => coreDraft = { ...coreDraft!, reflectionNotifications }} /></SettingRow>
        </SettingGroup>
      {:else if coreDetail?.id === "daily-materials" && coreDraft && "projectId" in coreDraft}
        <SettingGroup title={copy.configuration}>
          <SettingRow title={copy.dailyTime}><NativeTimeInput bind:value={coreDraft.time} ariaLabel={copy.dailyTime} /></SettingRow>
          <SettingRow title={copy.project}><SelectControl value={coreDraft.projectId} ariaLabel={copy.project} options={[{ value: "", label: copy.noProject }, ...coreDetail.projects]} onChange={(projectId) => coreDraft = { ...coreDraft!, projectId }} /></SettingRow>
          <SettingRow title={copy.outputDirectory}><input value={coreDraft.dir} autocomplete="off" spellcheck="false" aria-label={copy.outputDirectory} oninput={(event) => coreDraft = { ...coreDraft!, dir: event.currentTarget.value }} /></SettingRow>
          <SettingRow title={copy.promptPath}><input value={coreDraft.promptPath} autocomplete="off" spellcheck="false" aria-label={copy.promptPath} oninput={(event) => coreDraft = { ...coreDraft!, promptPath: event.currentTarget.value }} /></SettingRow>
          <SettingRow title={copy.scanBudget}><input type="number" min="8000" max="900000" step="1000" autocomplete="off" aria-label={copy.scanBudget} value={coreDraft.scanTokenBudget} oninput={(event) => coreDraft = { ...coreDraft!, scanTokenBudget: Number(event.currentTarget.value) }} /></SettingRow>
          <SettingRow title={copy.scanModel}><SelectControl value={coreDraft.scanModelKey} ariaLabel={copy.scanModel} options={[{ value: "", label: copy.followDefaultModel }, ...coreDetail.models]} onChange={(scanModelKey) => coreDraft = { ...coreDraft!, scanModelKey }} /></SettingRow>
          <SettingRow title={copy.notifications}><IosSwitch checked={coreDraft.notifications} ariaLabel={copy.notifications} onCheckedChange={(notifications) => coreDraft = { ...coreDraft!, notifications }} /></SettingRow>
        </SettingGroup>
      {:else if contractDetail?.manifest?.settings?.mode === "schema"}
        <SettingGroup title={copy.configuration} description={copy.isolatedConfiguration} contentClass="plugin-schema-form">
          {#if contractDetail.presentation && contractDetail.presentation.length > 0}
            {#each contractDetail.presentation as field (field.key)}
              {@const labelText = field.label[localeKey] || field.label.zh}
              {@const descText = field.description ? (field.description[localeKey] || field.description.zh) : ""}
              {@const isConfigured = Boolean(contractDetail.secretsPresence?.[field.key]?.present)}
              <label class="settings-field settings-field-wide"><span>{labelText}</span>{#if descText}<small>{descText}</small>{/if}
                {#if field.secret}
                  <span class="plugin-secret-control"><input type="password" autocomplete="new-password" spellcheck="false" placeholder={isConfigured ? copy.configuredSecret : (field.placeholder || "")} value={secretReplacements[field.key] ?? ""} oninput={(event) => { const value = event.currentTarget.value; secretReplacements = { ...secretReplacements, [field.key]: value }; if (value) { const next = new Set(secretClears); next.delete(field.key); secretClears = next; } }} />{#if isConfigured}<button class="secondary-button danger-action" type="button" onclick={() => { const next = new Set(secretClears); next.add(field.key); secretClears = next; secretReplacements = { ...secretReplacements, [field.key]: "" }; }}>{copy.clearSecret}</button>{/if}</span>
                {:else}<input autocomplete="off" aria-label={labelText} placeholder={field.placeholder || ""} value={String(formValues[field.key] ?? "")} oninput={(event) => formValues = { ...formValues, [field.key]: event.currentTarget.value }} />{/if}
              </label>
            {/each}
          {:else if contractDetail.schema?.properties}
            {#each Object.entries(contractDetail.schema.properties as Record<string, any>) as [propKey, propDef] (propKey)}
              {#if propDef.type === "boolean"}<SettingRow title={propDef.title || propKey} description={propDef.description || ""}><IosSwitch checked={Boolean(formValues[propKey])} ariaLabel={propDef.title || propKey} onCheckedChange={(value) => formValues = { ...formValues, [propKey]: value }} /></SettingRow>
              {:else}<label class="settings-field settings-field-wide"><span>{propDef.title || propKey}</span>{#if propDef.description}<small>{propDef.description}</small>{/if}<input type={propDef.type === "number" ? "number" : "text"} autocomplete="off" value={String(formValues[propKey] ?? "")} oninput={(event) => formValues = { ...formValues, [propKey]: propDef.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value }} /></label>{/if}
            {/each}
          {/if}
        </SettingGroup>
      {:else if contractDetail?.manifest?.settings?.mode === "custom"}
        <SettingGroup contentClass="plugin-custom-card"><iframe bind:this={customFrame} src={desktopPluginSettingsFrameUrl(contractDetail.item.id, contractDetail.manifest.settings.ui.entry)} title={`${contractDetail.item.name} ${copy.settings}`} sandbox="allow-scripts" class="plugin-custom-frame" style:height={`${customFrameHeight}px`}></iframe></SettingGroup>
      {:else if contractDetail}
        <SettingGroup><p class="plugin-empty-state">{copy.noConfiguration}</p></SettingGroup>
      {/if}

      {#if contractDetail}
        <SettingGroup title={copy.storageLifecycle}>
          <SettingRow title={copy.clearCache} description={copy.clearCacheDescription}><button class="secondary-button" type="button" onclick={() => handleLifecycleAction("clear-cache", `${copy.clearCache}?`)}>{copy.clear}</button></SettingRow>
          {#if contractDetail.retainedState.hasConfig}<SettingRow title={copy.deleteConfig} description={copy.deleteConfigDescription}><button class="secondary-button danger-action" type="button" onclick={() => handleLifecycleAction("delete-config", `${copy.deleteConfig}?`)}>{copy.remove}</button></SettingRow>{/if}
          {#if contractDetail.retainedState.hasData}<SettingRow title={copy.deleteData} description={copy.deleteDataDescription}><button class="secondary-button danger-action" type="button" onclick={() => handleLifecycleAction("delete-data", `${copy.deleteData}?`)}>{copy.remove}</button></SettingRow>{/if}
          <SettingRow title={copy.uninstall} description={copy.uninstallDescription}><button class="secondary-button danger-action" type="button" onclick={() => handleLifecycleAction("uninstall", `${copy.uninstall}?`)}>{copy.uninstallAction}</button></SettingRow>
        </SettingGroup>
      {/if}

      {#if coreDetail || contractDetail?.manifest?.settings?.mode === "schema"}
        <div class="settings-footbar"><span class="settings-footbar-label" aria-live="polite">{detailMessage}</span><div class="settings-footbar-actions"><button class="primary-button" type="button" disabled={savingDetail} onclick={coreDetail ? saveCoreSettings : saveContractSettings}>{savingDetail ? copy.saving : copy.save}</button></div></div>
      {/if}
    {/if}
  {/if}
</div>
