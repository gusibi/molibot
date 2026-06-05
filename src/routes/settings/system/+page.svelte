<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
  } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Separator } from "$lib/components/ui/separator";
  import { Switch } from "$lib/components/ui/switch";
  import { initLocale, locale, setLocale, type LocaleKey } from "$lib/ui/i18n";

  interface RunBudgetLimits {
    maxToolCalls: number;
    maxToolFailures: number;
    maxModelAttempts: number;
  }

  interface BrowserAutomationSettings {
    defaultTimeoutMs: number;
  }

  interface GlobalDisplaySettings {
    toolProgress: "off" | "new" | "all" | "verbose";
    showReasoning: "off" | "on" | "stream" | "new";
    gatewayNotifyInterval: number;
  }

  interface ToolSandboxSettings {
    enabled: boolean;
  }

  interface RuntimeSettings {
    locale: LocaleKey;
    timezone: string;
    budget: RunBudgetLimits;
    browserAutomation: BrowserAutomationSettings;
    display?: GlobalDisplaySettings;
    toolSandbox?: ToolSandboxSettings;
  }

  interface VersionInfo {
    ok: boolean;
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    remoteConfigured: boolean;
    repositoryUrl?: string | null;
    repository?: string;
    ref?: string;
    error?: string;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "系统配置",
      title: "系统语言、时区与运行预算",
      subtitle: "这些是跨页面、跨运行时的基础配置。GitHub 地址只读展示，避免在网页里误改部署来源。",
      language: "界面语言",
      languageHint: "语言偏好保存在当前浏览器，本地切换不会重启服务。",
      timezone: "运行时时区",
      timezoneHint: "用于日期感知、用量统计 and 任务调度展示。保存后对后续请求生效。",
      budgetTitle: "智能体运行预算限制",
      budgetSubtitle: "控制单次执行会话中允许的工具调用和模型尝试的最大次数，防止死循环或超额扣费。",
      maxToolCalls: "最大工具调用次数",
      maxToolFailures: "最大允许工具失败次数",
      maxModelAttempts: "最大模型尝试（思考）次数",
      saveBudget: "保存预算限制",
      savingBudget: "保存预算中...",
      browserTitle: "浏览器自动化",
      browserSubtitle: "agent-browser (Playwright) 在执行页面导航、点击等操作时的默认超时。某些加载较慢的网站需要更长的超时时间。",
      browserTimeout: "默认超时（毫秒）",
      browserTimeoutHint: "推荐 60000ms (60s)，范围 5000–300000ms",
      saveBrowser: "保存浏览器设置",
      savingBrowser: "保存中...",
      displayTitle: "显示与思考设置",
      displaySubtitle: "控制 AI 助手在各个渠道中如何展示其思考过程、工具调用进度及限频机制。",
      toolProgress: "工具执行进度展示",
      toolProgressHint: "决定在聊天界面中展示多少工具执行的详细步骤和信息。",
      toolProgressOff: "关闭 (Off)",
      toolProgressNew: "仅展示新步骤 (Only new steps)",
      toolProgressAll: "展示全部步骤 (All steps)",
      toolProgressVerbose: "详细输出包含输入输出 (Verbose)",
      showReasoning: "显示模型思考过程",
      showReasoningHint: "对于支持 Thinking (思考型) 的模型，决定如何呈现其思考链路。",
      showReasoningOff: "关闭思考过程 (Off)",
      showReasoningOn: "思考完成后展示 (On)",
      showReasoningStream: "流式实时输出思考过程 (Stream)",
      showReasoningNew: "仅动态展示最近一句 (New)",
      gatewayNotifyInterval: "网关通知发送间隔 (秒)",
      gatewayNotifyIntervalHint: "限制向外部渠道（如飞书、微信、Telegram）发送进度消息的频率，设为 0 表示实时发送不限频。",
      saveDisplay: "保存显示与思考设置",
      savingDisplay: "保存中...",
      sandboxTitle: "工具沙盒安全限制",
      sandboxSubtitle: "沙盒可以在隔离环境下执行 AI 编写的代码与 Bash 命令，避免破坏宿主机系统。",
      sandboxEnabled: "启用工具执行沙盒",
      sandboxEnabledHint: "强烈建议开启。如果关闭，助手的所有 Bash 命令和代码执行将在宿主机直接运行。",
      sandboxDetailLink: "前往沙盒详细策略页面配置网络与文件读写规则",
      saveSandbox: "保存沙盒设置",
      savingSandbox: "保存中...",
      deployment: "部署信息",
      githubRepo: "GitHub 地址",
      githubRepoHint: "只读。请通过部署环境或 molibot manage 修改，不在 Web UI 内编辑。",
      gitRef: "Git 分支 / ref",
      currentVersion: "当前版本",
      latestVersion: "最新版本",
      updateState: "更新状态",
      notConfigured: "未配置",
      updateAvailable: "发现新版本",
      upToDate: "已是最新",
      checkFailed: "检查失败",
      save: "保存时区",
      saving: "保存中...",
      saved: "已保存",
      failedLoad: "加载系统配置失败",
      failedSave: "保存系统配置失败"
    },
    "en-US": {
      eyebrow: "System Config",
      title: "Language, timezone, and execution budget",
      subtitle: "These settings affect the whole runtime. GitHub is read-only here so the web UI cannot accidentally change the deployment source.",
      language: "Interface language",
      languageHint: "Language is stored in this browser and does not restart the service.",
      timezone: "Runtime timezone",
      timezoneHint: "Used for date-aware prompts, usage analytics, and scheduled task display. Applies to future requests after saving.",
      budgetTitle: "Agent Run Budget Limits",
      budgetSubtitle: "Control the maximum number of tool calls and model attempts allowed per session to avoid loops or billing surprises.",
      maxToolCalls: "Max tool calls per session",
      maxToolFailures: "Max allowed tool failures",
      maxModelAttempts: "Max model attempts (reasoning cycles)",
      saveBudget: "Save budget limits",
      savingBudget: "Saving budget limits...",
      browserTitle: "Browser Automation",
      browserSubtitle: "Default timeout for agent-browser (Playwright) when navigating, clicking, or interacting with pages. Increase for slow-loading sites.",
      browserTimeout: "Default timeout (ms)",
      browserTimeoutHint: "Recommended: 60000ms (60s). Range: 5000–300000ms",
      saveBrowser: "Save browser settings",
      savingBrowser: "Saving...",
      displayTitle: "Display & Reasoning",
      displaySubtitle: "Control how the AI assistant displays its thinking process, tool execution progress, and notification intervals across channels.",
      toolProgress: "Tool Execution Progress",
      toolProgressHint: "Decide how much details of tool execution is shown in the chat window.",
      toolProgressOff: "Off",
      toolProgressNew: "Only show new steps",
      toolProgressAll: "Show all steps",
      toolProgressVerbose: "Verbose (includes inputs/outputs)",
      showReasoning: "Show Reasoning Process",
      showReasoningHint: "For models supporting thinking/reasoning, decide how the thought process is rendered.",
      showReasoningOff: "Off",
      showReasoningOn: "Show after completed",
      showReasoningStream: "Show in real-time stream",
      showReasoningNew: "Live latest sentence only",
      gatewayNotifyInterval: "Gateway Notify Interval (seconds)",
      gatewayNotifyIntervalHint: "Frequency limit for sending progress messages to chat channels. Set to 0 to send immediately without limits.",
      saveDisplay: "Save display & reasoning settings",
      savingDisplay: "Saving...",
      sandboxTitle: "Tool Sandbox Security",
      sandboxSubtitle: "The sandbox executes AI-generated code and Bash commands in an isolated environment to prevent system damage.",
      sandboxEnabled: "Enable Tool Execution Sandbox",
      sandboxEnabledHint: "Highly recommended. If disabled, all Bash commands and code will run directly on the host system.",
      sandboxDetailLink: "Go to Sandbox Policy page to configure network & filesystem rules",
      saveSandbox: "Save sandbox settings",
      savingSandbox: "Saving...",
      deployment: "Deployment",
      githubRepo: "GitHub URL",
      githubRepoHint: "Read-only. Change it through deployment environment or molibot manage, not the Web UI.",
      gitRef: "Git branch / ref",
      currentVersion: "Current version",
      latestVersion: "Latest version",
      updateState: "Update state",
      notConfigured: "Not configured",
      updateAvailable: "Update available",
      upToDate: "Up to date",
      checkFailed: "Check failed",
      save: "Save timezone",
      saving: "Saving...",
      saved: "Saved",
      failedLoad: "Failed to load system config",
      failedSave: "Failed to save system config"
    }
  } as const;

  let selectedLocale: LocaleKey = "zh-CN";
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let timezoneOptions: string[] = [];
  let versionInfo: VersionInfo | null = null;
  let status = "";
  let statusVariant: "default" | "destructive" = "default";
  let loading = true;
  let saving = false;

  let maxToolCalls = 24;
  let maxToolFailures = 6;
  let maxModelAttempts = 6;
  let savingBudget = false;

  let browserTimeoutMs = 60000;
  let savingBrowser = false;

  let toolProgress: "off" | "new" | "all" | "verbose" = "all";
  let showReasoning: "off" | "on" | "stream" | "new" = "off";
  let gatewayNotifyInterval = 0;
  let savingDisplay = false;

  let sandboxEnabled = true;
  let savingSandbox = false;

  $: copy = COPY[$locale];

  function buildTimeZoneOptions(selected: string): string[] {
    let values: string[] = [];
    try {
      if (typeof Intl.supportedValuesOf === "function") {
        values = Intl.supportedValuesOf("timeZone");
      }
    } catch {
      values = [];
    }
    const preferred = [
      "Asia/Shanghai",
      "UTC",
      "America/Los_Angeles",
      "America/New_York",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Tokyo",
      "Asia/Singapore"
    ];
    return Array.from(new Set([selected, ...preferred, ...values].filter(Boolean))).sort();
  }

  function updateStateLabel(): string {
    if (!versionInfo?.remoteConfigured) return copy.notConfigured;
    if (!versionInfo.ok) return copy.checkFailed;
    return versionInfo.updateAvailable ? copy.updateAvailable : copy.upToDate;
  }

  function onLocaleChange(event: Event): void {
    selectedLocale = (event.target as HTMLSelectElement).value as LocaleKey;
    setLocale(selectedLocale);
  }

  async function loadSystemConfig(): Promise<void> {
    loading = true;
    status = "";
    statusVariant = "default";
    try {
      initLocale();
      selectedLocale = $locale;

      const [settingsResponse, versionResponse] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/version")
      ]);
      const settingsPayload = await settingsResponse.json();
      const versionPayload = await versionResponse.json();
      if (!settingsResponse.ok || !settingsPayload?.ok || !settingsPayload?.settings) {
        throw new Error(settingsPayload?.error || copy.failedLoad);
      }
      const settings = settingsPayload.settings as RuntimeSettings;
      selectedLocale = settings.locale || selectedLocale;
      setLocale(selectedLocale);
      timezone = settings.timezone || timezone;
      timezoneOptions = buildTimeZoneOptions(timezone);
      if (settings.budget) {
        maxToolCalls = settings.budget.maxToolCalls ?? maxToolCalls;
        maxToolFailures = settings.budget.maxToolFailures ?? maxToolFailures;
        maxModelAttempts = settings.budget.maxModelAttempts ?? maxModelAttempts;
      }
      if (settings.browserAutomation) {
        browserTimeoutMs = settings.browserAutomation.defaultTimeoutMs ?? browserTimeoutMs;
      }
      if (settings.display) {
        toolProgress = settings.display.toolProgress ?? toolProgress;
        showReasoning = settings.display.showReasoning ?? showReasoning;
        gatewayNotifyInterval = settings.display.gatewayNotifyInterval ?? gatewayNotifyInterval;
      }
      if (settings.toolSandbox) {
        sandboxEnabled = settings.toolSandbox.enabled ?? sandboxEnabled;
      }
      versionInfo = {
        ok: Boolean(versionPayload?.ok),
        currentVersion: String(versionPayload?.currentVersion ?? "0.0.0"),
        latestVersion: versionPayload?.latestVersion ? String(versionPayload.latestVersion) : null,
        updateAvailable: Boolean(versionPayload?.updateAvailable),
        remoteConfigured: Boolean(versionPayload?.remoteConfigured),
        repositoryUrl: versionPayload?.repositoryUrl ?? null,
        repository: versionPayload?.repository,
        ref: versionPayload?.ref,
        error: versionPayload?.error
      };
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      loading = false;
    }
  }

  async function saveTimezone(): Promise<void> {
    saving = true;
    status = "";
    statusVariant = "default";
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.failedSave);
      }
      status = copy.saved;
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      saving = false;
    }
  }

  async function saveBudget(): Promise<void> {
    savingBudget = true;
    status = "";
    statusVariant = "default";
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget: {
            maxToolCalls: Number(maxToolCalls),
            maxToolFailures: Number(maxToolFailures),
            maxModelAttempts: Number(maxModelAttempts)
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.failedSave);
      }
      status = copy.saved;
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      savingBudget = false;
    }
  }

  async function saveBrowserSettings(): Promise<void> {
    savingBrowser = true;
    status = "";
    statusVariant = "default";
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserAutomation: {
            defaultTimeoutMs: Number(browserTimeoutMs)
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.failedSave);
      }
      status = copy.saved;
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      savingBrowser = false;
    }
  }

  async function saveDisplaySettings(): Promise<void> {
    savingDisplay = true;
    status = "";
    statusVariant = "default";
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display: {
            toolProgress,
            showReasoning,
            gatewayNotifyInterval: Number(gatewayNotifyInterval)
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.failedSave);
      }
      status = copy.saved;
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      savingDisplay = false;
    }
  }

  async function saveSandboxEnabled(): Promise<void> {
    savingSandbox = true;
    status = "";
    statusVariant = "default";
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolSandbox: {
            enabled: sandboxEnabled
          }
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || copy.failedSave);
      }
      status = copy.saved;
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      savingSandbox = false;
    }
  }

  onMount(() => {
    void loadSystemConfig();
  });
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">{copy.eyebrow}</Badge>
      <Badge variant={versionInfo?.updateAvailable ? "default" : "outline"}>
        {updateStateLabel()}
      </Badge>
    </div>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
      <p class="text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
    </div>
  </header>

  {#if status}
    <Alert variant={statusVariant}>
      <AlertDescription>{status}</AlertDescription>
    </Alert>
  {/if}

  <div class="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
    <Card>
      <CardHeader>
        <CardTitle>{copy.language}</CardTitle>
        <CardDescription>{copy.languageHint}</CardDescription>
      </CardHeader>
      <CardContent>
        <NativeSelect
          class="w-full"
          aria-label={copy.language}
          size="default"
          value={selectedLocale}
          onchange={onLocaleChange}
        >
          <NativeSelectOption value="zh-CN">中文</NativeSelectOption>
          <NativeSelectOption value="en-US">English</NativeSelectOption>
        </NativeSelect>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{copy.timezone}</CardTitle>
        <CardDescription>{copy.timezoneHint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex flex-col gap-3 sm:flex-row">
          <NativeSelect
            class="min-w-0 flex-1"
            aria-label={copy.timezone}
            bind:value={timezone}
            disabled={loading}
          >
            {#each timezoneOptions as zone}
              <NativeSelectOption value={zone}>{zone}</NativeSelectOption>
            {/each}
          </NativeSelect>
          <Button type="button" onclick={saveTimezone} disabled={saving || loading}>
            {saving ? copy.saving : copy.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>{copy.budgetTitle}</CardTitle>
      <CardDescription>{copy.budgetSubtitle}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="flex flex-col gap-2">
          <Label for="max-tool-calls">{copy.maxToolCalls}</Label>
          <Input
            id="max-tool-calls"
            type="number"
            min="1"
            max="500"
            bind:value={maxToolCalls}
            disabled={loading}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="max-tool-failures">{copy.maxToolFailures}</Label>
          <Input
            id="max-tool-failures"
            type="number"
            min="1"
            max="100"
            bind:value={maxToolFailures}
            disabled={loading}
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="max-model-attempts">{copy.maxModelAttempts}</Label>
          <Input
            id="max-model-attempts"
            type="number"
            min="1"
            max="100"
            bind:value={maxModelAttempts}
            disabled={loading}
          />
        </div>
      </div>
      <div class="flex justify-end">
        <Button type="button" onclick={saveBudget} disabled={savingBudget || loading}>
          {savingBudget ? copy.savingBudget : copy.saveBudget}
        </Button>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>{copy.browserTitle}</CardTitle>
      <CardDescription>{copy.browserSubtitle}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="browser-timeout">{copy.browserTimeout}</Label>
          <Input
            id="browser-timeout"
            type="number"
            min="5000"
            max="300000"
            step="1000"
            bind:value={browserTimeoutMs}
            disabled={loading}
          />
          <p class="text-xs text-muted-foreground">{copy.browserTimeoutHint}</p>
        </div>
      </div>
      <div class="flex justify-end">
        <Button type="button" onclick={saveBrowserSettings} disabled={savingBrowser || loading}>
          {savingBrowser ? copy.savingBrowser : copy.saveBrowser}
        </Button>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>{copy.displayTitle}</CardTitle>
      <CardDescription>{copy.displaySubtitle}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="flex flex-col gap-2">
          <Label for="show-reasoning">{copy.showReasoning}</Label>
          <NativeSelect id="show-reasoning" bind:value={showReasoning} disabled={loading}>
            <NativeSelectOption value="off">{copy.showReasoningOff}</NativeSelectOption>
            <NativeSelectOption value="on">{copy.showReasoningOn}</NativeSelectOption>
            <NativeSelectOption value="stream">{copy.showReasoningStream}</NativeSelectOption>
            <NativeSelectOption value="new">{copy.showReasoningNew}</NativeSelectOption>
          </NativeSelect>
          <p class="text-xs text-muted-foreground">{copy.showReasoningHint}</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="tool-progress">{copy.toolProgress}</Label>
          <NativeSelect id="tool-progress" bind:value={toolProgress} disabled={loading}>
            <NativeSelectOption value="off">{copy.toolProgressOff}</NativeSelectOption>
            <NativeSelectOption value="new">{copy.toolProgressNew}</NativeSelectOption>
            <NativeSelectOption value="all">{copy.toolProgressAll}</NativeSelectOption>
            <NativeSelectOption value="verbose">{copy.toolProgressVerbose}</NativeSelectOption>
          </NativeSelect>
          <p class="text-xs text-muted-foreground">{copy.toolProgressHint}</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="gateway-notify-interval">{copy.gatewayNotifyInterval}</Label>
          <Input
            id="gateway-notify-interval"
            type="number"
            min="0"
            bind:value={gatewayNotifyInterval}
            disabled={loading}
          />
          <p class="text-xs text-muted-foreground">{copy.gatewayNotifyIntervalHint}</p>
        </div>
      </div>
      <div class="flex justify-end">
        <Button type="button" onclick={saveDisplaySettings} disabled={savingDisplay || loading}>
          {savingDisplay ? copy.savingDisplay : copy.saveDisplay}
        </Button>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>{copy.sandboxTitle}</CardTitle>
      <CardDescription>{copy.sandboxSubtitle}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
        <div class="flex flex-col gap-1">
          <Label for="sandbox-enabled">{copy.sandboxEnabled}</Label>
          <p class="text-xs text-muted-foreground">{copy.sandboxEnabledHint}</p>
        </div>
        <Switch id="sandbox-enabled" bind:checked={sandboxEnabled} disabled={loading} />
      </div>

      <div class="flex items-center justify-between">
        <a href="/settings/sandbox" class="text-xs text-primary underline hover:text-primary/80">
          {copy.sandboxDetailLink} &rarr;
        </a>
        <Button type="button" onclick={saveSandboxEnabled} disabled={savingSandbox || loading}>
          {savingSandbox ? copy.savingSandbox : copy.saveSandbox}
        </Button>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex flex-col gap-1.5">
          <CardTitle>{copy.deployment}</CardTitle>
          <CardDescription>{copy.githubRepoHint}</CardDescription>
        </div>
        <Badge variant={versionInfo?.remoteConfigured ? "secondary" : "outline"}>
          {updateStateLabel()}
        </Badge>
      </div>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <Label for="github-repo">{copy.githubRepo}</Label>
          <Input
            id="github-repo"
            class="font-mono text-xs"
            value={versionInfo?.repositoryUrl || copy.notConfigured}
            readonly
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="git-ref">{copy.gitRef}</Label>
          <Input
            id="git-ref"
            class="font-mono text-xs"
            value={versionInfo?.ref || copy.notConfigured}
            readonly
          />
        </div>
      </div>

      <Separator />

      <div class="grid gap-4 sm:grid-cols-3">
        <div class="flex flex-col gap-1 rounded-lg border bg-muted/40 p-4">
          <span class="text-xs font-medium text-muted-foreground">{copy.currentVersion}</span>
          <span class="font-mono text-lg font-semibold">v{versionInfo?.currentVersion ?? "..."}</span>
        </div>
        <div class="flex flex-col gap-1 rounded-lg border bg-muted/40 p-4">
          <span class="text-xs font-medium text-muted-foreground">{copy.latestVersion}</span>
          <span class="font-mono text-lg font-semibold">
            {versionInfo?.latestVersion ? `v${versionInfo.latestVersion}` : "-"}
          </span>
        </div>
        <div class="flex flex-col gap-1 rounded-lg border bg-muted/40 p-4">
          <span class="text-xs font-medium text-muted-foreground">{copy.updateState}</span>
          <span class="text-sm font-semibold">{updateStateLabel()}</span>
        </div>
      </div>

      {#if versionInfo?.error}
        <Alert variant="destructive">
          <AlertDescription>{versionInfo.error}</AlertDescription>
        </Alert>
      {/if}
    </CardContent>
  </Card>
</div>
