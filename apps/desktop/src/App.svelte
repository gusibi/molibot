<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
  import { onMount } from "svelte";
  import ChatView from "./ChatView.svelte";
  import SandboxSection from "./lib/settings/SandboxSection.svelte";
  import HostBashSection from "./lib/settings/HostBashSection.svelte";
  import RuntimeEnvSection from "./lib/settings/RuntimeEnvSection.svelte";
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
  import LogsSection from "./lib/settings/LogsSection.svelte";
  import TraceSection from "./lib/settings/TraceSection.svelte";
  import WebSearchSection from "./lib/settings/WebSearchSection.svelte";
  import ImageGenerateSection from "./lib/settings/ImageGenerateSection.svelte";
  import VideoGenerateSection from "./lib/settings/VideoGenerateSection.svelte";
  import TtsGenerateSection from "./lib/settings/TtsGenerateSection.svelte";
  import WindowDragMask from "./lib/WindowDragMask.svelte";
  import PageHeader from "./lib/components/ui/PageHeader.svelte";
  import SelectControl from "./lib/components/ui/SelectControl.svelte";
  import SettingGroup from "./lib/components/ui/SettingGroup.svelte";
  import SettingRow from "./lib/components/ui/SettingRow.svelte";
  import IosSwitch from "./lib/components/ui/IosSwitch.svelte";
  import StatusBadge from "./lib/components/ui/StatusBadge.svelte";
  import { humanizeModelOption } from "./lib/presentation";
  import { session } from "./lib/stores/session.svelte";
  import { setTaskFeedbackPublisher } from "./lib/stores/tasks.svelte";
  import { initialLocale, normalizeLocale, translator, type Locale } from "./lib/i18n";
  import { initialStartupState, reduceStartup, type StartupState } from "./lib/native/startupCoordinator";
  import { ActivityScheduler, desktopStatusPolicy } from "./lib/native/activityScheduler";
  import { FeedbackCoordinator, browserFeedbackAdapter, createTauriFeedbackAdapter, requestFeedbackPermission, type FeedbackAdapter } from "./lib/native/feedbackCoordinator";
  import { HapticCoordinator, browserHapticAdapter, createTauriHapticAdapter, type HapticAdapter } from "./lib/native/hapticCoordinator";
  import { createTauriWindowState, createWindowState, type WindowStateAdapter, type WindowStateSnapshot } from "./lib/native/windowState";
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
  type CloseBehavior = "background" | "quit";
  type NotificationPreference = "off" | "enabled";
  type HapticPreference = "off" | "system";

  type DesktopStatus = {
    service: {
      endpoint: string | null;
      ownership: Ownership | null;
      state: "disconnected" | "ready" | "incompatible" | "error";
      version: string | null;
    };
    launchAtLogin: boolean;
    closeBehavior: CloseBehavior;
    notificationPreference: NotificationPreference;
    hapticPreference: HapticPreference;
  };

  type SettingsSection = "general" | "models" | "providers" | "agents" | "mcp" | "skills" | "memory" | "channels" | "plugins" | "webSearch" | "imageGenerate" | "videoGenerate" | "ttsGenerate" | "profiles" | "usage" | "runHistory" | "logs" | "trace" | "sandbox" | "hostBash" | "diagnostics" | "runtimeEnv";
  let locale: Locale =((stored) => stored ? normalizeLocale(stored) : initialLocale())(localStorage.getItem("molibot-desktop-locale"));
  let text = translator(locale);
  let status: DesktopStatus | null = null;
  let startup: StartupState = initialStartupState;
  let statusScheduler: ActivityScheduler | null = null;
  let windowStateAdapter: WindowStateAdapter | null = null;
  let windowStateUnsubscribe: (() => void) | null = null;
  let windowState: WindowStateSnapshot | null = null;
  let feedbackAdapter: FeedbackAdapter = browserFeedbackAdapter;
  let feedbackCoordinator: FeedbackCoordinator | null = null;
  let feedbackActionCleanup: (() => void) | null = null;
  let feedbackAnnouncement = "";
  let serviceTransitionGeneration = 0;
  let serviceFetchFailed = false;
  let hapticAdapter: HapticAdapter = browserHapticAdapter;
  let hapticCoordinator: HapticCoordinator | null = null;
  let startupDelayTimer: number | null = null;
  let busy = false;
  let error = "";
  let ownershipText = "";
  let serviceEndpointText = "";
  let activeSection: SettingsSection = "general";
  let readiness: DesktopReadiness | null = null;
  let loadedReadinessEndpoint = "";
  let diagnosticsCopied = false;
  let appVersion: string | null = null;
  let servicePort = 3000;
  let servicePortLoadedFrom = "";
  let servicePortBusy = false;
  const THEME_STORAGE_KEY = "molibot-desktop-theme";
  const LOW_PERFORMANCE_STORAGE_KEY = "molibot-desktop-low-performance";
  const runningInTauri = "__TAURI_INTERNALS__" in window;
  let theme: DesktopTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  let lowPerformance = localStorage.getItem(LOW_PERFORMANCE_STORAGE_KEY) === "true";
  const previewPane = new URL(window.location.href).searchParams.get("pane");
  let requestedChatPane: "chat" | "automations" | "skills" | "agents" = !runningInTauri && ["automations", "skills", "agents"].includes(previewPane ?? "")
    ? previewPane as "automations" | "skills" | "agents"
    : "chat";
  let settingsScrolled = false;

  function applyWindowState(snapshot: WindowStateSnapshot): void {
    windowState = snapshot;
    const root = document.documentElement;
    root.dataset.windowActive = snapshot.active ? "true" : "false";
    root.dataset.nativeTheme = snapshot.theme;
    root.dataset.scale = String(snapshot.scaleFactor);
    root.dataset.reducedTransparency = snapshot.reducedTransparency ? "true" : "false";
    root.dataset.increasedContrast = snapshot.increasedContrast ? "true" : "false";
  }

  async function startWindowState(): Promise<void> {
    windowStateAdapter = runningInTauri ? await createTauriWindowState() : createWindowState();
    await windowStateAdapter.setTheme(theme === "system" ? null : theme);
    applyWindowState(windowStateAdapter.snapshot);
    windowStateUnsubscribe = windowStateAdapter.subscribe(applyWindowState);
    await windowStateAdapter.start();
  }

  async function startFeedback(): Promise<void> {
    feedbackAdapter = runningInTauri ? await createTauriFeedbackAdapter() : browserFeedbackAdapter;
    feedbackCoordinator = new FeedbackCoordinator(
      feedbackAdapter,
      () => windowState?.active ?? document.hasFocus(),
      () => status?.notificationPreference ?? "off",
      (message) => { feedbackAnnouncement = message; }
    );
    setTaskFeedbackPublisher((event) => publishFeedback(event));
    feedbackActionCleanup = await feedbackAdapter.onAction?.(() => {
      void invoke("show_main_window");
    }) ?? null;
  }

  async function startHaptics(): Promise<void> {
    hapticAdapter = runningInTauri ? await createTauriHapticAdapter() : browserHapticAdapter;
    hapticCoordinator = new HapticCoordinator(hapticAdapter, () => status?.hapticPreference ?? "system");
  }

  function commitHaptic(gestureId: string): void {
    void hapticCoordinator?.commit(gestureId);
  }

  function applyTheme(value: DesktopTheme): void {
    const root = document.documentElement;
    if (value === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", value);
    void windowStateAdapter?.setTheme(value === "system" ? null : value);
  }

  function changeTheme(value: DesktopTheme): void {
    theme = value;
    localStorage.setItem(THEME_STORAGE_KEY, value);
    const root = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-transition");
      window.setTimeout(() => root.classList.remove("theme-transition"), 300);
    }
    applyTheme(value);
  }

  function applyPerformanceMode(value: boolean): void {
    const automaticallyReduced = window.matchMedia("(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce)").matches
      || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
    document.documentElement.dataset.performance = value || automaticallyReduced ? "low" : "standard";
  }

  function changePerformanceMode(value: boolean): void {
    lowPerformance = value;
    localStorage.setItem(LOW_PERFORMANCE_STORAGE_KEY, String(value));
    applyPerformanceMode(value);
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
    { id: "logs", icon: "terminal-window" },
    { id: "trace", icon: "list-magnifying-glass" },
    { id: "sandbox", icon: "shield-check" },
    { id: "hostBash", icon: "terminal-window" },
    { id: "diagnostics", icon: "stethoscope" },
    { id: "runtimeEnv", icon: "package" }
  ];

  const SETTINGS_GROUPS: { id: "general" | "models" | "assistant" | "tools" | "channels" | "activity" | "system"; sections: SettingsSection[] }[] = [
    { id: "general", sections: ["general"] },
    { id: "models", sections: ["models", "providers"] },
    { id: "assistant", sections: ["agents", "skills", "memory"] },
    { id: "tools", sections: ["mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate", "hostBash"] },
    { id: "channels", sections: ["profiles", "channels"] },
    { id: "activity", sections: ["runHistory", "usage", "trace", "logs"] },
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
    if (group === "models") return zh ? "模型" : "Models";
    if (group === "assistant") return zh ? "助手" : "Assistant";
    if (group === "tools") return zh ? "工具" : "Tools";
    if (group === "channels") return zh ? "渠道" : "Channels";
    if (group === "activity") return zh ? "活动" : "Activity";
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
      case "logs": return copy.logs;
      case "trace": return copy.trace;
      case "sandbox": return copy.sandbox;
      case "hostBash": return copy.hostBash;
      case "diagnostics": return copy.diagnostics;
      case "runtimeEnv": return copy.runtimeEnv;
      default: return copy.general;
    }
  }

  function sectionDescription(section: SettingsSection, copy: typeof text): string {
    switch (section) {
      case "models": return copy.modelsHint;
      case "providers": return copy.providersHint;
      case "agents": return copy.agentsHint;
      case "mcp": return copy.mcpHint;
      case "skills": return copy.skillsHint;
      case "memory": return copy.memoryHint;
      case "channels": return copy.channelsHint;
      case "plugins": return copy.pluginsHint;
      case "webSearch": return copy.webSearchHint;
      case "imageGenerate": return copy.imageGenerateHint;
      case "videoGenerate": return copy.videoGenerateHint;
      case "ttsGenerate": return copy.ttsGenerateHint;
      case "profiles": return copy.profilesHint;
      case "usage": return copy.usageHint;
      case "runHistory": return copy.runHistoryHint;
      case "logs": return copy.logsHint;
      case "trace": return copy.traceHint;
      case "sandbox": return copy.sandboxHint;
      case "hostBash": return copy.hostBashHint;
      case "diagnostics": return copy.diagnosticsHint;
      case "runtimeEnv": return copy.runtimeEnvHint;
      default: return copy.generalHint;
    }
  }

  function selectSettingsSection(section: SettingsSection): void {
    activeSection = section;
    settingsScrolled = false;
  }

  const LOCALE_STORAGE_KEY = "molibot-desktop-locale";

  function changeLocale(value: string): void {
    locale = normalizeLocale(value);
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  const isSettings = new URLSearchParams(window.location.search).get("window") === "settings";

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
  $: document.documentElement.lang = locale;
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
      appVersion,
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

  async function loadAppVersion(): Promise<void> {
    if (!runningInTauri) {
      appVersion = "preview";
      return;
    }
    try {
      appVersion = await getVersion();
    } catch {
      appVersion = null;
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

  function publishFeedback(event: Parameters<FeedbackCoordinator["publish"]>[0]): void {
    void feedbackCoordinator?.publish(event);
  }

  function publishCommandResult(result: { id: string; status: "executed" | "disabled" | "failed" | "unknown" }): void {
    publishFeedback({
      id: `command:${result.id}:${result.status}`,
      kind: "command",
      terminal: true,
      title: text.appName,
      body: result.status === "executed" ? text.commandCompleted : text.commandFailed
    });
  }

  function publishServiceTransition(previous: DesktopStatus | null, next: DesktopStatus): void {
    if (!previous || previous.service.state === next.service.state) return;
    const recovered = next.service.state === "ready" && Boolean(next.service.endpoint);
    publishFeedback({
      id: `service:${++serviceTransitionGeneration}`,
      kind: "service",
      terminal: true,
      title: text.appName,
      body: recovered ? text.serviceRecovered : text.serviceUnavailable
    });
  }

  function applyStartupStatus(next: DesktopStatus): void {
    startup = reduceStartup(startup, {
      type: "status",
      ready: next.service.state === "ready" && Boolean(next.service.endpoint),
      recoverable: next.service.state !== "incompatible" && next.service.state !== "error"
    });
  }

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
        launchAtLogin: false,
        closeBehavior: "background",
        notificationPreference: "off",
        hapticPreference: "system"
      };
      applyStartupStatus(status);
      return;
    }
    try {
      const previous = status;
      const nextStatus = await invoke<DesktopStatus>("desktop_status");
      status = nextStatus;
      serviceFetchFailed = false;
      applyStartupStatus(nextStatus);
      publishServiceTransition(previous, nextStatus);
      const endpoint = nextStatus.service.endpoint;
      if (endpoint && status.service.state === "ready" && servicePortLoadedFrom !== endpoint) {
        const response = await tauriFetch(`${endpoint}/api/settings/system`);
        const payload = await response.json();
        if (response.ok && payload?.ok) {
          servicePort = Number(payload.serverPort) || 3000;
          servicePortLoadedFrom = endpoint;
        }
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      startup = reduceStartup(startup, { type: "failed", error });
      if (serviceFetchFailed) return;
      serviceFetchFailed = true;
      publishFeedback({
        id: `service:${++serviceTransitionGeneration}`,
        kind: "service",
        terminal: true,
        title: text.appName,
        body: text.serviceUnavailable
      });
    }
  }

  function retryStartup(): void {
    startup = reduceStartup(startup, { type: "retry" });
    statusScheduler?.wake("retry");
  }

  function openStartupDiagnostics(): void {
    openSettings("diagnostics");
  }

  function openStartupLogs(): void {
    if (runningInTauri) void invoke("open_desktop_log");
  }

  async function saveServicePort(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint) return;
    servicePortBusy = true;
    error = "";
    try {
      const response = await tauriFetch(`${endpoint}/api/settings/system`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverPort: Number(servicePort) })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || text.servicePortSaveFailed);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      servicePortBusy = false;
    }
  }

  async function restartManagedService(): Promise<void> {
    servicePortBusy = true;
    error = "";
    try {
      await saveServicePort();
      if (error) return;
      servicePortLoadedFrom = "";
      await invoke("restart_service");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      servicePortBusy = false;
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

  async function setCloseBehavior(closeBehavior: CloseBehavior): Promise<CloseBehavior> {
    if (!status) throw new Error("Desktop status is unavailable");
    if (busy) return status.closeBehavior;
    if (!runningInTauri) {
      status = { ...status, closeBehavior };
      return closeBehavior;
    }
    busy = true;
    error = "";
    try {
      const actual = await invoke<CloseBehavior>("set_close_behavior", { closeBehavior });
      status = { ...status, closeBehavior: actual };
      return actual;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      busy = false;
    }
  }

  async function setNotificationPreference(enabled: boolean): Promise<void> {
    if (!status || busy) return;
    if (!enabled) {
      await saveNotificationPreference("off");
      return;
    }
    const permission = await requestFeedbackPermission(feedbackAdapter);
    if (permission !== "granted") {
      feedbackAnnouncement = text.nativeNotificationsPermissionDenied;
      return;
    }
    await saveNotificationPreference("enabled");
  }

  async function saveNotificationPreference(notificationPreference: NotificationPreference): Promise<void> {
    if (!status) throw new Error("Desktop status is unavailable");
    if (!runningInTauri) {
      status = { ...status, notificationPreference };
      return;
    }
    busy = true;
    error = "";
    try {
      const actual = await invoke<NotificationPreference>("set_notification_preference", { notificationPreference });
      status = { ...status, notificationPreference: actual };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      busy = false;
    }
  }

  async function saveHapticPreference(hapticPreference: HapticPreference): Promise<void> {
    if (!status) throw new Error("Desktop status is unavailable");
    if (!runningInTauri) {
      status = { ...status, hapticPreference };
      return;
    }
    busy = true;
    error = "";
    try {
      const actual = await invoke<HapticPreference>("set_haptic_preference", { hapticPreference });
      status = { ...status, hapticPreference: actual };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      busy = false;
    }
  }

  function toggleHapticPreference(enabled: boolean): void {
    void saveHapticPreference(enabled ? "system" : "off").catch(() => {});
  }

  function toggleNotificationPreference(enabled: boolean): void {
    void setNotificationPreference(enabled).catch(() => {});
  }

  function toggleCloseBehavior(): void {
    if (!status || busy) return;
    void setCloseBehavior(status.closeBehavior === "background" ? "quit" : "background").catch(() => {});
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
    applyPerformanceMode(lowPerformance);
    void startWindowState();
    void startFeedback();
    void startHaptics();
    window.addEventListener("storage", onThemeStorage);
    void loadAppVersion();
    startupDelayTimer = window.setTimeout(() => {
      startup = reduceStartup(startup, { type: "delayed" });
    }, 8_000);
    statusScheduler = new ActivityScheduler(
      desktopStatusPolicy,
      refreshStatus,
      {
        hidden: () => document.hidden,
        subscribe(listener) {
          const onVisibilityChange = () => {
            if (!document.hidden) listener();
          };
          document.addEventListener("visibilitychange", onVisibilityChange);
          return () => document.removeEventListener("visibilitychange", onVisibilityChange);
        }
      }
    );
    statusScheduler.start();
    if (isSettings) {
      const pendingSection = localStorage.getItem("molibot-desktop-settings-section");
      if (pendingSection) {
        localStorage.removeItem("molibot-desktop-settings-section");
        activeSection = pendingSection as SettingsSection;
      }
    }
    return () => {
      if (startupDelayTimer) window.clearTimeout(startupDelayTimer);
      startupDelayTimer = null;
      statusScheduler?.dispose();
      statusScheduler = null;
      windowStateUnsubscribe?.();
      windowStateUnsubscribe = null;
      windowStateAdapter?.dispose();
      windowStateAdapter = null;
      windowState = null;
      feedbackActionCleanup?.();
      feedbackActionCleanup = null;
      feedbackCoordinator = null;
      hapticCoordinator = null;
      setTaskFeedbackPublisher(null);
      window.removeEventListener("storage", onThemeStorage);
    };
  });
</script>

<svelte:head>
  <title>{isSettings ? text.settings : text.appName}</title>
</svelte:head>

{#if feedbackAnnouncement}
  <p class="sr-only" role="status" aria-live="polite">{feedbackAnnouncement}</p>
{/if}

{#if isSettings}
  <main class="settings-layout">
    <WindowDragMask />
    <aside class="settings-sidebar">
      <div class="settings-titlebar-space" data-tauri-drag-region aria-hidden="true"></div>
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
            <button class:active={activeSection === item.id} class="settings-nav" type="button" onclick={() => selectSettingsSection(item.id)}>
              <span class="nav-tile" aria-hidden="true"><i class={`ph-fill ph-${item.icon}`}></i></span>
              <span class="nav-label">{item.label}</span>
            </button>
          {/each}
        {:else}
          <p class="settings-search-empty">{text.settingsSearchEmpty}</p>
        {/each}
      </nav>
      <div class="settings-sidebar-footer">
        <img class="settings-footer-avatar" src="/molibot-icon.png" alt="" />
        <div class="settings-sidebar-footer-copy"><strong>{text.appName}</strong><small>{serviceStateLabel(status?.service.state, text)}</small></div>
        <span class="status-dot" data-state={status?.service.state ?? "disconnected"} aria-hidden="true"></span>
      </div>
    </aside>
    <section class="settings-content">
      <PageHeader title={sectionLabel(activeSection, text)} description={sectionDescription(activeSection, text)} dataPage={activeSection === "trace" || activeSection === "usage" || activeSection === "memory"} scrolled={settingsScrolled} />

      <div class="settings-scroll" data-section={activeSection} onscroll={(event) => (settingsScrolled = event.currentTarget.scrollTop > 2)}>

      {#if activeSection === "general"}
        <SettingGroup ariaLabel={text.general}>
          <SettingRow title={text.uiLanguage}>
            <SelectControl value={locale} ariaLabel={text.uiLanguage} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }]} onChange={changeLocale} />
          </SettingRow>
          <SettingRow title={text.launchAtLogin} description={text.launchAtLoginDescription}>
            <IosSwitch
              checked={status?.launchAtLogin ?? false}
              ariaLabel={text.launchAtLogin}
              disabled={!status || busy}
              onCheckedChange={setLoginStart}
            />
          </SettingRow>
          <SettingRow title={text.closeToMenuBar} description={text.closeToMenuBarDescription}>
            <IosSwitch
              checked={status?.closeBehavior === "background"}
              ariaLabel={text.closeToMenuBar}
              disabled={!status || busy}
              onCheckedChange={toggleCloseBehavior}
            />
          </SettingRow>
          <SettingRow title={text.nativeNotifications} description={text.nativeNotificationsDescription}>
            <IosSwitch
              checked={status?.notificationPreference === "enabled"}
              ariaLabel={text.nativeNotifications}
              disabled={!status || busy}
              onCheckedChange={toggleNotificationPreference}
            />
          </SettingRow>
          <SettingRow title={text.hapticFeedback} description={text.hapticFeedbackDescription}>
            <IosSwitch
              checked={status?.hapticPreference === "system"}
              ariaLabel={text.hapticFeedback}
              disabled={!status || busy}
              onCheckedChange={toggleHapticPreference}
            />
          </SettingRow>
          <SettingRow title={text.lowPerformanceMode} description={text.lowPerformanceModeDescription}>
            <IosSwitch checked={lowPerformance} ariaLabel={text.lowPerformanceMode} onCheckedChange={changePerformanceMode} />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title={text.theme} contentClass="appearance-card">
          <div class="appearance-block">
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
        </SettingGroup>

        <SettingGroup title={text.service}>
          <SettingRow title={text.service} description={serviceEndpointText}>
            <StatusBadge label={ownershipText} state={status?.service.state ?? "disconnected"} />
          </SettingRow>
          <SettingRow title={text.servicePort} description={text.servicePortDescription}>
            <input class="row-input" type="number" min="1024" max="65535" step="1" bind:value={servicePort} disabled={!serviceReady || servicePortBusy} />
          </SettingRow>
          <SettingRow title={text.restartService} description={text.restartServiceDescription}>
            <button class="secondary-button" type="button" onclick={restartManagedService} disabled={!serviceReady || status?.service.ownership !== "managed" || servicePortBusy}>
              {servicePortBusy ? text.restartingService : text.saveAndRestart}
            </button>
          </SettingRow>
        </SettingGroup>

        {#if serviceReady && readiness}
          <SettingGroup title={text.readiness}>
            <SettingRow title={text.readinessModel} description={readiness.hasModel ? "" : text.readinessModelMissingHint}>
              <StatusBadge label={readiness.hasModel ? (readiness.modelLabel ? humanizeModelOption(readiness.modelLabel, readiness.modelLabel).label : text.readinessReady) : text.readinessMissing} state={readiness.hasModel ? "ready" : "error"} />
            </SettingRow>
            <SettingRow title={text.readinessProfile} description={readiness.hasProfile ? "" : text.readinessProfileMissingHint}>
              <StatusBadge label={readiness.hasProfile ? `${readiness.profileCount} ${text.profilesUnit}`.trim() : text.readinessMissing} state={readiness.hasProfile ? "ready" : "error"} />
            </SettingRow>
          </SettingGroup>
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
      {:else if activeSection === "logs"}
        <LogsSection />
      {:else if activeSection === "trace"}
        <TraceSection />
      {:else if activeSection === "sandbox"}
        <SandboxSection />
      {:else if activeSection === "hostBash"}
        <HostBashSection />
      {:else if activeSection === "runtimeEnv"}
        <RuntimeEnvSection />
      {:else}
        <p class="settings-section-hint">{text.diagnosticsHint}</p>
        <div class="settings-card">
          <div class="settings-row">
            <strong>{text.diagAppVersion}</strong>
            <span class="diag-value">{appVersion ?? text.unknownValue}</span>
          </div>
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
    {locale}
    startupPhase={startup.phase}
    startupError={startup.error}
    {retryStartup}
    {openStartupDiagnostics}
    {openStartupLogs}
    serviceEndpoint={status?.service.endpoint ?? null}
    serviceState={status?.service.state ?? "disconnected"}
    serviceOwnership={status?.service.ownership ?? null}
    launchAtLogin={status?.launchAtLogin ?? false}
    launchAtLoginBusy={busy}
    setLaunchAtLogin={setLoginStart}
    onHapticCommit={commitHaptic}
    onCommandResult={publishCommandResult}
    {openSettings}
    requestedWorkspacePane={requestedChatPane}
  />
{/if}
