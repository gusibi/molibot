<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Separator } from "$lib/components/ui/separator";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
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
      toolProgressHint: "决定在聊天界面中展示多少工具执行的详细步骤 and 信息。",
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

  let browserTimeoutMs = 60000;

  let toolProgress: "off" | "new" | "all" | "verbose" = "all";
  let showReasoning: "off" | "on" | "stream" | "new" = "off";
  let gatewayNotifyInterval = 0;

  let sandboxEnabled = true;

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

  async function saveAll(): Promise<void> {
    saving = true;
    status = "";
    statusVariant = "default";
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: selectedLocale,
          timezone,
          budget: {
            maxToolCalls: Number(maxToolCalls),
            maxToolFailures: Number(maxToolFailures),
            maxModelAttempts: Number(maxModelAttempts)
          },
          browserAutomation: {
            defaultTimeoutMs: Number(browserTimeoutMs)
          },
          display: {
            toolProgress,
            showReasoning,
            gatewayNotifyInterval: Number(gatewayNotifyInterval)
          },
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
      saving = false;
    }
  }

  onMount(() => {
    void loadSystemConfig();
  });
</script>

<div class="channel-page">
  <header class="channel-hero">
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">{copy.eyebrow}</Badge>
      <Badge variant={versionInfo?.updateAvailable ? "default" : "outline"}>
        {updateStateLabel()}
      </Badge>
    </div>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.subtitle}</p>
  </header>

  {#if status && !saving}
    <Alert variant={statusVariant}>
      <AlertDescription>{status}</AlertDescription>
    </Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading system configuration...</p>
  {:else}
    <form id="system-form" class="channel-form" onsubmit={(e) => { e.preventDefault(); saveAll(); }}>
      <div class="channel-field-row">
        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h2 class="channel-card-title">{copy.language}</h2>
              <p class="channel-card-desc">{copy.languageHint}</p>
            </div>
          </div>
          <div class="channel-card-body">
            <div class="channel-field">
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
            </div>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h2 class="channel-card-title">{copy.timezone}</h2>
              <p class="channel-card-desc">{copy.timezoneHint}</p>
            </div>
          </div>
          <div class="channel-card-body">
            <div class="channel-field">
              <NativeSelect
                class="w-full"
                aria-label={copy.timezone}
                bind:value={timezone}
                disabled={loading}
              >
                {#each timezoneOptions as zone}
                  <NativeSelectOption value={zone}>{zone}</NativeSelectOption>
                {/each}
              </NativeSelect>
            </div>
          </div>
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.budgetTitle}</h2>
            <p class="channel-card-desc">{copy.budgetSubtitle}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field-row">
            <div class="channel-field">
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
            <div class="channel-field">
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
          </div>
          <div class="channel-field pt-2">
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
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.browserTitle}</h2>
            <p class="channel-card-desc">{copy.browserSubtitle}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field">
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
            <p class="channel-hint">{copy.browserTimeoutHint}</p>
          </div>
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.displayTitle}</h2>
            <p class="channel-card-desc">{copy.displaySubtitle}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field-row">
            <div class="channel-field">
              <Label for="show-reasoning">{copy.showReasoning}</Label>
              <NativeSelect id="show-reasoning" bind:value={showReasoning} disabled={loading}>
                <NativeSelectOption value="off">{copy.showReasoningOff}</NativeSelectOption>
                <NativeSelectOption value="on">{copy.showReasoningOn}</NativeSelectOption>
                <NativeSelectOption value="stream">{copy.showReasoningStream}</NativeSelectOption>
                <NativeSelectOption value="new">{copy.showReasoningNew}</NativeSelectOption>
              </NativeSelect>
              <p class="channel-hint">{copy.showReasoningHint}</p>
            </div>

            <div class="channel-field">
              <Label for="tool-progress">{copy.toolProgress}</Label>
              <NativeSelect id="tool-progress" bind:value={toolProgress} disabled={loading}>
                <NativeSelectOption value="off">{copy.toolProgressOff}</NativeSelectOption>
                <NativeSelectOption value="new">{copy.toolProgressNew}</NativeSelectOption>
                <NativeSelectOption value="all">{copy.toolProgressAll}</NativeSelectOption>
                <NativeSelectOption value="verbose">{copy.toolProgressVerbose}</NativeSelectOption>
              </NativeSelect>
              <p class="channel-hint">{copy.toolProgressHint}</p>
            </div>
          </div>

          <div class="channel-field pt-2">
            <Label for="gateway-notify-interval">{copy.gatewayNotifyInterval}</Label>
            <Input
              id="gateway-notify-interval"
              type="number"
              min="0"
              bind:value={gatewayNotifyInterval}
              disabled={loading}
            />
            <p class="channel-hint">{copy.gatewayNotifyIntervalHint}</p>
          </div>
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.sandboxTitle}</h2>
            <p class="channel-card-desc">{copy.sandboxSubtitle}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-toggle-row">
            <div class="channel-toggle-label">
              <Label for="sandbox-enabled">{copy.sandboxEnabled}</Label>
              <p>{copy.sandboxEnabledHint}</p>
            </div>
            <IosSwitch id="sandbox-enabled" bind:checked={sandboxEnabled} disabled={loading} />
          </div>

          <div class="pt-2">
            <a href="/settings/sandbox" class="text-xs text-primary underline hover:text-primary/80">
              {copy.sandboxDetailLink} &rarr;
            </a>
          </div>
        </div>
      </div>

      <div class="channel-card mb-16">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.deployment}</h2>
            <p class="channel-card-desc">{copy.githubRepoHint}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field-row">
            <div class="channel-field">
              <Label for="github-repo">{copy.githubRepo}</Label>
              <Input
                id="github-repo"
                class="font-mono text-xs"
                value={versionInfo?.repositoryUrl || copy.notConfigured}
                readonly
              />
            </div>
            <div class="channel-field">
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
        Saving changes...
      </span>
    {:else if status}
      <span class={statusVariant === "destructive" ? "settings-footbar-error" : "settings-footbar-ok"}>{status}</span>
    {/if}
  </div>
  <div class="settings-footbar-actions">
    <Button variant="outline" size="sm" onclick={loadSystemConfig} disabled={loading || saving}>
      Reset
    </Button>
    <button type="submit" form="system-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? "Saving..." : "Save System Config"}
    </button>
  </div>
</footer>
