<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";
  import type { PluginCatalogItem } from "$lib/server/plugins/contract/catalog";

  interface CorePluginItem {
    id: "memory" | "daily-materials";
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    settingsHref: string;
    source: { kind: "builtin" };
  }

  interface ManagedPluginItem extends PluginCatalogItem {
    management: "contract" | "core";
    settingsHref: string;
  }

  interface ExtensionEntry {
    id: string;
    name: string;
    version: string;
    description?: string;
    enabled: boolean;
    toolNames: string[];
    eventNames: string[];
    commandNames: string[];
    unsupported: string[];
    error?: string;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "运行时扩展",
      title: "插件",
      subtitle: "管理插件是否启用；每个 Molibot 插件在独立页面中管理自己的配置与数据。",
      loading: "加载插件列表中...",
      failedLoad: "加载插件失败",
      searchPlaceholder: "搜索插件名称或描述...",
      noPlugins: "未发现 Molibot 插件。请检查插件目录或下方的错误信息。",
      noPluginsMatch: "没有匹配的插件",
      configure: "设置",
      details: "详情",
      statusError: "异常",
      sourceBuiltin: "内置",
      sourceDirectory: "外置目录",
      installedPluginsTitle: "Molibot 插件",
      installedPluginsDesc: "内置插件随 Molibot 自动安装；外置插件由插件目录提供代码与设置页面。此处统一提供入口和启用开关。",
      memoryName: "记忆后端",
      memoryDesc: "管理记忆存储、反思时间和向量检索配置。",
      dailyName: "每日素材 / 每日回顾",
      dailyDesc: "从已授权会话提取每日素材并写入指定项目。",
      extTitle: "pi 扩展（兼容插件）",
      extDesc: "安装 pi 生态扩展。它们可以提供工具、事件与命令，但不提供 Molibot 独立设置页面。",
      extMaster: "启用 pi 扩展",
      extMasterDesc: "关闭后，所有已安装的 pi 扩展均不生效。",
      extSpecLabel: "包名或链接",
      extSpecPlaceholder: "npm 包名、npm 链接或 GitHub 仓库地址",
      extSpecHint: "支持 npm 包、npm 页面、GitHub 仓库及仓库子目录链接。",
      extInstall: "安装",
      extInstalling: "处理中...",
      extReload: "重新加载",
      extUninstall: "卸载",
      extEmpty: "尚未安装 pi 扩展。",
      extTools: "工具",
      extEvents: "事件",
      extCommands: "命令",
      extUnsupported: "不支持的终端 UI 能力",
      extInstalled: "扩展安装完成。",
      extUninstalled: "扩展已卸载。",
      extReloaded: "扩展已重新加载。",
      extConfirmUninstall: "确定卸载这个扩展吗？"
    },
    "en-US": {
      eyebrow: "Runtime Extensions",
      title: "Plugins",
      subtitle: "Manage enablement here; each Molibot plugin owns its configuration and data on a dedicated page.",
      loading: "Loading plugins...",
      failedLoad: "Failed to load plugins",
      searchPlaceholder: "Search plugin name or description...",
      noPlugins: "No Molibot plugins were discovered. Check the plugin directory or the error below.",
      noPluginsMatch: "No matching plugins",
      configure: "Configure",
      details: "Details",
      statusError: "Error",
      sourceBuiltin: "Built-in",
      sourceDirectory: "External directory",
      installedPluginsTitle: "Molibot Plugins",
      installedPluginsDesc: "Built-in plugins ship with Molibot; external plugins provide code and settings pages from their package directories. This page provides entry points and enablement.",
      memoryName: "Memory Backend",
      memoryDesc: "Manage memory storage, reflection timing, and vector retrieval settings.",
      dailyName: "Daily Materials / Review",
      dailyDesc: "Extract daily material from authorized conversations and write it to a project.",
      extTitle: "pi Extensions (Compatibility)",
      extDesc: "Install pi ecosystem extensions. They may provide tools, events, and commands, but do not provide Molibot settings pages.",
      extMaster: "Enable pi extensions",
      extMasterDesc: "When disabled, no installed pi extension is active.",
      extSpecLabel: "Package or link",
      extSpecPlaceholder: "npm package, npm link, or GitHub repository",
      extSpecHint: "Accepts npm packages, npm pages, GitHub repositories, and repository subdirectory links.",
      extInstall: "Install",
      extInstalling: "Working...",
      extReload: "Reload",
      extUninstall: "Uninstall",
      extEmpty: "No pi extensions installed.",
      extTools: "Tools",
      extEvents: "Events",
      extCommands: "Commands",
      extUnsupported: "Unsupported terminal UI capabilities",
      extInstalled: "Extension installed.",
      extUninstalled: "Extension uninstalled.",
      extReloaded: "Extensions reloaded.",
      extConfirmUninstall: "Uninstall this extension?"
    }
  } as const;

  let currentLocale = $state<"zh-CN" | "en-US">("zh-CN");
  let copy = $derived(COPY[currentLocale]);
  let loading = $state(true);
  let errorMessage = $state("");
  let actionMessage = $state("");
  let searchQuery = $state("");
  let contractPlugins = $state<PluginCatalogItem[]>([]);
  let corePlugins = $state<CorePluginItem[]>([]);
  let extensions = $state<ExtensionEntry[]>([]);
  let extensionsMaster = $state(true);
  let extensionSpec = $state("");
  let extensionBusy = $state(false);

  let installedPlugins = $derived<ManagedPluginItem[]>([
    ...corePlugins.map((item) => ({
      ...item,
      name: item.id === "memory" ? copy.memoryName : copy.dailyName,
      description: item.id === "memory" ? copy.memoryDesc : copy.dailyDesc,
      status: item.enabled ? "active" as const : "disabled" as const,
      hasSettings: true,
      capabilities: [],
      management: "core" as const
    })),
    ...contractPlugins.map((item) => ({
      ...item,
      management: "contract" as const,
      settingsHref: `/settings/plugins/${item.id}`
    }))
  ]);

  let filteredPlugins = $derived(
    installedPlugins.filter((item) => {
      const query = searchQuery.trim().toLowerCase();
      return !query || item.name.toLowerCase().includes(query) || item.id.includes(query) || item.description?.toLowerCase().includes(query);
    })
  );

  async function responseJson(response: Response): Promise<any> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `${response.status} ${response.statusText}`);
    return data;
  }

  function sourceLabel(kind: PluginCatalogItem["source"]["kind"]): string {
    if (kind === "builtin") return copy.sourceBuiltin;
    if (kind === "directory") return copy.sourceDirectory;
    return kind;
  }

  async function loadAll(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const [coreResponse, contractResponse, extensionsResponse] = await Promise.all([
        fetch("/api/settings/plugins/core"),
        fetch("/api/settings/plugins/contract"),
        fetch("/api/settings/plugins/extensions")
      ]);
      const coreData = await responseJson(coreResponse);
      const contractData = await responseJson(contractResponse);
      const extensionsData = await responseJson(extensionsResponse);
      corePlugins = Array.isArray(coreData.items) ? coreData.items : [];
      contractPlugins = Array.isArray(contractData.items) ? contractData.items : [];
      extensions = Array.isArray(extensionsData.extensions) ? extensionsData.extensions : [];
      extensionsMaster = extensionsData.masterEnabled !== false;
    } catch (error) {
      errorMessage = `${copy.failedLoad}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      loading = false;
    }
  }

  async function togglePluginEnabled(plugin: ManagedPluginItem, enabled: boolean): Promise<void> {
    errorMessage = "";
    try {
      const endpoint = plugin.management === "core"
        ? `/api/settings/plugins/core/${plugin.id}/enable`
        : `/api/settings/plugins/contract/${plugin.id}/enable`;
      await responseJson(await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      }));
      if (plugin.management === "core") {
        corePlugins = corePlugins.map((item) => item.id === plugin.id ? { ...item, enabled } : item);
      } else {
        contractPlugins = contractPlugins.map((item) => item.id === plugin.id
          ? { ...item, enabled, status: enabled ? "active" : "disabled" }
          : item);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  async function extensionAction(body: Record<string, unknown>, successMessage = ""): Promise<void> {
    if (extensionBusy) return;
    extensionBusy = true;
    errorMessage = "";
    actionMessage = "";
    try {
      const data = await responseJson(await fetch("/api/settings/plugins/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }));
      extensions = Array.isArray(data.extensions) ? data.extensions : extensions;
      if (typeof data.masterEnabled === "boolean") extensionsMaster = data.masterEnabled;
      actionMessage = successMessage;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      extensionBusy = false;
    }
  }

  async function installExtension(): Promise<void> {
    const input = extensionSpec.trim();
    if (!input) return;
    await extensionAction({ action: "install", input }, copy.extInstalled);
    if (!errorMessage) extensionSpec = "";
  }

  async function uninstallExtension(id: string): Promise<void> {
    if (!confirm(copy.extConfirmUninstall)) return;
    await extensionAction({ action: "uninstall", id }, copy.extUninstalled);
  }

  onMount(() => {
    currentLocale = get(locale) === "zh-CN" ? "zh-CN" : "en-US";
    const unsubscribe = locale.subscribe((value) => (currentLocale = value === "zh-CN" ? "zh-CN" : "en-US"));
    void loadAll();
    return unsubscribe;
  });
</script>

<div class="channel-page">
  <header class="channel-hero">
    <Badge variant="secondary" class="w-fit">{copy.eyebrow}</Badge>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.subtitle}</p>
  </header>

  {#if actionMessage}<Alert class="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><AlertDescription>{actionMessage}</AlertDescription></Alert>{/if}
  {#if errorMessage}<Alert variant="destructive"><AlertDescription class="whitespace-pre-wrap">{errorMessage}</AlertDescription></Alert>{/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">{copy.loading}</p>
  {:else}
    <div class="channel-form animate-in fade-in duration-200">
      <section class="channel-card">
        <div class="channel-card-header">
          <div class="flex w-full flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div><h2 class="channel-card-title">{copy.installedPluginsTitle}</h2><p class="channel-card-desc">{copy.installedPluginsDesc}</p></div>
            <Input type="search" placeholder={copy.searchPlaceholder} bind:value={searchQuery} class="h-9 w-full sm:w-64" />
          </div>
        </div>
        <div class="channel-card-body">
          {#if installedPlugins.length === 0}
            <p class="py-8 text-center text-sm text-muted-foreground">{copy.noPlugins}</p>
          {:else if filteredPlugins.length === 0}
            <p class="py-8 text-center text-sm text-muted-foreground">{copy.noPluginsMatch}</p>
          {:else}
            <div class="divide-y divide-border overflow-hidden rounded-lg border">
              {#each filteredPlugins as plugin (plugin.id)}
                <div class="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-muted/30">
                  <div class="flex min-w-0 items-center gap-3">
                    {#if plugin.iconUri}<img src={plugin.iconUri} alt="" class="h-8 w-8 shrink-0 rounded object-contain" />{:else}<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-sm font-semibold text-muted-foreground">{plugin.name.charAt(0).toUpperCase()}</div>{/if}
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2"><a href={plugin.settingsHref} class="font-medium text-foreground hover:underline">{plugin.name}</a>{#if plugin.version !== "built-in"}<span class="text-xs text-muted-foreground">v{plugin.version}</span>{/if}<Badge variant="secondary" class="px-1 py-0 text-[10px]">{sourceLabel(plugin.source.kind)}</Badge>{#if plugin.status === "error"}<Badge variant="destructive" class="px-1 py-0 text-[10px]">{copy.statusError}</Badge>{/if}</div>
                      {#if plugin.description}<p class="truncate text-xs text-muted-foreground">{plugin.description}</p>{/if}
                      {#if plugin.error}<p class="truncate text-xs text-destructive">{plugin.error}</p>{/if}
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-3"><IosSwitch checked={plugin.enabled} onCheckedChange={(value) => togglePluginEnabled(plugin, value)} /><Button variant="outline" size="sm" href={plugin.settingsHref}>{plugin.hasSettings ? copy.configure : copy.details}</Button></div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>

      <section class="channel-card">
        <div class="channel-card-header"><div><h2 class="channel-card-title">{copy.extTitle}</h2><p class="channel-card-desc">{copy.extDesc}</p></div></div>
        <div class="channel-card-body space-y-5">
          <div class="channel-toggle-row"><div class="channel-toggle-label"><Label for="ext-master">{copy.extMaster}</Label><p>{copy.extMasterDesc}</p></div><IosSwitch id="ext-master" checked={extensionsMaster} onCheckedChange={(enabled) => extensionAction({ action: "setMaster", enabled })} /></div>
          <div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><div class="channel-field"><Label for="ext-spec">{copy.extSpecLabel}</Label><Input id="ext-spec" bind:value={extensionSpec} placeholder={copy.extSpecPlaceholder} /><span class="channel-hint">{copy.extSpecHint}</span></div><div class="flex gap-2"><Button type="button" size="sm" onclick={installExtension} disabled={extensionBusy || !extensionSpec.trim()}>{extensionBusy ? copy.extInstalling : copy.extInstall}</Button><Button type="button" variant="outline" size="sm" onclick={() => extensionAction({ action: "reload" }, copy.extReloaded)} disabled={extensionBusy}>{copy.extReload}</Button></div></div>
          {#if extensions.length === 0}
            <p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{copy.extEmpty}</p>
          {:else}
            <div class="divide-y divide-border overflow-hidden rounded-lg border">
              {#each extensions as extension (extension.id)}
                <div class="space-y-2 p-3">
                  <div class="flex items-center justify-between gap-3"><div class="flex flex-wrap items-center gap-2"><span class="font-medium">{extension.name}</span><Badge variant="secondary">{extension.id}</Badge><span class="text-xs text-muted-foreground">v{extension.version}</span>{#if extension.error}<Badge variant="destructive">{copy.statusError}</Badge>{/if}</div><div class="flex items-center gap-3"><IosSwitch checked={extension.enabled} onCheckedChange={(enabled) => extensionAction({ action: "toggle", id: extension.id, enabled })} /><Button type="button" variant="outline" size="sm" onclick={() => uninstallExtension(extension.id)} disabled={extensionBusy}>{copy.extUninstall}</Button></div></div>
                  {#if extension.description}<p class="text-xs text-muted-foreground">{extension.description}</p>{/if}
                  {#if extension.toolNames.length}<p class="text-xs text-muted-foreground">{copy.extTools}: {extension.toolNames.join(", ")}</p>{/if}
                  {#if extension.eventNames.length}<p class="text-xs text-muted-foreground">{copy.extEvents}: {extension.eventNames.join(", ")}</p>{/if}
                  {#if extension.commandNames.length}<p class="text-xs text-muted-foreground">{copy.extCommands}: {extension.commandNames.map((name) => `/${name}`).join(", ")}</p>{/if}
                  {#if extension.unsupported.length}<p class="text-xs text-amber-600 dark:text-amber-400">{copy.extUnsupported}: {extension.unsupported.join(", ")}</p>{/if}
                  {#if extension.error}<p class="text-xs text-destructive">{extension.error}</p>{/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>
