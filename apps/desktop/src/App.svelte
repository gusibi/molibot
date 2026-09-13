<script lang="ts">
  import AddCircle from "reicon-svelte/icons/AddCircle";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import Box from "reicon-svelte/icons/Box";
  import Card from "reicon-svelte/icons/Card";
  import Chart from "reicon-svelte/icons/Chart";
  import Cpu from "reicon-svelte/icons/Cpu";
  import Database from "reicon-svelte/icons/Database";
  import Film from "reicon-svelte/icons/Film";
  import Gear from "reicon-svelte/icons/Gear";
  import Archive2 from "reicon-svelte/icons/Archive2";
  import Globe from "reicon-svelte/icons/Globe";
  import History from "reicon-svelte/icons/History";
  import Image from "reicon-svelte/icons/Image";
  import MagicWand from "reicon-svelte/icons/MagicWand";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Plug from "reicon-svelte/icons/Plug";
  import PlugCircle from "reicon-svelte/icons/PlugCircle";
  import PuzzlePiece from "reicon-svelte/icons/PuzzlePiece";
  import Radio from "reicon-svelte/icons/Radio";
  import Search from "reicon-svelte/icons/Search";
  import ShieldCheck from "reicon-svelte/icons/ShieldCheck";
  import Soundwave from "reicon-svelte/icons/Soundwave";
  import Stethoscope from "reicon-svelte/icons/Stethoscope";
  import TerminalSquare from "reicon-svelte/icons/TerminalSquare";
  import XCircle from "reicon-svelte/icons/XCircle";
  import { invoke } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
  import { onMount } from "svelte";
  import ChatView from "./ChatView.svelte";
  import { tablist } from "./lib/a11y/tablist";
  import ExecutionPermissionsSection from "./lib/settings/ExecutionPermissionsSection.svelte";
  import HostBashSection from "./lib/settings/HostBashSection.svelte";
  import RuntimeEnvSection from "./lib/settings/RuntimeEnvSection.svelte";
  import ModelsSection from "./lib/settings/ModelsSection.svelte";
  import AgentsSection from "./lib/settings/AgentsSection.svelte";
  import McpSection from "./lib/settings/McpSection.svelte";
  import OpenConnectorSection from "./lib/settings/OpenConnectorSection.svelte";
  import SkillsSection from "./lib/settings/SkillsSection.svelte";
  import MemorySection from "./lib/settings/MemorySection.svelte";
  import SessionManagementSection from "./lib/settings/SessionManagementSection.svelte";
  import ChannelsSection from "./lib/settings/ChannelsSection.svelte";
  import ProfilesSection from "./lib/settings/ProfilesSection.svelte";
  import PluginsSection from "./lib/settings/PluginsSection.svelte";
  import ProvidersSection from "./lib/settings/ProvidersSection.svelte";
  import UsageSection from "./lib/settings/UsageSection.svelte";
  import RunHistorySection from "./lib/settings/RunHistorySection.svelte";
  import LogsSection from "./lib/settings/LogsSection.svelte";
  import TraceSection from "./lib/settings/TraceSection.svelte";
  import WebSearchSection from "./lib/settings/WebSearchSection.svelte";
  import ImageSettingsSection from "./lib/settings/ImageSettingsSection.svelte";
  import VideoGenerateSection from "./lib/settings/VideoGenerateSection.svelte";
  import TtsGenerateSection from "./lib/settings/TtsGenerateSection.svelte";
  import WindowDragMask from "./lib/WindowDragMask.svelte";
  import PageHeader from "./lib/components/ui/PageHeader.svelte";
  import SelectControl from "./lib/components/ui/SelectControl.svelte";
  import SettingGroup from "./lib/components/ui/SettingGroup.svelte";
  import SettingRow from "./lib/components/ui/SettingRow.svelte";
  import IosSwitch from "./lib/components/ui/IosSwitch.svelte";
  import StatusBadge from "./lib/components/ui/StatusBadge.svelte";
  import type { ReiconComponent } from "./lib/components/ui/iconTypes";
  import { humanizeModelOption } from "./lib/presentation";
  import { session, SETTINGS_CHANGED_EVENT, NAVIGATE_SETTINGS_EVENT } from "./lib/stores/session.svelte";
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
    normalizeAppearance,
    normalizeThemeFamily,
    shouldShowServiceReconnect,
    summarizeDesktopReadiness,
    type DesktopReadiness,
    type DesktopAppearance,
    type DesktopThemeFamily
  } from "./lib/api";
  import { hydrateImportedTheme, ThemeImportError, toStoredImportedTheme, type ImportedTheme } from "./lib/theme/vscodeTheme";
  import { applyImportedThemeStyle, clearImportedThemeStyle } from "./lib/theme/themeStyle";
  import { deleteImportedTheme, listImportedThemes, listThemeDirectories, openThemeDirectory, pickThemeSourceFile, saveImportedTheme, type ThemeSourceDirectory } from "./lib/native/importedThemes";

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

  type SettingsSection = "general" | "models" | "providers" | "agents" | "mcp" | "openConnector" | "skills" | "memory" | "sessionManagement" | "channels" | "plugins" | "webSearch" | "imageGenerate" | "videoGenerate" | "ttsGenerate" | "profiles" | "usage" | "runHistory" | "logs" | "trace" | "executionPermissions" | "hostBash" | "diagnostics" | "runtimeEnv";
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
  let servicePort = 3040;
  let servicePortLoadedFrom = "";
  let servicePortBusy = false;
  let systemAppearanceQuery: MediaQueryList | null = null;
  let onSystemAppearanceChange: (() => void) | null = null;
  const APPEARANCE_STORAGE_KEY = "molibot-desktop-appearance";
  const THEME_FAMILY_STORAGE_KEY = "molibot-desktop-theme-family";
  const IMPORTED_THEME_STORAGE_KEY = "molibot-desktop-imported-theme";
  const LOW_PERFORMANCE_STORAGE_KEY = "molibot-desktop-low-performance";
  const runningInTauri = "__TAURI_INTERNALS__" in window;
  let appearance: DesktopAppearance = normalizeAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
  let themeFamily: DesktopThemeFamily = normalizeThemeFamily(localStorage.getItem(THEME_FAMILY_STORAGE_KEY));
  let importedThemes: ImportedTheme[] = [];
  let activeImportedThemeId: string | null = localStorage.getItem(IMPORTED_THEME_STORAGE_KEY);
  let themeImportBusy = false;
  let themeImportError = "";
  let themeDirectories: ThemeSourceDirectory[] = [];
  let themeDirectoryBusy = "";
  let themeDirectoryError = "";
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

  function nativeThemeFor(value: DesktopAppearance): "light" | "dark" | null {
    if (value === "system") return null;
    return value === "light" ? "light" : "dark";
  }

  function resolvedAppearance(value: DesktopAppearance): "light" | "dark" {
    if (value !== "system") return value;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  async function startWindowState(): Promise<void> {
    windowStateAdapter = runningInTauri ? await createTauriWindowState() : createWindowState();
    await windowStateAdapter.setTheme(effectiveNativeTheme(appearance));
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

  function activeImportedTheme(): ImportedTheme | null {
    if (!activeImportedThemeId) return null;
    return importedThemes.find((theme) => theme.id === activeImportedThemeId) ?? null;
  }

  // The native window appearance must agree with the resolved ramp: a
  // single-variant imported theme overrides the user brightness control.
  function effectiveNativeTheme(value: DesktopAppearance): "light" | "dark" | null {
    return activeImportedTheme()?.variant ?? nativeThemeFor(value);
  }

  function applyTheme(value: DesktopAppearance, family: DesktopThemeFamily): void {
    const root = document.documentElement;
    const imported = activeImportedTheme();
    root.dataset.appearance = value;
    void windowStateAdapter?.setTheme(effectiveNativeTheme(value));
    if (imported) {
      // A single-variant import owns its own light/dark state, so brightness
      // resolves to the theme's declared variant instead of the user control.
      root.dataset.themeFamily = `imported-${imported.id}`;
      root.dataset.resolvedAppearance = imported.variant;
      applyImportedThemeStyle(document, imported);
      return;
    }
    clearImportedThemeStyle(document);
    root.dataset.themeFamily = family;
    root.dataset.resolvedAppearance = resolvedAppearance(value);
  }

  function transitionTheme(): void {
    const root = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-transition");
      window.setTimeout(() => root.classList.remove("theme-transition"), 300);
    }
  }

  function changeAppearance(value: DesktopAppearance): void {
    appearance = value;
    localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
    transitionTheme();
    applyTheme(value, themeFamily);
  }

  function changeThemeFamily(value: DesktopThemeFamily): void {
    if (activeImportedThemeId) {
      activeImportedThemeId = null;
      localStorage.removeItem(IMPORTED_THEME_STORAGE_KEY);
    }
    themeFamily = value;
    localStorage.setItem(THEME_FAMILY_STORAGE_KEY, value);
    transitionTheme();
    applyTheme(appearance, value);
  }

  function changeImportedTheme(id: string): void {
    activeImportedThemeId = id;
    localStorage.setItem(IMPORTED_THEME_STORAGE_KEY, id);
    transitionTheme();
    applyTheme(appearance, themeFamily);
  }

  function importedSwatchColors(theme: ImportedTheme): { side: string; body: string } {
    return {
      side: theme.tokens["--sidebar-bg"] ?? theme.tokens["--panel-bg"] ?? "#000000",
      body: theme.tokens["--mac-window-background"] ?? theme.tokens["--card-bg"] ?? "#ffffff"
    };
  }

  async function refreshImportedThemes(): Promise<void> {
    const stored = await listImportedThemes();
    importedThemes = stored
      .map(hydrateImportedTheme)
      .filter((theme): theme is ImportedTheme => theme !== null);
  }

  async function loadImportedThemes(): Promise<void> {
    if (!runningInTauri) return;
    try {
      await refreshImportedThemes();
    } catch {
      importedThemes = [];
    }
    if (activeImportedThemeId && !importedThemes.some((theme) => theme.id === activeImportedThemeId)) {
      activeImportedThemeId = null;
      localStorage.removeItem(IMPORTED_THEME_STORAGE_KEY);
    }
    applyTheme(appearance, themeFamily);
  }

  const THEME_DIRECTORY_NAMES: Record<string, string> = {
    vscode: "VS Code",
    "vscode-insiders": "VS Code Insiders",
    antigravity: "Antigravity",
    cursor: "Cursor",
    vscodium: "VSCodium",
    windsurf: "Windsurf"
  };

  async function loadThemeDirectories(): Promise<void> {
    if (!runningInTauri) return;
    try {
      themeDirectories = await listThemeDirectories();
    } catch {
      themeDirectories = [];
    }
  }

  function themeDirectoryLabel(directory: ThemeSourceDirectory): string {
    const base = directory.id.replace(/-extensions$/, "");
    const name = THEME_DIRECTORY_NAMES[base] ?? base;
    const prefix = directory.kind === "extensions" ? text.openExtensionDirectory : text.openThemeDirectory;
    return `${prefix} · ${name}`;
  }

  async function openThemeDirectoryAction(id: string): Promise<void> {
    if (!runningInTauri || themeDirectoryBusy) return;
    themeDirectoryBusy = id;
    themeDirectoryError = "";
    try {
      await openThemeDirectory(id);
    } catch (cause) {
      themeDirectoryError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      themeDirectoryBusy = "";
    }
  }

  function themeImportErrorMessage(cause: unknown): string {
    if (cause instanceof ThemeImportError) {
      return cause.code === "json-parse" ? text.themeImportInvalidJson : text.themeImportUnsupported;
    }
    return cause instanceof Error ? cause.message : String(cause);
  }

  async function importVscodeTheme(): Promise<void> {
    if (!runningInTauri || themeImportBusy) return;
    themeImportBusy = true;
    themeImportError = "";
    try {
      const file = await pickThemeSourceFile();
      if (!file) return;
      const stored = toStoredImportedTheme(file.contents);
      await saveImportedTheme(stored);
      await refreshImportedThemes();
      changeImportedTheme(stored.id);
    } catch (cause) {
      themeImportError = themeImportErrorMessage(cause);
    } finally {
      themeImportBusy = false;
    }
  }

  async function removeImportedTheme(id: string): Promise<void> {
    if (!runningInTauri || themeImportBusy) return;
    themeImportBusy = true;
    themeImportError = "";
    try {
      await deleteImportedTheme(id);
      await refreshImportedThemes();
      if (activeImportedThemeId === id) {
        activeImportedThemeId = null;
        localStorage.removeItem(IMPORTED_THEME_STORAGE_KEY);
        applyTheme(appearance, themeFamily);
      }
    } catch (cause) {
      themeImportError = themeImportErrorMessage(cause);
    } finally {
      themeImportBusy = false;
    }
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

  const APPEARANCE_OPTIONS: { value: DesktopAppearance; labelKey: "appearanceLight" | "appearanceDark" | "appearanceSystem" }[] = [
    { value: "light", labelKey: "appearanceLight" },
    { value: "dark", labelKey: "appearanceDark" },
    { value: "system", labelKey: "appearanceSystem" }
  ];

  const THEME_FAMILY_PREVIEWS: {
    value: DesktopThemeFamily;
    labelKey:
      | "themeFamilyMacos"
      | "themeFamilyRosePine"
      | "themeFamilyCatppuccin"
      | "themeFamilyMidnight"
      | "themeFamilyWin98"
      | "themeFamilyTerminal"
      | "themeFamilyBrutalism"
      | "themeFamilyBlueprint"
      | "themeFamilySystem6"
      | "themeFamilyCyberpunk";
    lightVariantKey:
      | "themeVariantMacosLight"
      | "themeVariantDawn"
      | "themeVariantLatte"
      | "themeVariantDaybreak"
      | "themeVariantWin98Classic"
      | "themeVariantTerminalPaper"
      | "themeVariantBrutalismPoster"
      | "themeVariantBlueprintVellum"
      | "themeVariantSystem6White"
      | "themeVariantCyberpunkDaylight";
    darkVariantKey:
      | "themeVariantMacosDark"
      | "themeVariantMoon"
      | "themeVariantMacchiato"
      | "themeVariantMidnight"
      | "themeVariantWin98Midnight"
      | "themeVariantTerminalPhosphor"
      | "themeVariantBrutalismNight"
      | "themeVariantBlueprintDiazotype"
      | "themeVariantSystem6Black"
      | "themeVariantCyberpunkMidnight";
  }[] = [
    { value: "macos", labelKey: "themeFamilyMacos", lightVariantKey: "themeVariantMacosLight", darkVariantKey: "themeVariantMacosDark" },
    { value: "rose-pine", labelKey: "themeFamilyRosePine", lightVariantKey: "themeVariantDawn", darkVariantKey: "themeVariantMoon" },
    { value: "catppuccin", labelKey: "themeFamilyCatppuccin", lightVariantKey: "themeVariantLatte", darkVariantKey: "themeVariantMacchiato" },
    { value: "midnight", labelKey: "themeFamilyMidnight", lightVariantKey: "themeVariantDaybreak", darkVariantKey: "themeVariantMidnight" },
    { value: "win98", labelKey: "themeFamilyWin98", lightVariantKey: "themeVariantWin98Classic", darkVariantKey: "themeVariantWin98Midnight" },
    { value: "terminal", labelKey: "themeFamilyTerminal", lightVariantKey: "themeVariantTerminalPaper", darkVariantKey: "themeVariantTerminalPhosphor" },
    { value: "brutalism", labelKey: "themeFamilyBrutalism", lightVariantKey: "themeVariantBrutalismPoster", darkVariantKey: "themeVariantBrutalismNight" },
    { value: "blueprint", labelKey: "themeFamilyBlueprint", lightVariantKey: "themeVariantBlueprintVellum", darkVariantKey: "themeVariantBlueprintDiazotype" },
    { value: "system6", labelKey: "themeFamilySystem6", lightVariantKey: "themeVariantSystem6White", darkVariantKey: "themeVariantSystem6Black" },
    { value: "cyberpunk", labelKey: "themeFamilyCyberpunk", lightVariantKey: "themeVariantCyberpunkDaylight", darkVariantKey: "themeVariantCyberpunkMidnight" }
  ];

  const SETTINGS_NAV: { id: SettingsSection; icon: ReiconComponent }[] = [
    { id: "general", icon: Gear },
    { id: "models", icon: Cpu },
    { id: "providers", icon: Plug },
    { id: "agents", icon: Cpu },
    { id: "mcp", icon: PlugCircle },
    { id: "openConnector", icon: AddCircle },
    { id: "skills", icon: MagicWand },
    { id: "memory", icon: Database },
    { id: "sessionManagement", icon: Archive2 },
    { id: "channels", icon: Radio },
    { id: "plugins", icon: PuzzlePiece },
    { id: "webSearch", icon: Globe },
    { id: "imageGenerate", icon: Image },
    { id: "videoGenerate", icon: Film },
    { id: "ttsGenerate", icon: Soundwave },
    { id: "profiles", icon: Card },
    { id: "usage", icon: Chart },
    { id: "runHistory", icon: History },
    { id: "logs", icon: TerminalSquare },
    { id: "trace", icon: Search },
    { id: "executionPermissions", icon: ShieldCheck },
    { id: "hostBash", icon: TerminalSquare },
    { id: "diagnostics", icon: Stethoscope },
    { id: "runtimeEnv", icon: Box }
  ];

  const SETTINGS_GROUPS: { id: "general" | "models" | "assistant" | "tools" | "channels" | "activity" | "system"; sections: SettingsSection[] }[] = [
    { id: "general", sections: ["general"] },
    { id: "models", sections: ["models", "providers"] },
    { id: "assistant", sections: ["agents", "skills", "memory", "sessionManagement"] },
    { id: "tools", sections: ["mcp", "openConnector", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"] },
    { id: "channels", sections: ["profiles", "channels"] },
    { id: "activity", sections: ["runHistory", "usage", "trace", "logs", "hostBash"] },
    { id: "system", sections: ["runtimeEnv", "executionPermissions", "plugins", "diagnostics"] }
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
      case "openConnector": return copy.openConnector;
      case "skills": return copy.skills;
      case "memory": return copy.memory;
      case "sessionManagement": return copy.sessionMgmt;
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
      case "executionPermissions": return copy.executionPermissions;
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
      case "openConnector": return copy.openConnectorHint;
      case "skills": return copy.skillsHint;
      case "memory": return copy.memoryHint;
      case "sessionManagement": return copy.sessionMgmtHint;
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
      case "executionPermissions": return copy.executionPermissionsHint;
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
  // Settings render as an in-window overlay on top of the live chat window
  // (ChatView stays mounted), so opening settings never tears down the
  // conversation. There is no longer a dedicated settings window.
  let settingsOpen = false;

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
  $: if (settingsOpen && activeSection === "general" && serviceReady && status?.service.endpoint
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
          servicePort = Number(payload.serverPort) || 3040;
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
    if (section) activeSection = section as SettingsSection;
    settingsOpen = true;
  }

  function closeSettings(): void {
    settingsOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    const nestedDialog = event.composedPath().some(
      (target) => target instanceof HTMLElement && target.classList.contains("desktop-dialog-content")
    );
    if (event.key === "Escape" && settingsOpen && !event.defaultPrevented && !nestedDialog) closeSettings();
  }

  function onThemeStorage(event: StorageEvent): void {
    if (event.key === LOCALE_STORAGE_KEY) {
      locale = normalizeLocale(event.newValue);
      return;
    }
    if (event.key === APPEARANCE_STORAGE_KEY) {
      appearance = normalizeAppearance(event.newValue);
      applyTheme(appearance, themeFamily);
      return;
    }
    if (event.key === IMPORTED_THEME_STORAGE_KEY) {
      activeImportedThemeId = event.newValue || null;
      applyTheme(appearance, themeFamily);
      return;
    }
    if (event.key !== THEME_FAMILY_STORAGE_KEY) return;
    themeFamily = normalizeThemeFamily(event.newValue);
    applyTheme(appearance, themeFamily);
  }

  onMount(() => {
    applyTheme(appearance, themeFamily);
    applyPerformanceMode(lowPerformance);
    systemAppearanceQuery = window.matchMedia("(prefers-color-scheme: dark)");
    onSystemAppearanceChange = () => {
      if (appearance === "system") applyTheme(appearance, themeFamily);
    };
    systemAppearanceQuery.addEventListener("change", onSystemAppearanceChange);
    void startWindowState();
    void startFeedback();
    void startHaptics();
    void loadImportedThemes();
    void loadThemeDirectories();
    const onSettingsChanged = () => {
      if (status?.service.endpoint) void loadReadiness(status.service.endpoint);
    };
    const onNavigateSettings = (event: Event) => {
      const custom = event as CustomEvent<{ section?: SettingsSection }>;
      if (custom.detail?.section) {
        selectSettingsSection(custom.detail.section);
        settingsOpen = true;
      }
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    window.addEventListener(NAVIGATE_SETTINGS_EVENT, onNavigateSettings);
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
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
      window.removeEventListener(NAVIGATE_SETTINGS_EVENT, onNavigateSettings);
      window.removeEventListener("storage", onThemeStorage);
      if (onSystemAppearanceChange) systemAppearanceQuery?.removeEventListener("change", onSystemAppearanceChange);
      onSystemAppearanceChange = null;
      systemAppearanceQuery = null;
    };
  });
</script>

<svelte:head>
  <title>{settingsOpen ? text.settings : text.appName}</title>
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

{#if feedbackAnnouncement}
  <p class="sr-only" role="status" aria-live="polite">{feedbackAnnouncement}</p>
{/if}

<div class="chat-host" class:is-hidden={settingsOpen}>
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
    onFeedback={publishFeedback}
    {openSettings}
    requestedWorkspacePane={requestedChatPane}
  />
</div>

{#if settingsOpen}
  <div class="settings-overlay" role="dialog" aria-modal="true" aria-label={text.settings}>
  <main class="settings-layout">
    <WindowDragMask />
    <aside class="settings-sidebar">
      <div class="settings-titlebar-space" data-tauri-drag-region aria-hidden="true"></div>
      <button class="settings-back" type="button" onclick={closeSettings}>
        <ArrowLeft size={16} aria-hidden="true" />
        <span>{text.back}</span>
      </button>
      <div class="settings-search">
        <Magnifier size={16} aria-hidden="true" />
        <input type="search" autocomplete="off" spellcheck="false" bind:value={settingsFilter} aria-label={text.settingsSearch} placeholder={text.settingsSearch} />
        {#if settingsFilter}
          <button type="button" aria-label={text.clearSettingsSearch} onclick={() => (settingsFilter = "")}><XCircle size={16} weight="Filled" aria-hidden="true" /></button>
        {/if}
      </div>
      <nav class="settings-nav-list" aria-label={text.settings}>
        {#each localizedSettingsGroups as group (group.id)}
          <p class="settings-nav-group-label">{group.label}</p>
          {#each group.items as item (item.id)}
            {@const NavIcon = item.icon}
            <button class:active={activeSection === item.id} class="settings-nav" type="button" onclick={() => selectSettingsSection(item.id)}>
              <span class="nav-tile" aria-hidden="true"><NavIcon size={16} weight="Filled" /></span>
              <span class="nav-label">{item.label}</span>
            </button>
          {/each}
        {:else}
          <p class="settings-search-empty">{text.settingsSearchEmpty}</p>
        {/each}
      </nav>
      <div class="settings-sidebar-footer">
        <img class="settings-footer-avatar" src="/molibot-icon.png" alt="" width="28" height="28" />
        <div class="settings-sidebar-footer-copy"><strong>{text.appName}</strong><small>{serviceStateLabel(status?.service.state, text)}</small></div>
        <span class="status-dot" data-state={status?.service.state ?? "disconnected"} aria-hidden="true"></span>
      </div>
    </aside>
    <section class="settings-content">
      <PageHeader title={sectionLabel(activeSection, text)} description={sectionDescription(activeSection, text)} dataPage={activeSection === "memory"} scrolled={settingsScrolled} />

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
            <p class="appearance-label">{text.appearanceMode}</p>
            <p class="appearance-description">{text.appearanceModeDescription}</p>
            <div class="appearance-segmented" role="radiogroup" aria-label={text.appearanceMode} use:tablist={'[role="radio"]'}>
              {#each APPEARANCE_OPTIONS as option (option.value)}
                <button
                  type="button"
                  class:active={appearance === option.value}
                  role="radio"
                  aria-checked={appearance === option.value}
                  tabindex={appearance === option.value ? 0 : -1}
                  onclick={() => changeAppearance(option.value)}
                >
                  {text[option.labelKey]}
                </button>
              {/each}
            </div>
          </div>
          <div class="appearance-block">
            <p class="appearance-label">{text.themeFamily}</p>
            <p class="appearance-description">{text.themeFamilyDescription}</p>
            <div class="theme-grid theme-family-grid">
              {#each THEME_FAMILY_PREVIEWS as preview (preview.value)}
                <button
                  type="button"
                  class="theme-swatch"
                  class:active={!activeImportedThemeId && themeFamily === preview.value}
                  data-theme-family-preview={preview.value}
                  data-theme-preview-appearance={appearance}
                  aria-pressed={!activeImportedThemeId && themeFamily === preview.value}
                  onclick={() => changeThemeFamily(preview.value)}
                >
                  <span class="theme-preview" aria-hidden="true"><span class="tp-side"></span><span class="tp-body"></span></span>
                  <span class="theme-name">{text[preview.labelKey]}</span>
                  <span class="theme-variants">{text[preview.lightVariantKey]} · {text[preview.darkVariantKey]}</span>
                </button>
              {/each}
            </div>
          </div>
          <div class="appearance-block">
            <p class="appearance-label">{text.importedThemes}</p>
            <p class="appearance-description">{text.importedThemesDescription}</p>
            {#if importedThemes.length > 0}
              <div class="theme-grid theme-family-grid">
                {#each importedThemes as item (item.id)}
                  <div class="imported-theme" class:active={activeImportedThemeId === item.id}>
                    <button
                      type="button"
                      class="theme-swatch"
                      class:active={activeImportedThemeId === item.id}
                      aria-pressed={activeImportedThemeId === item.id}
                      onclick={() => changeImportedTheme(item.id)}
                    >
                      <span class="theme-preview" aria-hidden="true">
                        <span class="tp-side" style={`background:${importedSwatchColors(item).side}`}></span>
                        <span class="tp-body" style={`background:${importedSwatchColors(item).body}`}></span>
                      </span>
                      <span class="theme-name">{item.name}</span>
                      <span class="theme-variants">{item.variant === "dark" ? text.appearanceDark : text.appearanceLight}</span>
                    </button>
                    <button
                      type="button"
                      class="imported-theme-remove"
                      aria-label={text.removeImportedTheme}
                      title={text.removeImportedTheme}
                      onclick={() => removeImportedTheme(item.id)}
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="imported-themes-empty">{text.importedThemesEmpty}</p>
            {/if}
            <div class="imported-theme-actions">
              <button
                class="secondary-button"
                type="button"
                onclick={importVscodeTheme}
                disabled={!runningInTauri || themeImportBusy}
              >
                {themeImportBusy ? text.importingTheme : text.importVscodeTheme}
              </button>
              {#if !runningInTauri}<span class="imported-theme-note">{text.importedThemeDesktopOnly}</span>{/if}
            </div>
            {#if themeImportError}<p class="imported-theme-error" role="alert">{themeImportError}</p>{/if}
            {#if runningInTauri && themeDirectories.some((directory) => directory.hasThemes)}
              <div class="theme-directory-block">
                <p class="appearance-description">{text.themeDirectoryHint}</p>
                <div class="theme-directory-actions">
                  {#each themeDirectories.filter((directory) => directory.hasThemes) as directory (directory.id)}
                    <button
                      class="secondary-button theme-directory-button"
                      type="button"
                      title={directory.path}
                      disabled={themeDirectoryBusy === directory.id}
                      onclick={() => openThemeDirectoryAction(directory.id)}
                    >
                      {themeDirectoryLabel(directory)}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            {#if themeDirectoryError}<p class="imported-theme-error" role="alert">{themeDirectoryError}</p>{/if}
            <details class="imported-theme-help">
              <summary>{text.importedThemeHelpTitle}</summary>
              <div class="imported-theme-help-body">
                <p><strong>{text.importedThemeHelpSupportedLabel}</strong>{text.importedThemeHelpSupported}</p>
                <p><strong>{text.importedThemeHelpWhereLabel}</strong>{text.importedThemeHelpWhere}</p>
                <p><strong>{text.importedThemeHelpHowLabel}</strong>{text.importedThemeHelpHow}</p>
              </div>
            </details>
          </div>
        </SettingGroup>

        <SettingGroup title={text.service}>
          <SettingRow title={text.service} description={serviceEndpointText}>
            <StatusBadge label={ownershipText} state={status?.service.state ?? "disconnected"} />
          </SettingRow>
          <SettingRow title={text.servicePort} description={text.servicePortDescription}>
            <input class="row-input" type="number" min="1024" max="65535" step="1" autocomplete="off" aria-label={text.servicePort} bind:value={servicePort} disabled={!serviceReady || servicePortBusy} />
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
      {:else if activeSection === "profiles"}
        <ProfilesSection />
      {:else if activeSection === "skills"}
        <SkillsSection />
      {:else if activeSection === "agents"}
        <AgentsSection />
      {:else if activeSection === "channels"}
        <ChannelsSection />
      {:else if activeSection === "mcp"}
        <McpSection />
      {:else if activeSection === "plugins"}
        <PluginsSection />
      {:else if activeSection === "openConnector"}
        <OpenConnectorSection />
      {:else if activeSection === "memory"}
        <MemorySection />
      {:else if activeSection === "sessionManagement"}
        <SessionManagementSection />
      {:else if activeSection === "logs"}
        <LogsSection />
      {:else if activeSection === "trace"}
        <TraceSection />
      {:else if activeSection === "usage"}
        <UsageSection />
      {:else if activeSection === "runHistory"}
        <RunHistorySection />
      {:else if activeSection === "webSearch"}
        <WebSearchSection />
      {:else if activeSection === "imageGenerate"}
        <ImageSettingsSection />
      {:else if activeSection === "videoGenerate"}
        <VideoGenerateSection />
      {:else if activeSection === "ttsGenerate"}
        <TtsGenerateSection />
      {:else if activeSection === "executionPermissions"}
        <ExecutionPermissionsSection />
      {:else if activeSection === "hostBash"}
        <HostBashSection />
      {:else if activeSection === "runtimeEnv"}
        <RuntimeEnvSection />
      {:else}
        <SettingGroup title={text.diagnostics} description={text.diagnosticsHint}>
          <SettingRow title={text.diagAppVersion}>
            <span class="diag-value">{appVersion ?? text.unknownValue}</span>
          </SettingRow>
          <SettingRow title={text.diagServiceVersion}>
            <span class="diag-value">{status?.service.version ?? text.unknownValue}</span>
          </SettingRow>
          <SettingRow title={text.diagOwnership}>
            <span class="diag-value">{ownershipText}</span>
          </SettingRow>
          <SettingRow title={text.diagEndpoint}>
            <span class="diag-value">{status?.service.endpoint ?? text.unavailable}</span>
          </SettingRow>
          <SettingRow title={text.diagState}>
            <StatusBadge label={serviceStateLabel(status?.service.state, text)} state={status?.service.state ?? "disconnected"} />
          </SettingRow>
          <SettingRow title={text.copyDiagnostics} description={diagnosticsCopied ? text.copied : ""}>
            <button class="secondary-button" type="button" onclick={copyDiagnostics}>
              {diagnosticsCopied ? text.copied : text.copyDiagnostics}
            </button>
          </SettingRow>
        </SettingGroup>
      {/if}

      {#if error || session.error}<p class="error-message" role="alert">{error || session.error}</p>{/if}
      {#if shouldShowServiceReconnect(serviceReady)}
        <footer class="settings-footbar settings-footbar-notice">
          <button class="secondary-button" type="button" onclick={refreshStatus}>{text.reconnectService}</button>
        </footer>
      {/if}
      </div>
    </section>
  </main>
  </div>
{/if}
