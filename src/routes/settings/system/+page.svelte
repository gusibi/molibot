<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Card from "$lib/ui/Card.svelte";
  import { initLocale, locale, setLocale, type LocaleKey } from "$lib/ui/i18n";

  interface RuntimeSettings {
    timezone: string;
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
      title: "语言、时区和部署信息",
      subtitle: "这些是跨页面、跨运行时的基础配置。GitHub 地址只读展示，避免在网页里误改部署来源。",
      language: "界面语言",
      languageHint: "语言偏好保存在当前浏览器，本地切换不会重启服务。",
      timezone: "运行时时区",
      timezoneHint: "用于日期感知、用量统计和任务调度展示。保存后对后续请求生效。",
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
      title: "Language, timezone, and deployment information",
      subtitle: "These settings affect the whole runtime. GitHub is read-only here so the web UI cannot accidentally change the deployment source.",
      language: "Interface language",
      languageHint: "Language is stored in this browser and does not restart the service.",
      timezone: "Runtime timezone",
      timezoneHint: "Used for date-aware prompts, usage analytics, and scheduled task display. Applies to future requests after saving.",
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
  let loading = true;
  let saving = false;

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
      timezone = settings.timezone || timezone;
      timezoneOptions = buildTimeZoneOptions(timezone);
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
    } finally {
      loading = false;
    }
  }

  async function saveTimezone(): Promise<void> {
    saving = true;
    status = "";
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
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void loadSystemConfig();
  });
</script>

<PageShell widthClass="max-w-5xl" gapClass="space-y-8">
  <header class="wb-hero">
    <div class="wb-hero-copy">
      <p class="wb-eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p class="wb-copy">{copy.subtitle}</p>
    </div>
  </header>

  {#if status}
    <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[var(--shadow-sm)]">
      {status}
    </div>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
    <Card className="space-y-5 rounded-[1.25rem] p-5">
      <div>
        <p class="wb-eyebrow">{copy.language}</p>
        <p class="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{copy.languageHint}</p>
      </div>
      <select
        class="w-full rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-3 text-sm outline-none focus:border-[var(--ring)]"
        bind:value={selectedLocale}
        on:change={onLocaleChange}
      >
        <option value="zh-CN">中文</option>
        <option value="en-US">English</option>
      </select>
    </Card>

    <Card className="space-y-5 rounded-[1.25rem] p-5">
      <div>
        <p class="wb-eyebrow">{copy.timezone}</p>
        <p class="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{copy.timezoneHint}</p>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row">
        <select
          class="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-3 text-sm outline-none focus:border-[var(--ring)]"
          bind:value={timezone}
          disabled={loading}
        >
          {#each timezoneOptions as zone}
            <option value={zone}>{zone}</option>
          {/each}
        </select>
        <button
          class="rounded-xl border border-[var(--border)] bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          type="button"
          on:click={saveTimezone}
          disabled={saving || loading}
        >
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </Card>
  </div>

  <Card className="space-y-5 rounded-[1.25rem] p-5">
    <div>
      <p class="wb-eyebrow">{copy.deployment}</p>
      <h2 class="mt-2 text-xl font-semibold">{copy.githubRepo}</h2>
      <p class="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{copy.githubRepoHint}</p>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <label class="space-y-2">
        <span class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{copy.githubRepo}</span>
        <input
          class="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-3 font-mono text-xs text-[var(--foreground)]"
          value={versionInfo?.repositoryUrl || copy.notConfigured}
          readonly
        />
      </label>
      <label class="space-y-2">
        <span class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{copy.gitRef}</span>
        <input
          class="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-3 font-mono text-xs text-[var(--foreground)]"
          value={versionInfo?.ref || copy.notConfigured}
          readonly
        />
      </label>
      <div class="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{copy.currentVersion}</p>
        <p class="mt-2 font-mono text-lg font-semibold">v{versionInfo?.currentVersion ?? "..."}</p>
      </div>
      <div class="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{copy.latestVersion}</p>
        <p class="mt-2 font-mono text-lg font-semibold">{versionInfo?.latestVersion ? `v${versionInfo.latestVersion}` : "-"}</p>
      </div>
      <div class="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 lg:col-span-2">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{copy.updateState}</p>
        <p class="mt-2 text-sm font-semibold">{updateStateLabel()}</p>
        {#if versionInfo?.error}
          <p class="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">{versionInfo.error}</p>
        {/if}
      </div>
    </div>
  </Card>
</PageShell>
