<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Input } from "$lib/components/ui/input";
  import { locale } from "$lib/ui/i18n";

  const COPY = {
    "zh-CN": {
      badge: "内置插件",
      title: "记忆后端",
      description: "配置记忆存储和每日反思。这个旧内置插件仍使用 Molibot 设置存储；不需要安装。",
      enabled: "启用记忆",
      enabledHint: "允许 Agent 索引、检索和写入长期记忆。",
      backend: "记忆后端",
      embeddingProvider: "向量服务商",
      embeddingProviderHint: "选择用于生成记忆向量特征的 AI 服务商。留空则仅使用关键词/词法检索。",
      noEmbeddingProvider: "未启用（纯词法检索）",
      embeddingModel: "向量模型",
      embeddingModelHint: "指定所选服务商下的 Embedding 向量模型名称。",
      embeddingModelPlaceholder: "例如：text-embedding-3-small 或 bge-m3",
      reflectionTime: "每日反思时间",
      notifications: "发送反思通知",
      notificationsHint: "反思任务结束后向已授权目标发送结果。",
      save: "保存记忆设置",
      saving: "保存中...",
      saved: "记忆设置已保存。",
      loadFailed: "加载记忆设置失败",
      saveFailed: "保存记忆设置失败",
      back: "返回插件列表"
    },
    "en-US": {
      badge: "Built-in plugin",
      title: "Memory Backend",
      description: "Configure memory storage and daily reflection. This legacy built-in still uses Molibot settings storage and needs no installation.",
      enabled: "Enable memory",
      enabledHint: "Allow the Agent to index, retrieve, and write long-term memory.",
      backend: "Memory backend",
      embeddingProvider: "Embedding Provider",
      embeddingProviderHint: "Select the AI provider used to generate memory vector embeddings. Leave empty for lexical retrieval only.",
      noEmbeddingProvider: "Disabled (Lexical Only)",
      embeddingModel: "Embedding Model",
      embeddingModelHint: "The model name for embeddings provided by the selected provider.",
      embeddingModelPlaceholder: "e.g. text-embedding-3-small or bge-m3",
      reflectionTime: "Daily reflection time",
      notifications: "Send reflection notifications",
      notificationsHint: "Notify an authorized destination when reflection completes.",
      save: "Save memory settings",
      saving: "Saving...",
      saved: "Memory settings saved.",
      loadFailed: "Failed to load memory settings",
      saveFailed: "Failed to save memory settings",
      back: "Back to plugins"
    }
  } as const;

  let currentLocale = $state<"zh-CN" | "en-US">("zh-CN");
  let copy = $derived(COPY[currentLocale]);
  let loading = $state(true);
  let saving = $state(false);
  let message = $state("");
  let errorMessage = $state("");
  let enabled = $state(false);
  let backend = $state("json-file");
  let embeddingProviderId = $state("");
  let embeddingModel = $state("");
  let reflectionTime = $state("03:00");
  let reflectionNotifications = $state(true);
  let backends = $state<Array<{ value: string; label: string }>>([]);
  let embeddingProviders = $state<Array<{ value: string; label: string }>>([]);

  async function responseJson(response: Response): Promise<any> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }

  async function load(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const data = await responseJson(await fetch("/api/settings/plugins/core/memory"));
      enabled = Boolean(data.values?.enabled);
      backend = String(data.values?.backend ?? "json-file");
      embeddingProviderId = String(data.values?.embeddingProviderId ?? "");
      embeddingModel = String(data.values?.embeddingModel ?? "");
      reflectionTime = String(data.values?.reflectionTime ?? "03:00");
      reflectionNotifications = data.values?.reflectionNotifications !== false;
      backends = Array.isArray(data.backends) ? data.backends : [];
      embeddingProviders = Array.isArray(data.embeddingProviders) ? data.embeddingProviders : [];
    } catch (error) {
      errorMessage = `${copy.loadFailed}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    message = "";
    errorMessage = "";
    try {
      await responseJson(await fetch("/api/settings/plugins/core/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          backend,
          embeddingProviderId,
          embeddingModel,
          reflectionTime,
          reflectionNotifications
        })
      }));
      message = copy.saved;
    } catch (error) {
      errorMessage = `${copy.saveFailed}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    currentLocale = get(locale);
    const unsubscribe = locale.subscribe((value) => (currentLocale = value));
    void load();
    return unsubscribe;
  });
</script>

<div class="channel-page">
  <header class="channel-hero">
    <Badge variant="secondary" class="w-fit">{copy.badge}</Badge>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.description}</p>
  </header>

  <Button variant="ghost" size="sm" href="/settings/plugins">← {copy.back}</Button>
  {#if message}<Alert><AlertDescription>{message}</AlertDescription></Alert>{/if}
  {#if errorMessage}<Alert variant="destructive"><AlertDescription>{errorMessage}</AlertDescription></Alert>{/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading...</p>
  {:else}
    <form id="memory-plugin-form" class="channel-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <section class="channel-card">
        <div class="channel-card-body space-y-5">
          <div class="channel-toggle-row"><div class="channel-toggle-label"><Label for="memory-enabled">{copy.enabled}</Label><p>{copy.enabledHint}</p></div><IosSwitch id="memory-enabled" bind:checked={enabled} /></div>
          <div class="channel-field"><Label for="memory-backend">{copy.backend}</Label><NativeSelect id="memory-backend" bind:value={backend}>{#each backends as option}<NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>{/each}</NativeSelect></div>
          <div class="channel-field">
            <Label for="embedding-provider">{copy.embeddingProvider}</Label>
            <p class="text-xs text-muted-foreground">{copy.embeddingProviderHint}</p>
            <NativeSelect id="embedding-provider" bind:value={embeddingProviderId}>
              <NativeSelectOption value="">{copy.noEmbeddingProvider}</NativeSelectOption>
              {#each embeddingProviders as option}
                <NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>
              {/each}
            </NativeSelect>
          </div>
          {#if embeddingProviderId}
            <div class="channel-field">
              <Label for="embedding-model">{copy.embeddingModel}</Label>
              <p class="text-xs text-muted-foreground">{copy.embeddingModelHint}</p>
              <Input id="embedding-model" bind:value={embeddingModel} placeholder={copy.embeddingModelPlaceholder} />
            </div>
          {/if}
          <div class="channel-field"><Label for="reflection-time">{copy.reflectionTime}</Label><Input id="reflection-time" type="time" bind:value={reflectionTime} /></div>
          <div class="channel-toggle-row"><div class="channel-toggle-label"><Label for="reflection-notifications">{copy.notifications}</Label><p>{copy.notificationsHint}</p></div><IosSwitch id="reflection-notifications" bind:checked={reflectionNotifications} /></div>
        </div>
      </section>
    </form>
    <div class="settings-footbar"><Button type="submit" form="memory-plugin-form" disabled={saving}>{saving ? copy.saving : copy.save}</Button></div>
  {/if}
</div>
