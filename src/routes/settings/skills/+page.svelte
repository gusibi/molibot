<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

  type SkillScope = "global" | "chat" | "bot";

  interface SkillItem {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    scope: SkillScope;
    enabled: boolean;
    mcpServers: string[];
    botId?: string;
    chatId?: string;
  }

  interface SkillSearchSettings {
    local: { enabled: boolean };
    api: {
      enabled: boolean;
      provider: string;
      model: string;
      maxTokens: number;
      temperature: number;
      timeoutMs: number;
      minConfidence: number;
    };
  }

  interface SearchProviderItem {
    id: string;
    name: string;
    defaultModel: string;
    models: string[];
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "能力索引",
      title: "技能",
      desc: "检查已安装的技能，并配置运行时技能搜索。",
      btnRefresh: "刷新",
      loading: "正在加载技能...",
      searchTitle: "技能搜索",
      searchDesc: "选择运行时应当搜索本地技能、调用外部路由模型，还是两者兼有。",
      localLabel: "启用本地搜索",
      apiLabel: "启用 API 搜索",
      providerLabel: "AI 提供方",
      modelLabel: "模型",
      maxTokensLabel: "最大 Token 数",
      tempLabel: "温度",
      timeoutLabel: "超时（毫秒）",
      confidenceLabel: "最低置信度",
      apiHint: "技能搜索 API 现已复用您在 设置 / AI / 提供商 下配置的 AI 提供方。",
      currentProvider: "当前提供方：",
      noProvider: "尚未找到可复用的 AI 提供方。请先在 设置 / AI / 提供商 中添加并启用一个。",
      dataRoot: "数据根目录：",
      globalSkills: "全局技能：",
      globalCount: "全局",
      chatCount: "会话",
      botCount: "Bot",
      totalCount: "总数",
      scopeGlobalTitle: "全局技能",
      scopeChatTitle: "会话技能",
      scopeBotTitle: "Bot 技能",
      scopeGlobalDesc: "注册在全局作用域的技能。",
      scopeChatDesc: "注册在会话作用域的技能。",
      scopeBotDesc: "注册在 Bot 作用域的技能。",
      noSkills: "未找到 {scope} 级别的技能。",
      enabled: "已启用",
      disabled: "已禁用",
      path: "路径：",
      saving: "保存中...",
      savingConfig: "正在保存变更...",
      saveBtn: "保存技能搜索",
      resetBtn: "重置",
      failedLoad: "加载技能失败",
      failedSaveStatus: "保存技能状态失败",
      failedSaveConfig: "保存技能搜索配置失败",
      loadedMsg: "已加载 {count} 个技能。",
      statusUpdated: "技能状态已更新。",
      configUpdated: "技能搜索配置已更新。"
    },
    "en-US": {
      eyebrow: "Capability Index",
      title: "Skills",
      desc: "Inspect installed skills and configure runtime skill search.",
      btnRefresh: "Refresh",
      loading: "Loading skills...",
      searchTitle: "Skill Search",
      searchDesc: "Choose whether runtime should search local skills, call an external routing model, or both.",
      localLabel: "Enable local search",
      apiLabel: "Enable API search",
      providerLabel: "AI Provider",
      modelLabel: "Model",
      maxTokensLabel: "Max Tokens",
      tempLabel: "Temperature",
      timeoutLabel: "Timeout (ms)",
      confidenceLabel: "Min Confidence",
      apiHint: "Skill Search API now reuses the AI Provider you already configured under Settings / AI / Providers.",
      currentProvider: "Current provider: ",
      noProvider: "No reusable AI Provider found yet. Add and enable one in Settings / AI / Providers first.",
      dataRoot: "Data root: ",
      globalSkills: "Global skills: ",
      globalCount: "Global",
      chatCount: "Chat",
      botCount: "Bot",
      totalCount: "Total",
      scopeGlobalTitle: "Global Skills",
      scopeChatTitle: "Chat Skills",
      scopeBotTitle: "Bot Skills",
      scopeGlobalDesc: "Skills registered under global scope.",
      scopeChatDesc: "Skills registered under chat scope.",
      scopeBotDesc: "Skills registered under bot scope.",
      noSkills: "No {scope}-level skills found.",
      enabled: "Enabled",
      disabled: "Disabled",
      path: "Path: ",
      saving: "Saving...",
      savingConfig: "Saving changes...",
      saveBtn: "Save Skill Search",
      resetBtn: "Reset",
      failedLoad: "Failed to load skills",
      failedSaveStatus: "Failed to save skill status",
      failedSaveConfig: "Failed to save skill search settings",
      loadedMsg: "Loaded {count} skill(s).",
      statusUpdated: "Skill status updated.",
      configUpdated: "Skill search settings updated."
    }
  } as const;

  let loading = true;
  let savingConfig = false;
  let error = "";
  let message = "";
  let dataRoot = "";
  let globalSkillsDir = "";
  let diagnostics: string[] = [];
  let items: SkillItem[] = [];
  let searchProviders: SearchProviderItem[] = [];
  let count = { global: 0, chat: 0, bot: 0 };
  let saving = new Set<string>();
  let skillSearch: SkillSearchSettings = {
    local: { enabled: false },
    api: {
      enabled: false,
      provider: "",
      model: "",
      maxTokens: 400,
      temperature: 0,
      timeoutMs: 8000,
      minConfidence: 0.6
    }
  };

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function byScope(scope: SkillScope): SkillItem[] {
    return items.filter((item) => item.scope === scope).sort((a, b) => a.name.localeCompare(b.name));
  }

  function normalizeSkillSearchSettings(input: unknown): SkillSearchSettings {
    const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const local = source.local && typeof source.local === "object" ? source.local as Record<string, unknown> : {};
    const api = source.api && typeof source.api === "object" ? source.api as Record<string, unknown> : {};
    return {
      local: { enabled: Boolean(local.enabled) },
      api: {
        enabled: Boolean(api.enabled),
        provider: String(api.provider ?? ""),
        model: String(api.model ?? ""),
        maxTokens: Number(api.maxTokens ?? 400) || 400,
        temperature: Number(api.temperature ?? 0) || 0,
        timeoutMs: Number(api.timeoutMs ?? 8000) || 8000,
        minConfidence: Number(api.minConfidence ?? 0.6) || 0.6
      }
    };
  }

  function findProvider(providerId: string): SearchProviderItem | null {
    return searchProviders.find((provider) => provider.id === providerId) ?? null;
  }

  function syncSkillSearchProviderSelection(): void {
    const provider = findProvider(skillSearch.api.provider)
      ?? searchProviders.find((item) => item.id === skillSearch.api.provider)
      ?? searchProviders[0] ?? null;
    if (!provider) {
      if (!skillSearch.api.provider && !skillSearch.api.model) return;
      skillSearch = { ...skillSearch, api: { ...skillSearch.api, provider: "", model: "" } };
      return;
    }
    const model = provider.models.includes(skillSearch.api.model)
      ? skillSearch.api.model
      : (provider.defaultModel || provider.models[0] || "");
    if (provider.id === skillSearch.api.provider && model === skillSearch.api.model) return;
    skillSearch = { ...skillSearch, api: { ...skillSearch.api, provider: provider.id, model } };
  }

  async function loadSkills(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skills");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      dataRoot = String(data.dataRoot ?? "");
      globalSkillsDir = String(data.globalSkillsDir ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      searchProviders = Array.isArray(data.searchProviders) ? data.searchProviders : [];
      skillSearch = normalizeSkillSearchSettings(data.skillSearch);
      syncSkillSearchProviderSelection();
      count = {
        global: Number(data.count?.global ?? 0),
        chat: Number(data.count?.chat ?? 0),
        bot: Number(data.count?.bot ?? 0),
      };
      message = copy.loadedMsg.replace("{count}", String(items.length));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function persistSkillsState(nextItems: SkillItem[]): Promise<void> {
    const disabledSkillPaths = nextItems.filter((item) => !item.enabled).map((item) => item.filePath);
    const res = await fetch("/api/settings/skills", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabledSkillPaths })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || copy.failedSaveStatus);
  }

  async function setSkillEnabled(filePath: string, enabled: boolean): Promise<void> {
    error = "";
    message = "";
    const prev = items;
    const nextItems = items.map((item) => item.filePath === filePath ? { ...item, enabled } : item);
    items = nextItems;
    saving = new Set([...saving, filePath]);
    try {
      await persistSkillsState(nextItems);
      message = copy.statusUpdated;
    } catch (e) {
      items = prev;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      const next = new Set(saving);
      next.delete(filePath);
      saving = next;
    }
  }

  async function saveSkillSearchConfig(): Promise<void> {
    savingConfig = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillSearch })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedSaveConfig);
      skillSearch = normalizeSkillSearchSettings(data.skillSearch ?? skillSearch);
      message = copy.configUpdated;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      savingConfig = false;
    }
  }

  $: selectedSearchProvider = findProvider(skillSearch.api.provider);
  $: selectedSearchProviderModels = selectedSearchProvider?.models ?? [];
  $: if (!loading) { syncSkillSearchProviderSelection(); }

  onMount(loadSkills);
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  <div class="channel-card">
    <div class="channel-card-body">
      <div style="display: flex; gap: 0.5rem;">
        <Button variant="outline" onclick={loadSkills}>{copy.btnRefresh}</Button>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <form id="skills-form" class="channel-form" onsubmit={(e) => { e.preventDefault(); void saveSkillSearchConfig(); }}>
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.searchTitle}</h2>
            <p class="channel-card-desc">{copy.searchDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field-row" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="channel-toggle-row">
              <div class="channel-toggle-label">
                <Label for="sk-local">{copy.localLabel}</Label>
              </div>
              <IosSwitch id="sk-local" bind:checked={skillSearch.local.enabled} />
            </div>
            <div class="channel-toggle-row">
              <div class="channel-toggle-label">
                <Label for="sk-api">{copy.apiLabel}</Label>
              </div>
              <IosSwitch id="sk-api" bind:checked={skillSearch.api.enabled} />
            </div>
          </div>

          <div class="channel-field-row" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="channel-field">
              <Label for="sk-provider">{copy.providerLabel}</Label>
              <NativeSelect id="sk-provider" bind:value={skillSearch.api.provider}>
                {#if searchProviders.length === 0}
                  <NativeSelectOption value="">{copy.noProvider}</NativeSelectOption>
                {:else}
                  {#each searchProviders as provider}
                    <NativeSelectOption value={provider.id}>{provider.name}</NativeSelectOption>
                  {/each}
                {/if}
              </NativeSelect>
            </div>
            <div class="channel-field">
              <Label for="sk-model">{copy.modelLabel}</Label>
              <NativeSelect id="sk-model" bind:value={skillSearch.api.model} disabled={selectedSearchProviderModels.length === 0}>
                {#if selectedSearchProviderModels.length === 0}
                  <NativeSelectOption value="">{copy.noProvider}</NativeSelectOption>
                {:else}
                  {#each selectedSearchProviderModels as model}
                    <NativeSelectOption value={model}>{model}</NativeSelectOption>
                  {/each}
                {/if}
              </NativeSelect>
            </div>
          </div>

          <div class="channel-field-row" style="grid-template-columns: repeat(4, 1fr); gap: 1rem;">
            <div class="channel-field">
              <Label for="sk-max-tokens">{copy.maxTokensLabel}</Label>
              <Input id="sk-max-tokens" type="number" min="128" max="4096" bind:value={skillSearch.api.maxTokens} />
            </div>
            <div class="channel-field">
              <Label for="sk-temp">{copy.tempLabel}</Label>
              <Input id="sk-temp" type="number" min="0" max="1" step="0.1" bind:value={skillSearch.api.temperature} />
            </div>
            <div class="channel-field">
              <Label for="sk-timeout">{copy.timeoutLabel}</Label>
              <Input id="sk-timeout" type="number" min="1000" max="60000" step="500" bind:value={skillSearch.api.timeoutMs} />
            </div>
            <div class="channel-field">
              <Label for="sk-confidence">{copy.confidenceLabel}</Label>
              <Input id="sk-confidence" type="number" min="0" max="1" step="0.05" bind:value={skillSearch.api.minConfidence} />
            </div>
          </div>

          <div class="channel-hint" style="background: var(--muted); padding: 0.75rem; border-radius: 6px;">
            {copy.apiHint}
            {#if selectedSearchProvider}
              <div style="margin-top: 0.25rem;">{copy.currentProvider}<span style="font-weight: 500; color: var(--foreground);">{selectedSearchProvider.name}</span></div>
            {/if}
            {#if searchProviders.length === 0}
              <div style="margin-top: 0.25rem; color: var(--destructive);">{copy.noProvider}</div>
            {/if}
          </div>
        </div>
      </div>
    </form>

    <div class="channel-card">
      <div class="channel-card-body" style="gap: 0.5rem;">
        <div class="channel-sidebar-btn-id">
          {copy.dataRoot}{dataRoot || "(unknown)"} | {copy.globalSkills}{globalSkillsDir || "(unknown)"}
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <Badge variant="outline">{copy.globalCount}: {count.global}</Badge>
          <Badge variant="outline">{copy.chatCount}: {count.chat}</Badge>
          <Badge variant="outline">{copy.botCount}: {count.bot}</Badge>
          <Badge variant="outline">{copy.totalCount}: {items.length}</Badge>
        </div>
      </div>
    </div>

    {#each ["global", "chat", "bot"] as scope}
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">
              {scope === "global" ? copy.scopeGlobalTitle : scope === "chat" ? copy.scopeChatTitle : copy.scopeBotTitle}
            </h2>
            <p class="channel-card-desc">
              {scope === "global" ? copy.scopeGlobalDesc : scope === "chat" ? copy.scopeChatDesc : copy.scopeBotDesc}
            </p>
          </div>
        </div>
        <div class="channel-card-body" style="gap: 1rem;">
          {#if byScope(scope as SkillScope).length === 0}
            <div class="channel-hint">
              {copy.noSkills.replace("{scope}", scope === "global" ? copy.globalCount : scope === "chat" ? copy.chatCount : copy.botCount)}
            </div>
          {:else}
            {#each byScope(scope as SkillScope) as item}
              <div class="channel-card" style="padding: 1rem; background: var(--muted-soft, color-mix(in oklab, var(--muted) 4%, transparent)); border-color: var(--border);">
                <div class="channel-card-body" style="gap: 0.5rem;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span class="channel-sidebar-btn-name">{item.name}</span>
                    <div class="channel-toggle-row" style="border: none; padding: 0;">
                      <Label for={`toggle-${item.filePath}`} style="font-size: 0.75rem; margin-right: 0.5rem;">
                        {item.enabled ? copy.enabled : copy.disabled}
                      </Label>
                      <IosSwitch
                        id={`toggle-${item.filePath}`}
                        checked={item.enabled}
                        disabled={saving.has(item.filePath)}
                        onCheckedChange={(checked) => setSkillEnabled(item.filePath, checked)}
                      />
                    </div>
                  </div>
                  <div class="channel-sidebar-btn-id">{item.description}</div>
                  <div class="channel-hint">{copy.path}{item.filePath}</div>
                  {#if item.mcpServers?.length > 0}
                    <div style="font-size: 0.75rem; color: var(--primary); font-weight: 500;">
                      MCP: {item.mcpServers.join(", ")}
                    </div>
                  {/if}
                  {#if scope !== "global"}
                    <div class="channel-sidebar-btn-id">
                      {scope === "chat" ? `${copy.botCount}: ${item.botId || "-"} | ${copy.chatCount}: ${item.chatId || "-"}` : `${copy.botCount}: ${item.botId || "-"}`}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/each}

    {#if diagnostics.length > 0}
      <div class="channel-card" style="border-color: var(--destructive); background: color-mix(in oklab, var(--destructive) 4%, transparent);">
        <div class="channel-card-header">
          <h2 class="channel-card-title" style="color: var(--destructive);">Diagnostics</h2>
        </div>
        <div class="channel-card-body">
          {#each diagnostics as row}
            <div class="channel-hint" style="color: var(--destructive);">{row}</div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if !loading}
  <footer class="settings-footbar">
    <div class="settings-footbar-status">
      {#if savingConfig}
        <span class="settings-footbar-saving">
          <span class="settings-footbar-pulse"></span>
          {copy.savingConfig}
        </span>
      {:else if message}
        <span class="settings-footbar-ok">{message}</span>
      {/if}
      {#if error}
        <span class="settings-footbar-error">{error}</span>
      {/if}
    </div>
    <div class="settings-footbar-actions">
      <Button variant="outline" size="sm" onclick={loadSkills} disabled={loading || savingConfig}>
        {copy.resetBtn}
      </Button>
      <button type="submit" form="skills-form" class="settings-footbar-btn" disabled={loading || savingConfig}>
        {savingConfig ? copy.saving : copy.saveBtn}
      </button>
    </div>
  </footer>
{/if}
