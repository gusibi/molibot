<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";
  import PluginCustomFrame from "$lib/components/plugins/PluginCustomFrame.svelte";
  import type { PluginDetailResponse } from "$lib/server/plugins/contract/catalog";

  const COPY = {
    "zh-CN": {
      back: "返回插件列表",
      loading: "加载插件详情中...",
      saving: "保存设置中...",
      saved: "插件设置已保存。",
      failedLoad: "加载失败",
      failedSave: "保存失败",
      notFound: "未找到该插件",
      enablePlugin: "启用插件",
      enablePluginDesc: "在当前主机上启用此插件及其能力。",
      configurationTitle: "插件配置",
      configurationDesc: "此配置仅保存在该插件的独立目录中，不会写入全局设置。",
      noSettingsTitle: "无需额外配置",
      noSettingsDesc: "该插件未声明设置表单或自定义页面，已通过清单注册能力并随时可用。",
      secretsPlaceholderConfigured: "已配置密钥（如需更改请直接输入新值）",
      secretsClear: "清除密钥",
      saveSettings: "保存设置",
      lifecycleTitle: "生命周期与数据管理",
      lifecycleDesc: "管理插件的独立存储、缓存与卸载。",
      clearCache: "清空缓存",
      clearCacheDesc: "安全删除 disposable 缓存文件，不影响配置与用户数据。",
      deleteConfig: "删除配置",
      deleteConfigDesc: "删除 settings.json 与 secrets.json，插件将恢复默认配置状态。",
      deleteData: "删除业务数据",
      deleteDataDesc: "删除插件持有的 durable 业务/领域数据（不可逆）。",
      uninstall: "卸载插件",
      uninstallDesc: "移除插件代码与缓存，默认保留配置与业务数据以便重装。",
      confirmClearCache: "确定清空该插件的缓存文件？",
      confirmDeleteConfig: "确定删除该插件的持久化配置？此操作不可恢复。",
      confirmDeleteData: "确定删除该插件持有的业务数据？此操作不可恢复。",
      confirmUninstall: "确定卸载此插件？代码和缓存将被删除，配置与数据将被保留。"
    },
    "en-US": {
      back: "Back to Plugins",
      loading: "Loading plugin details...",
      saving: "Saving settings...",
      saved: "Settings saved successfully.",
      failedLoad: "Failed to load",
      failedSave: "Failed to save",
      notFound: "Plugin not found",
      enablePlugin: "Enable Plugin",
      enablePluginDesc: "Enable this plugin and its capabilities on this host.",
      configurationTitle: "Configuration",
      configurationDesc: "Stored in the plugin's isolated directory; not in global settings.",
      noSettingsTitle: "No Configuration Required",
      noSettingsDesc: "This plugin has no settings schema or UI; its capabilities are active.",
      secretsPlaceholderConfigured: "Secret configured (type to replace)",
      secretsClear: "Clear Secret",
      saveSettings: "Save Settings",
      lifecycleTitle: "Lifecycle & Storage",
      lifecycleDesc: "Manage plugin data, caches, and uninstall.",
      clearCache: "Clear Cache",
      clearCacheDesc: "Safely remove disposable caches without affecting data or config.",
      deleteConfig: "Delete Config",
      deleteConfigDesc: "Remove settings.json and secrets.json to reset configuration.",
      deleteData: "Delete Domain Data",
      deleteDataDesc: "Permanently delete domain/operational data (irreversible).",
      uninstall: "Uninstall Plugin",
      uninstallDesc: "Remove code and caches. Config and data are retained by default.",
      confirmClearCache: "Are you sure you want to clear this plugin's cache?",
      confirmDeleteConfig: "Are you sure you want to delete stored configuration? Irreversible.",
      confirmDeleteData: "Are you sure you want to delete domain data? Irreversible.",
      confirmUninstall: "Are you sure you want to uninstall this plugin?"
    }
  };

  let pluginId = $derived($page.params.pluginId);
  let currentLocale = $state("zh-CN");
  let currentTheme = $state<"light" | "dark">("light");
  let copy = $derived(COPY[currentLocale === "zh-CN" ? "zh-CN" : "en-US"]);

  let loading = $state(true);
  let detail = $state<PluginDetailResponse | null>(null);
  let actionMessage = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  // Form draft for schema mode
  let formValues = $state<Record<string, unknown>>({});
  let secretReplacements = $state<Record<string, string>>({});
  let secretClears = $state<Set<string>>(new Set());

  async function loadDetail(): Promise<void> {
    loading = true;
    errorMessage = null;
    try {
      const res = await fetch(`/api/settings/plugins/contract/${pluginId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        detail = null;
        errorMessage = data.error || (res.status === 404 ? copy.notFound : copy.failedLoad);
        return;
      }
      const data = await res.json();
      detail = data.detail;
      formValues = { ...(detail?.settingsValues ?? {}) };
      secretReplacements = {};
      secretClears = new Set();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function toggleEnable(nextEnabled: boolean): Promise<void> {
    if (!detail) return;
    try {
      const res = await fetch(`/api/settings/plugins/contract/${pluginId}/enable`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled })
      });
      if (res.ok) {
        detail.item.enabled = nextEnabled;
        detail.item.status = nextEnabled ? "active" : "disabled";
      } else {
        const data = await res.json();
        errorMessage = data.error || "Failed to update enablement";
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveSchemaSettings(): Promise<void> {
    if (!detail) return;
    errorMessage = null;
    actionMessage = null;

    const patch: { values: Record<string, unknown>; secrets: { replace?: Record<string, string>; clear?: string[] } } = {
      values: formValues,
      secrets: {}
    };

    const hasReplacements = Object.keys(secretReplacements).length > 0;
    const hasClears = secretClears.size > 0;
    if (hasReplacements) patch.secrets.replace = secretReplacements;
    if (hasClears) patch.secrets.clear = Array.from(secretClears);

    try {
      const res = await fetch(`/api/settings/plugins/contract/${pluginId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        actionMessage = copy.saved;
        secretReplacements = {};
        secretClears = new Set();
        await loadDetail();
        setTimeout(() => (actionMessage = null), 3000);
      } else {
        const data = await res.json();
        errorMessage = data.error || copy.failedSave;
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function performLifecycle(action: "uninstall" | "clear-cache" | "delete-config" | "delete-data", confirmText: string): Promise<void> {
    if (!confirm(confirmText)) return;
    errorMessage = null;
    actionMessage = null;
    try {
      const res = await fetch(`/api/settings/plugins/contract/${pluginId}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        if (action === "uninstall") {
          await goto("/settings/plugins");
        } else {
          await loadDetail();
        }
      } else {
        const data = await res.json();
        errorMessage = data.error || "Action failed";
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    currentLocale = get(locale);
    const unsub = locale.subscribe((v) => (currentLocale = v));
    const root = document.documentElement;
    const syncTheme = () => (currentTheme = root.classList.contains("dark") ? "dark" : "light");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    void loadDetail();
    return () => {
      unsub();
      observer.disconnect();
    };
  });
</script>

<div class="settings-page">
  <div class="mb-4">
    <Button variant="ghost" size="sm" href="/settings/plugins" class="gap-1 text-xs text-muted-foreground hover:text-foreground">
      &larr; {copy.back}
    </Button>
  </div>

  {#if actionMessage}
    <Alert class="mb-4 border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
      <AlertDescription>{actionMessage}</AlertDescription>
    </Alert>
  {/if}

  {#if errorMessage}
    <Alert variant="destructive" class="mb-4">
      <AlertDescription>{errorMessage}</AlertDescription>
    </Alert>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-sm text-muted-foreground">{copy.loading}</div>
  {:else if detail}
    <!-- Host shell header -->
    <div class="channel-card mb-6">
      <div class="channel-card-body flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div class="flex items-center gap-3">
          {#if detail.item.iconUri}
            <img src={detail.item.iconUri} alt={detail.item.name} class="h-10 w-10 shrink-0 rounded object-contain" />
          {:else}
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted text-base font-bold text-muted-foreground">
              {detail.item.name.charAt(0).toUpperCase()}
            </div>
          {/if}
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-lg font-bold text-foreground">{detail.item.name}</h1>
              <span class="text-xs text-muted-foreground">v{detail.item.version}</span>
              <Badge variant="secondary" class="text-xs">{detail.item.source.kind}</Badge>
              {#if detail.item.status === "error"}
                <Badge variant="destructive" class="text-xs">{detail.item.error || "Error"}</Badge>
              {/if}
            </div>
            {#if detail.item.description}
              <p class="mt-1 text-xs text-muted-foreground">{detail.item.description}</p>
            {/if}
          </div>
        </div>

        <div class="flex items-center gap-4">
          <div class="text-right text-xs">
            <span class="font-medium text-foreground">{copy.enablePlugin}</span>
            <p class="text-muted-foreground">{detail.item.enabled ? "Active" : "Disabled"}</p>
          </div>
          <IosSwitch
            checked={detail.item.enabled}
            onCheckedChange={(val) => toggleEnable(val)}
          />
        </div>
      </div>
    </div>

    <!-- Active Settings Mode -->
    {#if detail.manifest?.settings?.mode === "schema"}
      <div class="channel-card mb-6">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.configurationTitle}</h2>
            <p class="channel-card-desc">{copy.configurationDesc}</p>
          </div>
        </div>
        <div class="channel-card-body space-y-4">
          {#if detail.presentation && detail.presentation.length > 0}
            {#each detail.presentation as field (field.key)}
              {@const labelText = field.label[currentLocale === "zh-CN" ? "zh" : "en"] || field.label.zh}
              {@const descText = field.description ? (field.description[currentLocale === "zh-CN" ? "zh" : "en"] || field.description.zh) : ""}
              {@const isSecret = field.secret === true}
              {@const isConfigured = Boolean(detail.secretsPresence?.[field.key]?.present)}

              <div class="channel-field">
                <Label for="field-{field.key}">{labelText}</Label>
                {#if descText}
                  <p class="text-xs text-muted-foreground">{descText}</p>
                {/if}

                {#if isSecret}
                  <div class="mt-1 flex items-center gap-2">
                    <Input
                      id="field-{field.key}"
                      type="password"
                      placeholder={isConfigured ? copy.secretsPlaceholderConfigured : (field.placeholder || "")}
                      value={secretReplacements[field.key] ?? ""}
                      oninput={(e) => {
                        const val = (e.target as HTMLInputElement).value;
                        if (val) {
                          secretReplacements[field.key] = val;
                          secretClears.delete(field.key);
                        } else {
                          delete secretReplacements[field.key];
                        }
                      }}
                      class="text-xs"
                    />
                    {#if isConfigured}
                      <Button
                        variant="outline"
                        size="sm"
                        onclick={() => {
                          secretClears.add(field.key);
                          delete secretReplacements[field.key];
                        }}
                        class="shrink-0 text-xs text-destructive hover:bg-destructive/10"
                      >
                        {copy.secretsClear}
                      </Button>
                    {/if}
                  </div>
                {:else}
                  <div class="mt-1">
                    <Input
                      id="field-{field.key}"
                      type="text"
                      placeholder={field.placeholder || ""}
                      value={String(formValues[field.key] ?? "")}
                      oninput={(e) => (formValues[field.key] = (e.target as HTMLInputElement).value)}
                      class="text-xs"
                    />
                  </div>
                {/if}
              </div>
            {/each}
          {:else if detail.schema && detail.schema.properties}
            {#each Object.entries(detail.schema.properties as Record<string, any>) as [propKey, propDef]}
              <div class="channel-field">
                <Label for="prop-{propKey}">{propDef.title || propKey}</Label>
                {#if propDef.description}
                  <p class="text-xs text-muted-foreground">{propDef.description}</p>
                {/if}
                <div class="mt-1">
                  {#if propDef.type === "boolean"}
                    <IosSwitch
                      id="prop-{propKey}"
                      checked={Boolean(formValues[propKey])}
                      onCheckedChange={(val) => (formValues[propKey] = val)}
                    />
                  {:else}
                    <Input
                      id="prop-{propKey}"
                      type={propDef.type === "number" ? "number" : "text"}
                      value={String(formValues[propKey] ?? "")}
                      oninput={(e) => (formValues[propKey] = propDef.type === "number" ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value)}
                      class="text-xs"
                    />
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {:else if detail.manifest?.settings?.mode === "custom"}
      <!-- Custom mode container with isolated sandboxed iframe -->
      <div class="channel-card mb-6">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.configurationTitle}</h2>
            <p class="channel-card-desc">{copy.configurationDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <PluginCustomFrame
            pluginId={detail.item.id}
            pluginVersion={detail.item.version}
            uiEntry={detail.manifest.settings.ui.entry}
            locale={currentLocale === "zh-CN" ? "zh-CN" : "en-US"}
            theme={currentTheme}
            enabled={detail.item.enabled}
            onSaved={() => {
              actionMessage = copy.saved;
              setTimeout(() => (actionMessage = null), 3000);
            }}
          />
        </div>
      </div>
    {:else}
      <!-- No settings declared -->
      <div class="channel-card mb-6">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.noSettingsTitle}</h2>
            <p class="channel-card-desc">{copy.noSettingsDesc}</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Lifecycle and Retained Data Management -->
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.lifecycleTitle}</h2>
          <p class="channel-card-desc">{copy.lifecycleDesc}</p>
        </div>
      </div>
      <div class="channel-card-body space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div>
            <span class="text-xs font-semibold text-foreground">{copy.clearCache}</span>
            <p class="text-[11px] text-muted-foreground">{copy.clearCacheDesc}</p>
          </div>
          <Button variant="outline" size="sm" onclick={() => performLifecycle("clear-cache", copy.confirmClearCache)} class="text-xs">
            {copy.clearCache}
          </Button>
        </div>

        {#if detail.retainedState.hasConfig}
          <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div>
              <span class="text-xs font-semibold text-foreground">{copy.deleteConfig}</span>
              <p class="text-[11px] text-muted-foreground">{copy.deleteConfigDesc}</p>
            </div>
            <Button variant="outline" size="sm" onclick={() => performLifecycle("delete-config", copy.confirmDeleteConfig)} class="text-xs text-destructive hover:bg-destructive/10">
              {copy.deleteConfig}
            </Button>
          </div>
        {/if}

        {#if detail.retainedState.hasData}
          <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div>
              <span class="text-xs font-semibold text-foreground">{copy.deleteData}</span>
              <p class="text-[11px] text-muted-foreground">{copy.deleteDataDesc}</p>
            </div>
            <Button variant="outline" size="sm" onclick={() => performLifecycle("delete-data", copy.confirmDeleteData)} class="text-xs text-destructive hover:bg-destructive/10">
              {copy.deleteData}
            </Button>
          </div>
        {/if}

        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div>
            <span class="text-xs font-semibold text-destructive">{copy.uninstall}</span>
            <p class="text-[11px] text-muted-foreground">{copy.uninstallDesc}</p>
          </div>
          <Button variant="destructive" size="sm" onclick={() => performLifecycle("uninstall", copy.confirmUninstall)} class="text-xs">
            {copy.uninstall}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  {#if detail?.manifest?.settings?.mode === "schema"}
    <!-- Fixed save footbar per DESIGN.md -->
    <div class="settings-footbar">
      <div class="settings-footbar-inner">
        <Button onclick={saveSchemaSettings} disabled={loading}>
          {copy.saveSettings}
        </Button>
      </div>
    </div>
  {/if}
</div>
