<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

  type PluginFieldValue = string | boolean;

  interface PluginSettingField {
    key: string;
    label: string;
    type: "boolean" | "text" | "password" | "select";
    description?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: PluginFieldValue;
    options?: Array<{ value: string; label: string }>;
  }

  interface CatalogEntry {
    kind: "channel" | "provider" | "feature" | "memory-backend";
    key: string;
    name: string;
    version: string;
    description?: string;
    source: "built-in" | "external";
    status: "active" | "error" | "discovered";
    enabled?: boolean;
    manifestPath?: string;
    entryPath?: string;
    error?: string;
    settingsKey?: string;
    settingsFields?: PluginSettingField[];
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "运行时扩展",
      title: "插件设置",
      subtitle: "启用或禁用可选的运行时插件。",
      loading: "加载插件设置中...",
      saving: "保存中...",
      save: "保存插件设置",
      reset: "重置",
      memoryTitle: "记忆后端",
      memoryDesc: "这是一个记忆后端开关，而非渠道插件。`json-file` 保持现有的扁平文件行为。`mory` 将网关切换为基于 SDK 的 SQLite 引擎，但不改变面向智能体的 API。",
      enableMemory: "启用记忆",
      enableMemoryDesc: "开启标准记忆数据库索引与存储。",
      memoryBackendLabel: "记忆后端",
      featureTitle: "功能插件",
      featureDesc: "这些插件用于添加可选的产品功能，而非新的聊天渠道。",
      channelTitle: "渠道插件",
      channelDesc: "内置渠道插件存在于代码库中。外部渠道插件从 DATA_DIR/plugins/channels/*/plugin.json 自动发现。",
      providerTitle: "提供方插件",
      providerDesc: "内置提供方来源于当前代码库。外部提供方清单从 DATA_DIR/plugins/providers/*/plugin.json 自动发现。",
      saved: "插件设置已保存。",
      failedLoad: "加载设置失败",
      failedSave: "保存设置失败",
      builtIn: "内置",
      external: "外部",
      statusActive: "活跃",
      statusDiscovered: "已发现",
      statusError: "错误",
      enabled: "已启用",
      disabled: "已禁用",
      jsonFileLabel: "json-file (内置后端)",
      moryLabel: "mory (SDK 驱动后端)",
      manifestLabel: "清单:",
      entryLabel: "入口:"
    },
    "en-US": {
      eyebrow: "Runtime Extensions",
      title: "Plugin Settings",
      subtitle: "Enable or disable optional runtime plugins.",
      loading: "Loading plugin settings...",
      saving: "Saving...",
      save: "Save Plugin Settings",
      reset: "Reset",
      memoryTitle: "Memory Backend",
      memoryDesc: "This is a memory backend switch, not a channel plugin. json-file keeps the current flat-file behavior. mory switches the gateway to the SDK-backed SQLite engine without changing the agent-facing API.",
      enableMemory: "Enable memory",
      enableMemoryDesc: "Turn on standard memory database indexing and storage.",
      memoryBackendLabel: "Memory backend",
      featureTitle: "Feature Plugins",
      featureDesc: "These plugins add optional product capabilities instead of new chat channels.",
      channelTitle: "Channel Plugins",
      channelDesc: "Built-in channel plugins live in the codebase. External channel plugins are discovered from DATA_DIR/plugins/channels/*/plugin.json.",
      providerTitle: "Provider Plugins",
      providerDesc: "Built-in providers come from the current codebase. External provider manifests are discovered from DATA_DIR/plugins/providers/*/plugin.json.",
      saved: "Plugin settings saved.",
      failedLoad: "Failed to load settings",
      failedSave: "Failed to save settings",
      builtIn: "Built-in",
      external: "External",
      statusActive: "Active",
      statusDiscovered: "Discovered",
      statusError: "Error",
      enabled: "Enabled",
      disabled: "Disabled",
      jsonFileLabel: "json-file (built-in backend)",
      moryLabel: "mory (SDK-backed backend)",
      manifestLabel: "Manifest:",
      entryLabel: "Entry:"
    }
  } as const;

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";
  let channelPlugins: CatalogEntry[] = [];
  let providerPlugins: CatalogEntry[] = [];
  let featurePlugins: CatalogEntry[] = [];
  let memoryBackendCatalog: CatalogEntry[] = [];
  let memoryEnabled = false;
  let memoryBackend = "json-file";
  let featurePluginValues: Record<string, Record<string, PluginFieldValue>> = {};

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function translateSource(source: string): string {
    if (source === "built-in") return copy.builtIn;
    if (source === "external") return copy.external;
    return source;
  }

  function translateStatus(status: string): string {
    if (status === "active") return copy.statusActive;
    if (status === "discovered") return copy.statusDiscovered;
    if (status === "error") return copy.statusError;
    return status;
  }

  function readFeatureFieldValue(settings: any, plugin: CatalogEntry, field: PluginSettingField): PluginFieldValue {
    const pluginSettings = plugin.settingsKey ? settings?.plugins?.[plugin.settingsKey] ?? {} : {};
    if (plugin.key === "cloudflare-html-publish" && field.key === "workerBaseHost") {
      const legacy = pluginSettings?.workerBaseHost ?? pluginSettings?.publicBaseUrl;
      if (legacy !== undefined && legacy !== null && String(legacy).trim()) return String(legacy);
    }
    const raw = pluginSettings?.[field.key];
    if (field.type === "boolean") return raw === undefined ? Boolean(field.defaultValue ?? false) : Boolean(raw);
    if (raw === undefined || raw === null) return typeof field.defaultValue === "string" ? field.defaultValue : "";
    return String(raw);
  }

  function setFeaturePluginDefaults(settings: any): void {
    featurePluginValues = Object.fromEntries(
      featurePlugins.map((plugin) => [
        plugin.key,
        Object.fromEntries((plugin.settingsFields ?? []).map((field) => [field.key, readFeatureFieldValue(settings, plugin, field)])),
      ]),
    );
  }

  function getFeatureValue(pluginKey: string, fieldKey: string): PluginFieldValue {
    return featurePluginValues[pluginKey]?.[fieldKey] ?? "";
  }

  function setFeatureValue(pluginKey: string, fieldKey: string, value: PluginFieldValue): void {
    featurePluginValues = { ...featurePluginValues, [pluginKey]: { ...(featurePluginValues[pluginKey] ?? {}), [fieldKey]: value } };
  }

  function statusVariant(status: string): "default" | "destructive" | "secondary" {
    if (status === "error") return "destructive";
    if (status === "active") return "default";
    return "secondary";
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const pluginRes = await fetch("/api/settings/plugins");
      const pluginData = await pluginRes.json();
      if (!pluginData.ok) throw new Error(pluginData.error || copy.failedLoad);
      memoryEnabled = Boolean(pluginData.plugins?.memory?.enabled);
      memoryBackend = String((pluginData.plugins?.memory as any)?.backend ?? (pluginData.plugins?.memory as any)?.core ?? "json-file");
      channelPlugins = Array.isArray(pluginData.catalog?.channels) ? pluginData.catalog.channels : [];
      providerPlugins = Array.isArray(pluginData.catalog?.providers) ? pluginData.catalog.providers : [];
      featurePlugins = Array.isArray(pluginData.catalog?.features) ? pluginData.catalog.features : [];
      memoryBackendCatalog = Array.isArray(pluginData.catalog?.memoryBackends) ? pluginData.catalog.memoryBackends : [];
      setFeaturePluginDefaults({ plugins: pluginData.plugins });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    message = "";
    error = "";
    try {
      const featurePluginPatch = Object.fromEntries(
        featurePlugins
          .filter((plugin) => plugin.settingsKey)
          .map((plugin) => [
            plugin.settingsKey as string,
            Object.fromEntries(
              (plugin.settingsFields ?? []).map((field) => {
                const value = getFeatureValue(plugin.key, field.key);
                if (field.type === "boolean") return [field.key, Boolean(value)];
                return [field.key, String(value ?? "").trim()];
              }),
            ),
          ]),
      );
      const res = await fetch("/api/settings/plugins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plugins: { memory: { enabled: memoryEnabled, backend: memoryBackend || "json-file" }, ...featurePluginPatch },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedSave);
      message = copy.saved;
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadSettings);
</script>

<div class="channel-page">
  <header class="channel-hero">
    <Badge variant="secondary" class="w-fit">{copy.eyebrow}</Badge>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.subtitle}</p>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">{copy.loading}</p>
  {:else}
    <form id="plugins-form" class="channel-form animate-in fade-in duration-200" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.memoryTitle}</h2>
            <p class="channel-card-desc">{copy.memoryDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-toggle-row">
            <div class="channel-toggle-label">
              <Label for="pl-mem">{copy.enableMemory}</Label>
              <p>{copy.enableMemoryDesc}</p>
            </div>
            <IosSwitch id="pl-mem" bind:checked={memoryEnabled} />
          </div>

          <div class="channel-field pt-2">
            <Label for="pl-backend">{copy.memoryBackendLabel}</Label>
            <NativeSelect id="pl-backend" bind:value={memoryBackend}>
              <NativeSelectOption value="json-file">{copy.jsonFileLabel}</NativeSelectOption>
              <NativeSelectOption value="mory">{copy.moryLabel}</NativeSelectOption>
            </NativeSelect>
          </div>

          <div class="space-y-2 pt-2">
            {#each memoryBackendCatalog as backend}
              <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-foreground">{backend.name}</span>
                  <Badge variant="secondary">{backend.key}</Badge>
                  <Badge variant="secondary">{translateSource(backend.source)}</Badge>
                  <Badge variant={statusVariant(backend.status)}>{translateStatus(backend.status)}</Badge>
                  <span class="text-xs text-muted-foreground">v{backend.version}</span>
                </div>
                {#if backend.description}
                  <p class="mt-2 text-xs text-muted-foreground">{backend.description}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.featureTitle}</h2>
            <p class="channel-card-desc">{copy.featureDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="space-y-2">
            {#each featurePlugins as plugin}
              <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-foreground">{plugin.name}</span>
                  <Badge variant="secondary">{plugin.key}</Badge>
                  <Badge variant="secondary">{translateSource(plugin.source)}</Badge>
                  <Badge variant={statusVariant(plugin.status)}>{translateStatus(plugin.status)}</Badge>
                  <Badge variant={plugin.enabled ? "default" : "secondary"}>{plugin.enabled ? copy.enabled : copy.disabled}</Badge>
                  <span class="text-xs text-muted-foreground">v{plugin.version}</span>
                </div>
                {#if plugin.description}
                  <p class="mt-2 text-xs text-muted-foreground">{plugin.description}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      {#each featurePlugins.filter((plugin) => (plugin.settingsFields?.length ?? 0) > 0) as plugin}
        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h2 class="channel-card-title">{plugin.name}</h2>
              {#if plugin.description}
                <p class="channel-card-desc">{plugin.description}</p>
              {/if}
            </div>
          </div>
          <div class="channel-card-body">
            <div class="grid gap-4 md:grid-cols-2">
              {#each plugin.settingsFields ?? [] as field}
                {#if field.type === "boolean"}
                  <div class="channel-toggle-row md:col-span-2">
                    <div class="channel-toggle-label">
                      <Label for="pl-{plugin.key}-{field.key}">{field.label}</Label>
                      {#if field.description}
                        <p>{field.description}</p>
                      {/if}
                    </div>
                    <IosSwitch
                      id="pl-{plugin.key}-{field.key}"
                      checked={Boolean(getFeatureValue(plugin.key, field.key))}
                      onCheckedChange={(checked) => setFeatureValue(plugin.key, field.key, checked)}
                    />
                  </div>
                {:else if field.type === "select"}
                  <div class="channel-field md:col-span-2">
                    <Label for="pl-{plugin.key}-{field.key}">{field.label}{field.required ? " *" : ""}</Label>
                    <NativeSelect
                      id="pl-{plugin.key}-{field.key}"
                      value={String(getFeatureValue(plugin.key, field.key) ?? "")}
                      onchange={(e) => setFeatureValue(plugin.key, field.key, (e.currentTarget as HTMLSelectElement).value)}
                    >
                      {#each field.options ?? [] as option}
                        <NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>
                      {/each}
                    </NativeSelect>
                    {#if field.description}
                      <span class="channel-hint">{field.description}</span>
                    {/if}
                  </div>
                {:else}
                  <div class="channel-field {field.key === 'objectPrefix' ? 'md:col-span-2' : ''}">
                    <Label for="pl-{plugin.key}-{field.key}">{field.label}{field.required ? " *" : ""}</Label>
                    <Input
                      id="pl-{plugin.key}-{field.key}"
                      value={String(getFeatureValue(plugin.key, field.key) ?? "")}
                      oninput={(e) => setFeatureValue(plugin.key, field.key, (e.currentTarget as HTMLInputElement).value)}
                      placeholder={field.placeholder ?? ""}
                      type={field.type}
                    />
                    {#if field.description}
                      <span class="channel-hint">{field.description}</span>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      {/each}

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.channelTitle}</h2>
            <p class="channel-card-desc">{copy.channelDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="space-y-2">
            {#each channelPlugins as plugin}
              <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-foreground">{plugin.name}</span>
                  <Badge variant="secondary">{plugin.key}</Badge>
                  <Badge variant="secondary">{translateSource(plugin.source)}</Badge>
                  <Badge variant={statusVariant(plugin.status)}>{translateStatus(plugin.status)}</Badge>
                  <span class="text-xs text-muted-foreground">v{plugin.version}</span>
                </div>
                {#if plugin.description}
                  <p class="mt-2 text-xs text-muted-foreground">{plugin.description}</p>
                {/if}
                {#if plugin.manifestPath}
                  <p class="mt-2 text-xs text-muted-foreground font-mono">{copy.manifestLabel} {plugin.manifestPath}</p>
                {/if}
                {#if plugin.entryPath}
                  <p class="mt-1 text-xs text-muted-foreground font-mono">{copy.entryLabel} {plugin.entryPath}</p>
                {/if}
                {#if plugin.error}
                  <p class="mt-2 text-xs text-destructive">{plugin.error}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="channel-card mb-16">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.providerTitle}</h2>
            <p class="channel-card-desc">{copy.providerDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="space-y-2">
            {#each providerPlugins as plugin}
              <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-foreground">{plugin.name}</span>
                  <Badge variant="secondary">{plugin.key}</Badge>
                  <Badge variant="secondary">{translateSource(plugin.source)}</Badge>
                  <Badge variant={statusVariant(plugin.status)}>{translateStatus(plugin.status)}</Badge>
                  <span class="text-xs text-muted-foreground">v{plugin.version}</span>
                </div>
                {#if plugin.description}
                  <p class="mt-2 text-xs text-muted-foreground">{plugin.description}</p>
                {/if}
                {#if plugin.manifestPath}
                  <p class="mt-2 text-xs text-muted-foreground font-mono">{copy.manifestLabel} {plugin.manifestPath}</p>
                {/if}
                {#if plugin.entryPath}
                  <p class="mt-1 text-xs text-muted-foreground font-mono">{copy.entryLabel} {plugin.entryPath}</p>
                {/if}
                {#if plugin.error}
                  <p class="mt-2 text-xs text-destructive">{plugin.error}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    </form>
  {/if}
</div>

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="settings-footbar-saving">
        <span class="settings-footbar-pulse"></span>
        {copy.saving}
      </span>
    {:else if message}
      <span class="settings-footbar-ok">{message}</span>
    {/if}
    {#if error}
      <span class="settings-footbar-error">{error}</span>
    {/if}
  </div>
  <div class="settings-footbar-actions">
    <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>{copy.reset}</Button>
    <button type="submit" form="plugins-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.saving : copy.save}
    </button>
  </div>
</footer>
