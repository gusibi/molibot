<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

  const COPY = {
    "zh-CN": {
      badge: "内置插件",
      title: "每日素材 / 每日回顾",
      description: "定时扫描已授权会话，把可用素材整理到指定项目。这个旧内置插件随应用安装。",
      enabled: "启用每日素材",
      enabledHint: "按设定时间执行每日扫描和整理。",
      time: "执行时间",
      project: "输出项目",
      noProject: "请选择项目",
      directory: "输出目录",
      prompt: "提示词路径",
      notifications: "发送完成通知",
      budget: "扫描 Token 上限",
      model: "扫描模型",
      followMain: "跟随主文本模型",
      save: "保存每日素材设置",
      saving: "保存中...",
      saved: "每日素材设置已保存。",
      loadFailed: "加载每日素材设置失败",
      saveFailed: "保存每日素材设置失败",
      back: "返回插件列表"
    },
    "en-US": {
      badge: "Built-in plugin",
      title: "Daily Materials / Review",
      description: "Scan authorized conversations on a schedule and organize useful material in a selected project. This legacy built-in ships with the app.",
      enabled: "Enable daily materials",
      enabledHint: "Run the daily scan and synthesis at the configured time.",
      time: "Run time",
      project: "Output project",
      noProject: "Select a project",
      directory: "Output directory",
      prompt: "Prompt path",
      notifications: "Send completion notification",
      budget: "Scan token budget",
      model: "Scan model",
      followMain: "Follow main text model",
      save: "Save daily material settings",
      saving: "Saving...",
      saved: "Daily material settings saved.",
      loadFailed: "Failed to load daily material settings",
      saveFailed: "Failed to save daily material settings",
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
  let time = $state("23:30");
  let projectId = $state("");
  let dir = $state("content/daily-materials");
  let promptPath = $state("templates/daily-material-prompt.md");
  let notifications = $state(true);
  let scanTokenBudget = $state(120000);
  let scanModelKey = $state("");
  let projects = $state<Array<{ value: string; label: string }>>([]);
  let models = $state<Array<{ value: string; label: string }>>([]);

  async function responseJson(response: Response): Promise<any> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }

  async function load(): Promise<void> {
    loading = true;
    errorMessage = "";
    try {
      const data = await responseJson(await fetch("/api/settings/plugins/core/daily-materials"));
      const values = data.values ?? {};
      enabled = Boolean(values.enabled);
      time = String(values.time ?? "23:30");
      projectId = String(values.projectId ?? "");
      dir = String(values.dir ?? "content/daily-materials");
      promptPath = String(values.promptPath ?? "templates/daily-material-prompt.md");
      notifications = values.notifications !== false;
      scanTokenBudget = Number(values.scanTokenBudget ?? 120000);
      scanModelKey = String(values.scanModelKey ?? "");
      projects = Array.isArray(data.projects) ? data.projects : [];
      models = Array.isArray(data.models) ? data.models : [];
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
      await responseJson(await fetch("/api/settings/plugins/core/daily-materials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, time, projectId, dir, promptPath, notifications, scanTokenBudget, scanModelKey })
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
  <header class="channel-hero"><Badge variant="secondary" class="w-fit">{copy.badge}</Badge><h1 class="channel-hero-title">{copy.title}</h1><p class="channel-hero-desc">{copy.description}</p></header>
  <Button variant="ghost" size="sm" href="/settings/plugins">← {copy.back}</Button>
  {#if message}<Alert><AlertDescription>{message}</AlertDescription></Alert>{/if}
  {#if errorMessage}<Alert variant="destructive"><AlertDescription>{errorMessage}</AlertDescription></Alert>{/if}
  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading...</p>
  {:else}
    <form id="daily-materials-form" class="channel-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <section class="channel-card"><div class="channel-card-body space-y-5">
        <div class="channel-toggle-row"><div class="channel-toggle-label"><Label for="daily-enabled">{copy.enabled}</Label><p>{copy.enabledHint}</p></div><IosSwitch id="daily-enabled" bind:checked={enabled} /></div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="channel-field"><Label for="daily-time">{copy.time}</Label><Input id="daily-time" type="time" bind:value={time} /></div>
          <div class="channel-field"><Label for="daily-project">{copy.project}</Label><NativeSelect id="daily-project" bind:value={projectId}><NativeSelectOption value="">{copy.noProject}</NativeSelectOption>{#each projects as option}<NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>{/each}</NativeSelect></div>
          <div class="channel-field"><Label for="daily-dir">{copy.directory}</Label><Input id="daily-dir" bind:value={dir} /></div>
          <div class="channel-field"><Label for="daily-prompt">{copy.prompt}</Label><Input id="daily-prompt" bind:value={promptPath} /></div>
          <div class="channel-field"><Label for="daily-budget">{copy.budget}</Label><Input id="daily-budget" type="number" min="8000" max="900000" step="1000" bind:value={scanTokenBudget} /></div>
          <div class="channel-field"><Label for="daily-model">{copy.model}</Label><NativeSelect id="daily-model" bind:value={scanModelKey}><NativeSelectOption value="">{copy.followMain}</NativeSelectOption>{#each models as option}<NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>{/each}</NativeSelect></div>
        </div>
        <div class="channel-toggle-row"><div class="channel-toggle-label"><Label for="daily-notifications">{copy.notifications}</Label></div><IosSwitch id="daily-notifications" bind:checked={notifications} /></div>
      </div></section>
    </form>
    <div class="settings-footbar"><Button type="submit" form="daily-materials-form" disabled={saving}>{saving ? copy.saving : copy.save}</Button></div>
  {/if}
</div>
