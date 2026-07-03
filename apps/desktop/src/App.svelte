<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import ChatView from "./ChatView.svelte";
  import SandboxSection from "./lib/settings/SandboxSection.svelte";
  import HostBashSection from "./lib/settings/HostBashSection.svelte";
  import RuntimeEnvSection from "./lib/settings/RuntimeEnvSection.svelte";
  import TasksSection from "./lib/settings/TasksSection.svelte";
  import ModelsSection from "./lib/settings/ModelsSection.svelte";
  import AgentsSection from "./lib/settings/AgentsSection.svelte";
  import McpSection from "./lib/settings/McpSection.svelte";
  import SkillsSection from "./lib/settings/SkillsSection.svelte";
  import MemorySection from "./lib/settings/MemorySection.svelte";
  import ChannelsSection from "./lib/settings/ChannelsSection.svelte";
  import ProfilesSection from "./lib/settings/ProfilesSection.svelte";
  import PluginsSection from "./lib/settings/PluginsSection.svelte";
  import ProvidersSection from "./lib/settings/ProvidersSection.svelte";
  import UsageSection from "./lib/settings/UsageSection.svelte";
  import RunHistorySection from "./lib/settings/RunHistorySection.svelte";
  import TraceSection from "./lib/settings/TraceSection.svelte";
  import WebSearchSection from "./lib/settings/WebSearchSection.svelte";
  import ImageGenerateSection from "./lib/settings/ImageGenerateSection.svelte";
  import VideoGenerateSection from "./lib/settings/VideoGenerateSection.svelte";
  import TtsGenerateSection from "./lib/settings/TtsGenerateSection.svelte";
  import { session } from "./lib/stores/session.svelte";
  import { initialLocale, normalizeLocale, translator, type Locale } from "./lib/i18n";
  import {
    buildDiagnosticsSummary,
    loadDesktopBootstrap,
    loadDesktopModels,
    normalizeTheme,
    shouldShowServiceReconnect,
    summarizeDesktopReadiness,
    type DesktopReadiness,
    type DesktopTheme
  } from "./lib/api";

  type Ownership = "managed" | "external";
  type DesktopStatus = {
    service: {
      endpoint: string | null;
      ownership: Ownership | null;
      state: "disconnected" | "ready" | "incompatible" | "error";
      version: string | null;
    };
    launchAtLogin: boolean;
  };

  type SettingsSection = "general" | "models" | "providers" | "agents" | "mcp" | "skills" | "memory" | "channels" | "plugins" | "webSearch" | "imageGenerate" | "videoGenerate" | "ttsGenerate" | "profiles" | "usage" | "runHistory" | "trace" | "sandbox" | "hostBash" | "tasks" | "diagnostics" | "runtimeEnv";
  let locale: Locale =((stored) => stored ? normalizeLocale(stored) : initialLocale())(localStorage.getItem("molibot-desktop-locale"));
  let text = translator(locale);
  let status: DesktopStatus | null = null;
  let busy = false;
  let error = "";
  let ownershipText = "";
  let serviceEndpointText = "";
  let activeSection: SettingsSection = "general";
  let readiness: DesktopReadiness | null = null;
  let loadedReadinessEndpoint = "";
  let diagnosticsCopied = false;
  const THEME_STORAGE_KEY = "molibot-desktop-theme";
  let theme: DesktopTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));

  function applyTheme(value: DesktopTheme): void {
    const root = document.documentElement;
    if (value === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", value);
  }

  function changeTheme(value: DesktopTheme): void {
    theme = value;
    localStorage.setItem(THEME_STORAGE_KEY, value);
    applyTheme(value);
  }

  // Geist owns a single accent (blue-700), defined as --accent / --accent-soft
  // in styles.css per theme. No user-selectable accent palette.

  const THEME_PREVIEWS: { value: DesktopTheme; labelKey: "themeLight" | "themeDark" | "themeSystem" }[] = [
    { value: "light", labelKey: "themeLight" },
    { value: "dark", labelKey: "themeDark" },
    { value: "system", labelKey: "themeSystem" }
  ];

  const SETTINGS_NAV: { id: SettingsSection; icon: string }[] = [
    { id: "general", icon: "gear-six" },
    { id: "models", icon: "cpu" },
    { id: "providers", icon: "plugs" },
    { id: "agents", icon: "robot" },
    { id: "mcp", icon: "plugs-connected" },
    { id: "skills", icon: "magic-wand" },
    { id: "memory", icon: "brain" },
    { id: "channels", icon: "broadcast" },
    { id: "plugins", icon: "puzzle-piece" },
    { id: "webSearch", icon: "globe" },
    { id: "imageGenerate", icon: "image-square" },
    { id: "videoGenerate", icon: "film-slate" },
    { id: "ttsGenerate", icon: "waveform" },
    { id: "profiles", icon: "identification-card" },
    { id: "usage", icon: "chart-bar" },
    { id: "runHistory", icon: "clock-counter-clockwise" },
    { id: "trace", icon: "list-magnifying-glass" },
    { id: "sandbox", icon: "shield-check" },
    { id: "hostBash", icon: "terminal-window" },
    { id: "tasks", icon: "list-checks" },
    { id: "diagnostics", icon: "stethoscope" },
    { id: "runtimeEnv", icon: "package" }
  ];

  const SETTINGS_GROUPS: { id: "general" | "ai" | "channels" | "data" | "system"; sections: SettingsSection[] }[] = [
    { id: "general", sections: ["general"] },
    { id: "ai", sections: ["models", "providers", "usage", "trace", "mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"] },
    { id: "channels", sections: ["profiles", "channels"] },
    { id: "data", sections: ["agents", "memory", "skills", "runHistory", "tasks", "hostBash"] },
    { id: "system", sections: ["runtimeEnv", "sandbox", "plugins", "diagnostics"] }
  ];

  let settingsFilter = "";
  $: localizedSettingsNav = SETTINGS_NAV.map((item) => ({
    ...item,
    label: sectionLabel(item.id, text),
    locale
  }));
  $: filteredSettingsNav = localizedSettingsNav.filter((item) => {
    const query = settingsFilter.trim().toLocaleLowerCase(locale);
    return !query || `${item.label} ${item.id}`.toLocaleLowerCase(locale).includes(query);
  });
  $: localizedSettingsGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    label: settingsGroupLabel(group.id, locale),
    items: group.sections.map((section) => filteredSettingsNav.find((item) => item.id === section)).filter((item): item is (typeof localizedSettingsNav)[number] => Boolean(item))
  })).filter((group) => group.items.length > 0);

  function settingsGroupLabel(group: (typeof SETTINGS_GROUPS)[number]["id"], currentLocale: Locale): string {
    const zh = currentLocale === "zh-CN";
    if (group === "ai") return zh ? "AI 引擎" : "AI Engine";
    if (group === "channels") return zh ? "渠道" : "Channels";
    if (group === "data") return zh ? "助手数据" : "Agent Data";
    if (group === "system") return zh ? "系统" : "System";
    return zh ? "总览" : "General";
  }

  function sectionLabel(section: SettingsSection, copy: typeof text): string {
    switch (section) {
      case "models": return copy.models;
      case "providers": return copy.providers;
      case "agents": return copy.agents;
      case "mcp": return copy.mcp;
      case "skills": return copy.skills;
      case "memory": return copy.memory;
      case "channels": return copy.channels;
      case "plugins": return copy.plugins;
      case "webSearch": return copy.webSearch;
      case "imageGenerate": return copy.imageGenerate;
      case "videoGenerate": return copy.videoGenerate;
      case "ttsGenerate": return copy.ttsGenerate;
      case "profiles": return copy.profiles;
      case "usage": return copy.usage;
      case "runHistory": return copy.runHistory;
      case "trace": return copy.trace;
      case "sandbox": return copy.sandbox;
      case "hostBash": return copy.hostBash;
      case "tasks": return copy.tasks;
      case "diagnostics": return copy.diagnostics;
      case "runtimeEnv": return copy.runtimeEnv;
      default: return copy.general;
    }
  }

  const LOCALE_STORAGE_KEY = "molibot-desktop-locale";

  function changeLocale(value: string): void {
    locale = normalizeLocale(value);
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  const isSettings = new URLSearchParams(window.location.search).get("window") === "settings";
  const runningInTauri = "__TAURI_INTERNALS__" in window;

  function serviceStateLabel(state: "disconnected" | "ready" | "incompatible" | "error" | undefined, copy: typeof text): string {
    if (state === "ready") return copy.diagStateReady;
    if (state === "incompatible") return copy.diagStateIncompatible;
    if (state === "error") return copy.diagStateError;
    return copy.diagStateDisconnected;
  }




  $: serviceReady = status?.service.state === "ready" && !!status?.service.endpoint;
  // Mirror shell state into the shared session store consumed by extracted
  // runes-mode section components.
  $: session.endpoint = status?.service.endpoint ?? null;
  $: session.serviceReady = serviceReady;
  $: session.locale = locale;
  $: session.text = text;
  $: if (isSettings && activeSection === "general" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== loadedReadinessEndpoint) {
    void loadReadiness(status.service.endpoint);
  }

  async function loadReadiness(endpoint: string): Promise<void> {
    loadedReadinessEndpoint = endpoint;
    try {
      const [profiles, textModel] = await Promise.all([
        loadDesktopBootstrap(endpoint),
        loadDesktopModels(endpoint, "text")
      ]);
      readiness = summarizeDesktopReadiness(profiles, textModel);
    } catch (cause) {
      loadedReadinessEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function copyDiagnostics(): Promise<void> {
    const summary = buildDiagnosticsSummary({
      serviceVersion: status?.service.version ?? null,
      ownership: status?.service.ownership ?? null,
      endpoint: status?.service.endpoint ?? null,
      state: status?.service.state ?? "disconnected"
    });
    try {
      await navigator.clipboard.writeText(summary);
      diagnosticsCopied = true;
      window.setTimeout(() => (diagnosticsCopied = false), 1500);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }





  // Revert the page-level draft to its pristine loaded snapshot (the "Discard"
  // action on the unsaved-changes save bar).

  $: text = translator(locale);
  $: ownershipText = !status?.service.ownership
    ? text.unavailable
    : status.service.ownership === "managed"
      ? text.managed
      : text.external;
  $: serviceEndpointText = status?.service.endpoint ?? (status ? text.unavailable : text.serviceStarting);

  async function refreshStatus(): Promise<void> {
    error = "";
    if (!runningInTauri) {
      const previewEnabled = import.meta.env.VITE_MOLIBOT_PREVIEW === "1";
      status = {
        service: {
          endpoint: previewEnabled ? `${window.location.origin}/molibot-api` : null,
          ownership: previewEnabled ? "managed" : null,
          state: previewEnabled ? "ready" : "disconnected",
          version: previewEnabled ? "preview" : null
        },
        launchAtLogin: false
      };
      return;
    }
    try {
      status = await invoke<DesktopStatus>("desktop_status");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function setLoginStart(enabled: boolean): Promise<boolean> {
    if (!status) throw new Error("Desktop status is unavailable");
    if (busy) return status.launchAtLogin;
    if (!runningInTauri) {
      status = { ...status, launchAtLogin: enabled };
      return enabled;
    }
    busy = true;
    error = "";
    try {
      const actual = await invoke<boolean>("set_login_start", { enabled });
      status = { ...status, launchAtLogin: actual };
      return actual;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      busy = false;
    }
  }

  function toggleLoginStart(): void {
    if (!status || busy) return;
    void setLoginStart(!status.launchAtLogin).catch(() => {});
  }

  function openSettings(section?: string): void {
    if (section) localStorage.setItem("molibot-desktop-settings-section", section);
    if (runningInTauri) {
      void invoke("open_settings");
      return;
    }
    window.location.search = "?window=settings";
  }

  function onThemeStorage(event: StorageEvent): void {
    if (event.key === LOCALE_STORAGE_KEY) {
      locale = normalizeLocale(event.newValue);
      return;
    }
    if (event.key !== THEME_STORAGE_KEY) return;
    theme = normalizeTheme(event.newValue);
    applyTheme(theme);
  }

  onMount(() => {
    applyTheme(theme);
    window.addEventListener("storage", onThemeStorage);
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 1000);
    if (isSettings) {
      const pendingSection = localStorage.getItem("molibot-desktop-settings-section");
      if (pendingSection) {
        localStorage.removeItem("molibot-desktop-settings-section");
        activeSection = pendingSection as SettingsSection;
      }
    }
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onThemeStorage);
    };
  });
</script>

<svelte:head>
  <title>{isSettings ? text.settings : text.appName}</title>
</svelte:head>

{#if isSettings}
  <main class="settings-layout">
    <aside class="settings-sidebar">
      <div class="settings-titlebar-space" aria-hidden="true"></div>
      <div class="settings-search">
        <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        <input bind:value={settingsFilter} aria-label={text.settingsSearch} placeholder={text.settingsSearch} />
        {#if settingsFilter}
          <button type="button" aria-label={text.clearSettingsSearch} onclick={() => (settingsFilter = "")}><i class="ph-fill ph-x-circle"></i></button>
        {/if}
      </div>
      <nav class="settings-nav-list" aria-label={text.settings}>
        {#each localizedSettingsGroups as group (group.id)}
          <p class="settings-nav-group-label">{group.label}</p>
          {#each group.items as item (item.id)}
            <button class:active={activeSection === item.id} class="settings-nav" type="button" onclick={() => (activeSection = item.id)}>
              <span class="nav-tile" aria-hidden="true"><i class={`ph-fill ph-${item.icon}`}></i></span>
              <span class="nav-label">{item.label}</span>
            </button>
          {/each}
        {:else}
          <p class="settings-search-empty">{text.settingsSearchEmpty}</p>
        {/each}
      </nav>
      <div class="settings-sidebar-footer">
        <div class="brand-mark" aria-hidden="true">M</div>
        <div class="settings-sidebar-footer-copy"><strong>{text.appName}</strong><small>{text.settings}</small></div>
        <span class="status-dot" data-state={status?.service.state ?? "disconnected"} aria-hidden="true"></span>
      </div>
    </aside>
    <section class="settings-content">
      <header class="page-header settings-page-header">
        <h2>{sectionLabel(activeSection, text)}</h2>
      </header>

      <div class="settings-scroll">

      {#if activeSection === "general"}
        <div class="settings-card">
          <div class="settings-row">
            <strong>{text.uiLanguage}</strong>
            <select class="row-select" value={locale} aria-label={text.uiLanguage} onchange={(event) => changeLocale((event.currentTarget as HTMLSelectElement).value)}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div class="settings-row">
            <div>
              <strong>{text.launchAtLogin}</strong>
              <p>{text.launchAtLoginDescription}</p>
            </div>
            <button
              class:active={status?.launchAtLogin}
              class="switch"
              type="button"
              role="switch"
              aria-label={text.launchAtLogin}
              aria-checked={status?.launchAtLogin ?? false}
              disabled={!status || busy}
              onclick={toggleLoginStart}
            >
              <span></span>
            </button>
          </div>
        </div>

        <p class="settings-group-title">{text.theme}</p>
        <div class="settings-card appearance-card">
          <div class="appearance-block">
            <p class="appearance-label">{text.theme}</p>
            <div class="theme-grid">
              {#each THEME_PREVIEWS as preview (preview.value)}
                <button
                  type="button"
                  class="theme-swatch"
                  class:active={theme === preview.value}
                  data-theme-preview={preview.value}
                  aria-pressed={theme === preview.value}
                  onclick={() => changeTheme(preview.value)}
                >
                  <span class="theme-preview" aria-hidden="true"><span class="tp-side"></span><span class="tp-body"></span></span>
                  <span class="theme-name">{text[preview.labelKey]}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <p class="settings-group-title">{text.service}</p>
        <div class="settings-card">
          <div class="settings-row service-row">
            <div>
              <strong>{text.service}</strong>
              <p>{serviceEndpointText}</p>
            </div>
            <span class="status-badge" data-state={status?.service.state ?? "disconnected"}>
              {ownershipText}
            </span>
          </div>
        </div>

        {#if serviceReady && readiness}
          <p class="settings-group-title">{text.readiness}</p>
          <div class="settings-card">
            <div class="settings-row">
              <div>
                <strong>{text.readinessModel}</strong>
                {#if !readiness.hasModel}<p>{text.readinessModelMissingHint}</p>{/if}
              </div>
              <span class="status-badge" data-state={readiness.hasModel ? "ready" : "error"}>
                {readiness.hasModel ? readiness.modelLabel || text.readinessReady : text.readinessMissing}
              </span>
            </div>
            <div class="settings-row">
              <div>
                <strong>{text.readinessProfile}</strong>
                {#if !readiness.hasProfile}<p>{text.readinessProfileMissingHint}</p>{/if}
              </div>
              <span class="status-badge" data-state={readiness.hasProfile ? "ready" : "error"}>
                {readiness.hasProfile ? `${readiness.profileCount} ${text.profilesUnit}`.trim() : text.readinessMissing}
              </span>
            </div>
          </div>
        {/if}
      {:else if activeSection === "models"}
        <ModelsSection />
      {:else if activeSection === "providers"}
        <ProvidersSection />
      {:else if activeSection === "agents"}
        <AgentsSection />
      {:else if activeSection === "mcp"}
        <McpSection />
      {:else if activeSection === "skills"}
        <SkillsSection />
      {:else if activeSection === "memory"}
        <MemorySection />
      {:else if activeSection === "channels"}
        <ChannelsSection />
      {:else if activeSection === "plugins"}
        <PluginsSection />
      {:else if activeSection === "webSearch"}
        <WebSearchSection />
      {:else if activeSection === "imageGenerate"}
        <ImageGenerateSection />
      {:else if activeSection === "videoGenerate"}
        <VideoGenerateSection />
      {:else if activeSection === "ttsGenerate"}
        <TtsGenerateSection />
      {:else if activeSection === "profiles"}
        <ProfilesSection />
      {:else if activeSection === "usage"}
        <UsageSection />
      {:else if activeSection === "runHistory"}
        <RunHistorySection />
      {:else if activeSection === "trace"}
        <TraceSection />
      {:else if activeSection === "sandbox"}
        <SandboxSection />
      {:else if activeSection === "hostBash"}
        <HostBashSection />
      {:else if activeSection === "tasks"}
        <TasksSection />
      {:else if activeSection === "runtimeEnv"}
        <RuntimeEnvSection />
      {:else}
        <p class="settings-section-hint">{text.diagnosticsHint}</p>
        <div class="settings-card">
          <div class="settings-row">
            <strong>{text.diagServiceVersion}</strong>
            <span class="diag-value">{status?.service.version ?? text.unknownValue}</span>
          </div>
          <div class="settings-row">
            <strong>{text.diagOwnership}</strong>
            <span class="diag-value">{ownershipText}</span>
          </div>
          <div class="settings-row">
            <strong>{text.diagEndpoint}</strong>
            <span class="diag-value">{status?.service.endpoint ?? text.unavailable}</span>
          </div>
          <div class="settings-row">
            <strong>{text.diagState}</strong>
            <span class="status-badge" data-state={status?.service.state ?? "disconnected"}>{serviceStateLabel(status?.service.state, text)}</span>
          </div>
        </div>
        <div class="diag-actions">
          <button class="secondary-button" type="button" onclick={copyDiagnostics}>
            {diagnosticsCopied ? text.copied : text.copyDiagnostics}
          </button>
        </div>
      {/if}

      {#if error || session.error}<p class="error-message">{error || session.error}</p>{/if}
      {#if shouldShowServiceReconnect(serviceReady)}
        <footer class="settings-footbar settings-footbar-notice">
          <button class="secondary-button" type="button" onclick={refreshStatus}>{text.reconnectService}</button>
        </footer>
      {/if}
      </div>
    </section>
  </main>
{:else}
  <ChatView
    copy={text}
    serviceEndpoint={status?.service.endpoint ?? null}
    serviceState={status?.service.state ?? "disconnected"}
    launchAtLogin={status?.launchAtLogin ?? false}
    launchAtLoginBusy={busy}
    setLaunchAtLogin={setLoginStart}
    {openSettings}
  />
{/if}
