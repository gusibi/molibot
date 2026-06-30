<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type {
    DesktopAgentItem,
    DesktopApprovalDecision,
    DesktopApprovalPrompt,
    DesktopConversationMessage,
    DesktopExternalSessionsSummary,
    DesktopExternalTranscript,
    DesktopMessageAttachment,
    DesktopModelOption,
    DesktopProfileSummary,
    DesktopProviderCreateRequest,
    DesktopProviderModel,
    DesktopProviderModelTag,
    DesktopSessionFile,
    DesktopSessionSummary,
    DesktopThinkingLevel,
    DesktopWebProfile
  } from "@molibot/desktop-contract";
  import type { Translation } from "./lib/i18n";
  import {
    addToFollowUpQueue,
    buildOnboardingHealthCheck,
    classifyFirstLaunch,
    createDesktopProvider,
    createDesktopSession,
    deleteDesktopSession,
    fetchDesktopFileBlob,
    filterDesktopFiles,
    filterSessionsByTitle,
    findTranscriptMatches,
    groupExternalSessionsByInstance,
    listDesktopSessionFiles,
    listDesktopSessions,
    loadDesktopAgents,
    loadDesktopBootstrap,
    loadDesktopChannels,
    loadDesktopExternalSessions,
    loadDesktopExternalTranscript,
    loadDesktopModels,
    loadDesktopRuntimeEnv,
    loadDesktopSession,
    loadDesktopWebProfiles,
    nextFollowUp,
    ONBOARDING_STEPS,
    parseDesktopActivity,
    parseDesktopApproval,
    patchDesktopWebProfile,
    renameDesktopSession,
    resolveOnboardingAgentSelection,
    resolveOnboardingRepairTarget,
    resolveOnboardingStartStep,
    resolveDesktopHostBash,
    sendDesktopChatWithFiles,
    stopDesktopChat,
    summarizeDesktopReadiness,
    summarizeOnboardingChannels,
    summarizeOnboardingDiagnostics,
    switchDesktopModel,
    streamDesktopChat,
    testDesktopProvider,
    type DesktopActivityEntry,
    type OnboardingChannelsView,
    type OnboardingDiagnostics,
    type DesktopFileFilter,
    type FirstLaunchClassification,
    type OnboardingStep,
    type OnboardingRepairTarget,
    type ProviderDraft,
    validateProviderDraft
  } from "./lib/api";
  import { renderMarkdown } from "./lib/markdown";

  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceState: "disconnected" | "ready" | "incompatible" | "error";
  export let launchAtLogin: boolean;
  export let launchAtLoginBusy: boolean;
  export let setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  export let openSettings: (section?: string) => void;

  type UiMessage = DesktopConversationMessage & { thinking?: string };

  const PROFILE_STORAGE_KEY = "molibot-desktop-profile";
  const SESSION_STORAGE_KEY = "molibot-desktop-last-sessions";
  const FIRST_LAUNCH_SEEN_KEY = "molibot-desktop-first-launch-seen";

  let profiles: DesktopProfileSummary[] = [];
  let sessions: DesktopSessionSummary[] = [];
  let messages: UiMessage[] = [];
  let activeProfileId = "";
  let activeSessionId = "";
  let connectedEndpoint = "";
  let loading = false;
  let sending = false;
  let error = "";
  let activity = "";
  let messageInput = "";
  let pendingFiles: File[] = [];
  let queuedMessages: string[] = [];
  let fileInput: HTMLInputElement;
  let streamingText = "";
  let streamingThinking = "";
  let activityEntries: DesktopActivityEntry[] = [];
  let pendingApproval: DesktopApprovalPrompt | null = null;
  let thinkingLevel: DesktopThinkingLevel = "medium";
  let modelOptions: DesktopModelOption[] = [];
  let activeModelKey = "";
  let changingModel = false;
  let messagesElement: HTMLDivElement;
  let sendAbortController: AbortController | null = null;
  let connectionGeneration = 0;
  let editingSessionId = "";
  let editingSessionTitle = "";
  let deleteConfirmId = "";
  let sessionFilterQuery = "";
  let collapsedGroups = new Set<string>();
  const SIDEBAR_WIDTH_KEY = "molibot-desktop-sidebar-width";
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 420;
  let sidebarWidth = clampSidebarWidth(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY) || 0) || 280);
  let resizingSidebar = false;
  function clampSidebarWidth(value: number): number {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));
  }
  function startSidebarResize(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    resizingSidebar = true;
    window.addEventListener("mousemove", onSidebarResize);
    window.addEventListener("mouseup", stopSidebarResize);
  }
  function onSidebarResize(event: MouseEvent): void {
    if (!resizingSidebar) return;
    sidebarWidth = clampSidebarWidth(event.clientX);
  }
  function stopSidebarResize(): void {
    if (!resizingSidebar) return;
    resizingSidebar = false;
    window.removeEventListener("mousemove", onSidebarResize);
    window.removeEventListener("mouseup", stopSidebarResize);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }
  function onSidebarKeydown(event: KeyboardEvent): void {
    let next = sidebarWidth;
    if (event.key === "ArrowLeft") next -= 16;
    else if (event.key === "ArrowRight") next += 16;
    else return;
    event.preventDefault();
    sidebarWidth = clampSidebarWidth(next);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }
  let searchOpen = false;
  let searchQuery = "";
  let searchIndex = 0;
  let sessionFiles: DesktopSessionFile[] = [];
  let fileFilter: DesktopFileFilter = "all";
  let filesLoading = false;
  let filePanelOpen = false;
  let previewFile: DesktopSessionFile | null = null;
  let previewUrl = "";
  let viewMode: "local" | "external" = "local";
  let externalSessions: DesktopExternalSessionsSummary | null = null;
  let externalLoading = false;
  let externalError = "";
  let externalTranscript: DesktopExternalTranscript | null = null;
  let externalTranscriptLoading = false;
  let externalTranscriptError = "";
  let activeExternalSessionId = "";
  let onboardingDismissed = localStorage.getItem(FIRST_LAUNCH_SEEN_KEY) === "1";
  let onboardingMode: FirstLaunchClassification = "new";
  let onboardingRepairTarget: OnboardingRepairTarget | null = null;
  let onboardingStep: OnboardingStep = "provider";
  let providerDraft: ProviderDraft = {
    name: "",
    protocol: "openai-compatible",
    baseUrl: "",
    model: "",
    apiKeyPresent: false
  };
  let onboardingProviderModels: DesktopProviderModel[] = [{
    id: "",
    tags: ["text"],
    supportedRoles: ["system", "user", "assistant", "tool"],
    enabled: true,
    verification: {}
  }];
  const onboardingProviderTags: DesktopProviderModelTag[] = ["text", "vision", "audio_input", "stt", "tts", "tool"];
  let providerApiKeyInput = "";
  let onboardingAgents: DesktopAgentItem[] = [];
  let onboardingProfiles: DesktopWebProfile[] = [];
  let onboardingProfileId = "";
  let onboardingAgentId = "";
  let onboardingAgentSaving = false;
  let onboardingAgentSaved = false;
  let onboardingAgentError = "";
  let onboardingLaunchError = "";
  let onboardingChannels: OnboardingChannelsView = { rows: [], connectedCount: 0 };
  let onboardingDiagnostics: OnboardingDiagnostics = {
    serviceReady: false,
    depsInstalled: 0,
    depsTotal: 0,
    missingDependencyNames: []
  };
  let onboardingLaunchChoice = launchAtLogin;
  let onboardingLaunchTouched = false;
  let onboardingLaunchChanging = false;
  let providerSubmitting = false;
  let providerSubmitError = "";
  let providerSubmitted = false;
  let providerSubmittedId = "";
  let providerTesting = false;
  let providerTestResult: "" | "ok" | "fail" = "";
  let providerTestError = "";
  $: providerValidation = validateProviderDraft({
    ...providerDraft,
    model: onboardingProviderModels.some((model) => model.id.trim()) ? "configured" : ""
  });
  $: onboardingStepIndex = ONBOARDING_STEPS.indexOf(onboardingStep);
  $: onboardingIsGuided = onboardingMode === "new" || onboardingMode === "broken";
  $: onboardingStepLabels = {
    provider: copy.onboardingStepProvider,
    agent: copy.onboardingStepAgent,
    channels: copy.onboardingStepChannels,
    launch: copy.onboardingStepLaunch,
    diagnostics: copy.onboardingStepDiagnostics
  } satisfies Record<OnboardingStep, string>;
  $: onboardingTitle = onboardingMode === "usable"
    ? copy.onboardingTitleUsable
    : onboardingMode === "broken"
      ? copy.onboardingTitleBroken
      : copy.onboardingTitleNew;
  $: onboardingHint = onboardingMode === "usable"
    ? copy.onboardingHintUsable
    : onboardingMode === "broken"
      ? onboardingRepairTarget === "model"
        ? copy.onboardingHintBrokenModel
        : copy.onboardingHintBrokenProfile
      : copy.onboardingHintNew;
  $: onboardingStepOfText = copy.onboardingStepOf
    .replace("{n}", String(onboardingStepIndex + 1))
    .replace("{total}", String(ONBOARDING_STEPS.length));
  $: onboardingEnabledAgents = onboardingAgents.filter((agent) => agent.enabled);
  $: onboardingAgentCanConfirm = Boolean(onboardingProfileId && onboardingAgentId && !onboardingAgentSaving);
  $: if (!onboardingLaunchTouched && !onboardingLaunchChanging) {
    onboardingLaunchChoice = launchAtLogin;
  }
  $: onboardingHealthCheck = buildOnboardingHealthCheck(readinessSummary, {
    modelReady: copy.healthCheckModel,
    modelMissing: copy.healthCheckModelMissing,
    profileReady: (count) => copy.healthCheckProfileReady.replace("{count}", String(count)),
    profileMissing: copy.healthCheckProfileMissing
  });

  $: activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  $: activeProfileName = profiles.find((profile) => profile.id === activeProfileId)?.name ?? copy.appName;
  $: activeProfileInitial = (activeProfileName.trim().charAt(0) || "M").toUpperCase();
  $: filteredFiles = filterDesktopFiles(sessionFiles, fileFilter);
  $: fileByLocal = new Map(sessionFiles.map((file) => [file.local, file]));
  $: modelReady = summarizeDesktopReadiness(profiles, { currentKey: activeModelKey, options: modelOptions }).hasModel;
  $: readinessSummary = summarizeDesktopReadiness(profiles, { currentKey: activeModelKey, options: modelOptions });
  $: showOnboarding = serviceState === "ready" && !onboardingDismissed;
  $: visibleSessions = filterSessionsByTitle(sessions, sessionFilterQuery);
  $: sessionGroups = groupSessionsByDate(visibleSessions);
  const GROUP_META: Record<string, { color: string; icon: string }> = {
    today: { color: "#007AFF", icon: "chats-circle" },
    yesterday: { color: "#AF52DE", icon: "moon" },
    week: { color: "#FF9500", icon: "calendar-blank" },
    earlier: { color: "#8E8E93", icon: "archive" }
  };
  function groupSessionsByDate(list: DesktopSessionSummary[]): { key: string; label: string; color: string; icon: string; items: DesktopSessionSummary[] }[] {
    if (list.length === 0) return [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 7 * 86400000;
    const meta = (key: string) => GROUP_META[key];
    const buckets: { key: string; label: string; color: string; icon: string; items: DesktopSessionSummary[] }[] = [
      { key: "today", label: copy.groupToday, ...meta("today"), items: [] },
      { key: "yesterday", label: copy.groupYesterday, ...meta("yesterday"), items: [] },
      { key: "week", label: copy.groupLast7Days, ...meta("week"), items: [] },
      { key: "earlier", label: copy.groupEarlier, ...meta("earlier"), items: [] }
    ];
    for (const session of list) {
      const ts = new Date(session.updatedAt).getTime();
      if (Number.isNaN(ts)) { buckets[3].items.push(session); continue; }
      if (ts >= startOfToday) buckets[0].items.push(session);
      else if (ts >= startOfYesterday) buckets[1].items.push(session);
      else if (ts >= startOf7Days) buckets[2].items.push(session);
      else buckets[3].items.push(session);
    }
    return buckets.filter((bucket) => bucket.items.length > 0);
  }
  function toggleGroup(key: string): void {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedGroups = next;
  }
  const CHANNEL_COLORS: Record<string, string> = {
    wechat: "#07c160", telegram: "#0A84FF", discord: "#5865F2",
    slack: "#E01E5A", whatsapp: "#25D366", messenger: "#0084FF",
    lark: "#00D6B9", feishu: "#00D6B9", dingtalk: "#1677FF",
    qq: "#12B7F5", mail: "#FF9500", email: "#FF9500"
  };
  const CHANNEL_ICONS: Record<string, string> = {
    wechat: "wechat-logo", telegram: "telegram-logo", discord: "discord-logo",
    slack: "slack-logo", whatsapp: "whatsapp-logo", messenger: "messenger-logo",
    lark: "lark-logo", feishu: "lark-logo", qq: "qq-logo",
    mail: "envelope", email: "envelope"
  };
  function channelColor(channel: string): string {
    const key = channel.toLowerCase();
    if (CHANNEL_COLORS[key]) return CHANNEL_COLORS[key];
    let h = 0;
    for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
    const palette = ["#0A84FF", "#AF52DE", "#FF2D55", "#FF9500", "#34C759", "#30B0C7", "#5856D6", "#FF375F"];
    return palette[Math.abs(h) % palette.length];
  }
  function channelIcon(channel: string): string {
    return CHANNEL_ICONS[channel.toLowerCase()] ?? "chat-circle-dots";
  }
  function externalSectionCount(section: { instances: { sessions: unknown[] }[] }): number {
    return section.instances.reduce((sum, inst) => sum + inst.sessions.length, 0);
  }
  $: externalSections = externalSessions ? groupExternalSessionsByInstance(externalSessions) : [];
  $: externalSessionCount = externalSections.reduce(
    (sum, section) => sum + section.instances.reduce((s, inst) => s + inst.sessions.length, 0),
    0
  );
  $: activeExternalSession = (() => {
    if (!activeExternalSessionId) return null;
    for (const section of externalSections) {
      for (const inst of section.instances) {
        for (const s of inst.sessions) {
          if (s.id === activeExternalSessionId) return s;
        }
      }
    }
    return null;
  })();
  $: searchMatchIds = findTranscriptMatches(messages, searchOpen ? searchQuery : "");
  $: activeMatchId = searchMatchIds[Math.min(searchIndex, Math.max(searchMatchIds.length - 1, 0))] ?? "";
  $: if (
    serviceState === "ready" &&
    serviceEndpoint &&
    serviceEndpoint !== connectedEndpoint
  ) {
    void connect(serviceEndpoint);
  }
  $: if (serviceState !== "ready" && connectedEndpoint) {
    connectionGeneration += 1;
    connectedEndpoint = "";
    profiles = [];
    onboardingProfiles = [];
    onboardingAgents = [];
    onboardingChannels = { rows: [], connectedCount: 0 };
    onboardingDiagnostics = { serviceReady: false, depsInstalled: 0, depsTotal: 0, missingDependencyNames: [] };
    onboardingProfileId = "";
    onboardingAgentId = "";
    onboardingAgentSaved = false;
    onboardingAgentError = "";
    onboardingLaunchError = "";
    onboardingLaunchTouched = false;
    onboardingLaunchChanging = false;
    onboardingLaunchChoice = launchAtLogin;
    onboardingMode = "new";
    onboardingRepairTarget = null;
    onboardingStep = "provider";
    sessions = [];
    messages = [];
    activeSessionId = "";
    sessionFiles = [];
    pendingApproval = null;
    queuedMessages = [];
    closePreview();
  }

  function lastSessions(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  }

  function rememberSession(profileId: string, sessionId: string): void {
    if (!profileId || !sessionId) return;
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...lastSessions(), [profileId]: sessionId })
    );
  }

  async function scrollToBottom(): Promise<void> {
    await tick();
    messagesElement?.scrollTo({ top: messagesElement.scrollHeight, behavior: "auto" });
  }

  async function connect(endpoint: string): Promise<void> {
    const generation = ++connectionGeneration;
    connectedEndpoint = endpoint;
    loading = true;
    error = "";
    try {
      const [nextProfiles, modelState, nextWebProfiles, nextAgents, nextChannels, nextRuntimeEnv] = await Promise.all([
        loadDesktopBootstrap(endpoint),
        loadDesktopModels(endpoint),
        loadDesktopWebProfiles(endpoint),
        loadDesktopAgents(endpoint),
        loadDesktopChannels(endpoint).catch(() => null),
        loadDesktopRuntimeEnv(endpoint).catch(() => null)
      ]);
      if (generation !== connectionGeneration) return;
      profiles = nextProfiles;
      modelOptions = modelState.options;
      activeModelKey = modelState.currentKey;
      const rememberedProfile = localStorage.getItem(PROFILE_STORAGE_KEY) ?? "";
      onboardingProfiles = nextWebProfiles;
      onboardingAgents = nextAgents.items;
      onboardingChannels = summarizeOnboardingChannels(nextChannels);
      onboardingDiagnostics = summarizeOnboardingDiagnostics(nextRuntimeEnv, true);
      const onboardingSelection = resolveOnboardingAgentSelection(
        nextWebProfiles,
        nextAgents.items,
        rememberedProfile
      );
      onboardingProfileId = onboardingSelection.profileId;
      onboardingAgentId = onboardingSelection.agentId;
      onboardingAgentSaved = false;
      onboardingAgentError = "";
      onboardingLaunchError = "";
      const nextReadiness = summarizeDesktopReadiness(nextProfiles, modelState);
      onboardingMode = classifyFirstLaunch(nextReadiness);
      onboardingRepairTarget = resolveOnboardingRepairTarget(nextReadiness);
      onboardingStep = resolveOnboardingStartStep(nextReadiness);
      activeProfileId = profiles.some((profile) => profile.id === rememberedProfile)
        ? rememberedProfile
        : profiles[0]?.id ?? "";
      if (activeProfileId) await loadProfile(activeProfileId, generation);
    } catch (cause) {
      if (generation === connectionGeneration) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (generation === connectionGeneration) loading = false;
    }
  }

  async function loadProfile(profileId: string, generation = connectionGeneration): Promise<void> {
    if (!connectedEndpoint || !profileId) return;
    activeProfileId = profileId;
    localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
    sessions = await listDesktopSessions(connectedEndpoint, profileId);
    if (generation !== connectionGeneration) return;

    if (sessions.length === 0) {
      const created = await createDesktopSession(connectedEndpoint, profileId);
      sessions = [created];
    }
    const remembered = lastSessions()[profileId];
    const nextSessionId = sessions.some((session) => session.id === remembered)
      ? remembered
      : sessions[0].id;
    await selectSession(nextSessionId, generation);
    void loadExternalSessions();
  }

  async function changeProfile(event: Event): Promise<void> {
    if (sending) return;
    const generation = ++connectionGeneration;
    loading = true;
    error = "";
    try {
      await loadProfile((event.currentTarget as HTMLSelectElement).value, generation);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function refreshSessions(): Promise<void> {
    if (!connectedEndpoint || !activeProfileId) return;
    sessions = await listDesktopSessions(connectedEndpoint, activeProfileId);
  }

  async function selectSession(sessionId: string, generation = connectionGeneration): Promise<void> {
    if (!connectedEndpoint || !activeProfileId || !sessionId) return;
    // Selecting a local session leaves the read-only external transcript view.
    if (viewMode !== "local") {
      viewMode = "local";
      closeExternalTranscript();
    }
    // A same-session reload (after a streamed turn) keeps the queue and search;
    // only an actual session switch resets per-session UI state.
    const switching = sessionId !== activeSessionId;
    activeSessionId = sessionId;
    rememberSession(activeProfileId, sessionId);
    const detail = await loadDesktopSession(connectedEndpoint, activeProfileId, sessionId);
    if (generation !== connectionGeneration || sessionId !== activeSessionId) return;
    messages = detail.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ ...message }));
    streamingText = "";
    streamingThinking = "";
    activityEntries = [];
    pendingApproval = null;
    if (switching) {
      queuedMessages = [];
      searchQuery = "";
      searchIndex = 0;
    }
    await scrollToBottom();
    void refreshFiles(sessionId, generation);
  }

  async function scrollToMatch(): Promise<void> {
    await tick();
    if (!activeMatchId) return;
    const target = messagesElement?.querySelector(`[data-message-id="${activeMatchId}"]`);
    target?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function onSearchInput(): void {
    searchIndex = 0;
    void scrollToMatch();
  }

  function gotoMatch(delta: number): void {
    if (searchMatchIds.length === 0) return;
    searchIndex = (searchIndex + delta + searchMatchIds.length) % searchMatchIds.length;
    void scrollToMatch();
  }

  function toggleSearch(): void {
    searchOpen = !searchOpen;
    if (!searchOpen) {
      searchQuery = "";
      searchIndex = 0;
    }
  }

  async function loadExternalSessions(): Promise<void> {
    if (!connectedEndpoint) {
      externalSessions = null;
      return;
    }
    externalLoading = true;
    externalError = "";
    try {
      externalSessions = await loadDesktopExternalSessions(connectedEndpoint);
    } catch (error) {
      externalSessions = null;
      externalError = error instanceof Error ? error.message : String(error);
    } finally {
      externalLoading = false;
    }
  }

  function switchViewMode(mode: "local" | "external"): void {
    if (viewMode === mode) return;
    viewMode = mode;
    if (mode === "external" && !externalSessions && !externalLoading) {
      void loadExternalSessions();
    }
    if (mode === "local") {
      closeExternalTranscript();
    }
  }

  async function openExternalTranscript(sessionId: string): Promise<void> {
    if (!connectedEndpoint || sessionId === activeExternalSessionId) return;
    viewMode = "external";
    activeExternalSessionId = sessionId;
    externalTranscript = null;
    externalTranscriptError = "";
    externalTranscriptLoading = true;
    try {
      externalTranscript = await loadDesktopExternalTranscript(connectedEndpoint, sessionId);
    } catch (error) {
      externalTranscript = null;
      externalTranscriptError = error instanceof Error ? error.message : String(error);
    } finally {
      externalTranscriptLoading = false;
    }
  }

  function closeExternalTranscript(): void {
    externalTranscript = null;
    externalTranscriptError = "";
    activeExternalSessionId = "";
  }

  function dismissOnboarding(): void {
    onboardingDismissed = true;
    localStorage.setItem(FIRST_LAUNCH_SEEN_KEY, "1");
  }

  function onApiKeyInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    providerApiKeyInput = input.value;
    providerDraft = { ...providerDraft, apiKeyPresent: input.value.trim().length > 0 };
  }

  function addOnboardingProviderModel(): void {
    onboardingProviderModels = [...onboardingProviderModels, {
      id: "",
      tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool"],
      enabled: true,
      verification: {}
    }];
  }

  function updateOnboardingProviderModel(index: number, patch: Partial<DesktopProviderModel>): void {
    onboardingProviderModels = onboardingProviderModels.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model);
  }

  function toggleOnboardingProviderTag(index: number, tag: DesktopProviderModelTag): void {
    const model = onboardingProviderModels[index];
    if (!model) return;
    const tags = model.tags.includes(tag) ? model.tags.filter((item) => item !== tag) : [...model.tags, tag];
    updateOnboardingProviderModel(index, { tags: tags.length > 0 ? tags : ["text"] });
  }

  function removeOnboardingProviderModel(index: number): void {
    if (onboardingProviderModels.length === 1) {
      updateOnboardingProviderModel(0, { id: "", tags: ["text"], contextWindow: undefined });
      return;
    }
    onboardingProviderModels = onboardingProviderModels.filter((_, modelIndex) => modelIndex !== index);
  }

  async function saveOnboardingProvider(): Promise<void> {
    if (!providerValidation.valid || providerSubmitting) return;
    providerSubmitting = true;
    providerSubmitError = "";
    providerTestResult = "";
    providerTestError = "";
    try {
      const models = onboardingProviderModels.filter((model) => model.id.trim()).map((model) => ({ ...model, id: model.id.trim() }));
      const request: DesktopProviderCreateRequest = {
        id: `desktop-${Date.now()}`,
        name: providerDraft.name,
        enabled: true,
        protocol: providerDraft.protocol,
        baseUrl: providerDraft.baseUrl,
        apiKey: providerApiKeyInput,
        models,
        defaultModel: models[0]?.id ?? "",
        path: providerDraft.protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions",
        supportsThinking: null,
        thinkingFormat: null,
        reasoningEffortMap: {}
      };
      const result = await createDesktopProvider(connectedEndpoint, request);
      if (!result.ok) throw new Error(result.error ?? "Unknown error");
      providerSubmitted = true;
      providerSubmittedId = result.providerId ?? "";
    } catch (cause) {
      providerSubmitError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerSubmitting = false;
    }
  }

  async function testOnboardingProvider(): Promise<void> {
    if (!providerSubmittedId || providerTesting) return;
    providerTesting = true;
    providerTestResult = "";
    providerTestError = "";
    try {
      const result = await testDesktopProvider(connectedEndpoint, providerSubmittedId);
      if (result.ok) {
        providerTestResult = "ok";
      } else {
        providerTestResult = "fail";
        providerTestError = result.error ?? result.message ?? "Unknown error";
      }
    } catch (cause) {
      providerTestResult = "fail";
      providerTestError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerTesting = false;
    }
  }

  function nextOnboardingStep(): void {
    if (onboardingStep === "provider" && !providerSubmitted) return;
    if (onboardingStep === "agent" && !onboardingAgentSaved) return;
    const next = ONBOARDING_STEPS[onboardingStepIndex + 1] ?? null;
    if (next) onboardingStep = next;
  }

  function prevOnboardingStep(): void {
    const prev = ONBOARDING_STEPS[onboardingStepIndex - 1] ?? null;
    if (prev) onboardingStep = prev;
  }

  function changeOnboardingProfile(event: Event): void {
    onboardingProfileId = (event.currentTarget as HTMLSelectElement).value;
    const profile = onboardingProfiles.find((item) => item.id === onboardingProfileId);
    if (profile && onboardingEnabledAgents.some((agent) => agent.id === profile.agentId)) {
      onboardingAgentId = profile.agentId;
    }
    onboardingAgentSaved = false;
    onboardingAgentError = "";
  }

  function changeOnboardingAgent(event: Event): void {
    onboardingAgentId = (event.currentTarget as HTMLSelectElement).value;
    onboardingAgentSaved = false;
    onboardingAgentError = "";
  }

  async function confirmOnboardingAgent(): Promise<void> {
    if (!connectedEndpoint || !onboardingAgentCanConfirm) return;
    onboardingAgentSaving = true;
    onboardingAgentError = "";
    try {
      const updated = await patchDesktopWebProfile(connectedEndpoint, onboardingProfileId, {
        agentId: onboardingAgentId,
        enabled: true
      });
      onboardingProfiles = onboardingProfiles.map((profile) =>
        profile.id === updated.id ? updated : profile
      );
      profiles = await loadDesktopBootstrap(connectedEndpoint);
      if (!activeProfileId && profiles.some((profile) => profile.id === updated.id)) {
        await loadProfile(updated.id);
      }
      onboardingAgentSaved = true;
    } catch (cause) {
      onboardingAgentError = cause instanceof Error ? cause.message : String(cause);
      onboardingAgentSaved = false;
    } finally {
      onboardingAgentSaving = false;
    }
  }

  async function toggleOnboardingLaunch(): Promise<void> {
    if (launchAtLoginBusy || onboardingLaunchChanging) return;
    onboardingLaunchError = "";
    onboardingLaunchChanging = true;
    onboardingLaunchTouched = true;
    try {
      onboardingLaunchChoice = await setLaunchAtLogin(!onboardingLaunchChoice);
    } catch (cause) {
      onboardingLaunchError = cause instanceof Error ? cause.message : String(cause);
      onboardingLaunchTouched = false;
    } finally {
      onboardingLaunchChanging = false;
    }
  }

  async function refreshFiles(sessionId = activeSessionId, generation = connectionGeneration): Promise<void> {
    if (!connectedEndpoint || !activeProfileId || !sessionId) {
      sessionFiles = [];
      return;
    }
    filesLoading = true;
    try {
      const files = await listDesktopSessionFiles(connectedEndpoint, activeProfileId, sessionId);
      if (generation !== connectionGeneration || sessionId !== activeSessionId) return;
      sessionFiles = files;
    } catch {
      if (generation === connectionGeneration && sessionId === activeSessionId) sessionFiles = [];
    } finally {
      if (generation === connectionGeneration && sessionId === activeSessionId) filesLoading = false;
    }
  }

  async function openPreview(file: DesktopSessionFile): Promise<void> {
    if (!connectedEndpoint) return;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, activeProfileId, activeSessionId, file.id);
      closePreview();
      previewFile = file;
      previewUrl = URL.createObjectURL(blob);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function closePreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    previewFile = null;
  }

  async function downloadFile(file: DesktopSessionFile): Promise<void> {
    if (!connectedEndpoint) return;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, activeProfileId, activeSessionId, file.id, true);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.original;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${exponent === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
  }

  function canPreview(file: DesktopSessionFile): boolean {
    return file.mediaType === "image" || file.mediaType === "audio" || file.mediaType === "video";
  }
  function fileTypeIcon(mediaType: DesktopSessionFile["mediaType"]): string {
    if (mediaType === "image") return "image";
    if (mediaType === "video") return "film-slate";
    if (mediaType === "audio") return "waveform";
    return "file-text";
  }
  function activityStepIcon(state: DesktopActivityEntry["state"]): string {
    if (state === "ok") return "check-circle";
    if (state === "error") return "x-circle";
    if (state === "start") return "circle-notch";
    return "circle";
  }

  function inferAttachmentKind(file: File): DesktopMessageAttachment["mediaType"] {
    const type = file.type.toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("audio/")) return "audio";
    if (type.startsWith("video/")) return "video";
    return "file";
  }

  function onFilesPicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter((file) => file.size > 0);
    if (picked.length > 0) pendingFiles = [...pendingFiles, ...picked];
    input.value = "";
  }

  function removePendingFile(index: number): void {
    pendingFiles = pendingFiles.filter((_, position) => position !== index);
  }

  // Object URLs for replaying pending (not-yet-sent) audio, e.g. a fresh
  // recording. Tracked separately so the reactive statement only depends on
  // `pendingFiles` and never writes the map it reads (avoiding a reactive loop).
  const pendingAudioTracked = new Map<File, string>();
  let pendingAudioUrls = new Map<File, string>();
  $: pendingAudioUrls = computePendingAudioUrls(pendingFiles);
  function computePendingAudioUrls(files: File[]): Map<File, string> {
    const present = new Set(files);
    for (const [file, url] of pendingAudioTracked) {
      if (!present.has(file)) {
        URL.revokeObjectURL(url);
        pendingAudioTracked.delete(file);
      }
    }
    for (const file of files) {
      if (!pendingAudioTracked.has(file) && inferAttachmentKind(file) === "audio") {
        pendingAudioTracked.set(file, URL.createObjectURL(file));
      }
    }
    return new Map(pendingAudioTracked);
  }

  // Lazily fetched object URLs for playing audio attachments on sent messages.
  // Keyed by the attachment's local path; cleared when the active session changes.
  let messageAudioUrls = new Map<string, string>();
  let messageAudioLoading = new Set<string>();
  let messageAudioSession = "";
  $: if (activeSessionId !== messageAudioSession) {
    for (const url of messageAudioUrls.values()) URL.revokeObjectURL(url);
    messageAudioUrls = new Map();
    messageAudioLoading = new Set();
    messageAudioSession = activeSessionId;
  }

  async function revealMessageAudio(file: DesktopSessionFile): Promise<void> {
    if (!connectedEndpoint) return;
    if (messageAudioUrls.has(file.local) || messageAudioLoading.has(file.local)) return;
    const loading = new Set(messageAudioLoading);
    loading.add(file.local);
    messageAudioLoading = loading;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, activeProfileId, activeSessionId, file.id);
      const next = new Map(messageAudioUrls);
      next.set(file.local, URL.createObjectURL(blob));
      messageAudioUrls = next;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      const done = new Set(messageAudioLoading);
      done.delete(file.local);
      messageAudioLoading = done;
    }
  }

  async function createSession(): Promise<void> {
    if (!connectedEndpoint || !activeProfileId || sending) return;
    error = "";
    try {
      const created = await createDesktopSession(connectedEndpoint, activeProfileId);
      await refreshSessions();
      await selectSession(created.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function beginRename(session: DesktopSessionSummary): void {
    if (sending) return;
    editingSessionId = session.id;
    editingSessionTitle = session.title;
    deleteConfirmId = "";
  }

  function cancelRename(): void {
    editingSessionId = "";
    editingSessionTitle = "";
  }

  async function saveRename(session: DesktopSessionSummary): Promise<void> {
    if (!connectedEndpoint || sending) return;
    const title = editingSessionTitle.trim();
    if (!title) return;
    try {
      const updated = await renameDesktopSession(
        connectedEndpoint,
        activeProfileId,
        session.id,
        title
      );
      sessions = sessions.map((item) => item.id === updated.id ? updated : item);
      cancelRename();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function removeSession(session: DesktopSessionSummary): Promise<void> {
    if (!connectedEndpoint || sending) return;
    if (deleteConfirmId !== session.id) {
      deleteConfirmId = session.id;
      cancelRename();
      return;
    }
    try {
      await deleteDesktopSession(connectedEndpoint, activeProfileId, session.id);
      sessions = sessions.filter((item) => item.id !== session.id);
      if (activeSessionId === session.id) {
        if (sessions.length === 0) {
          const created = await createDesktopSession(connectedEndpoint, activeProfileId);
          sessions = [created];
        }
        await selectSession(sessions[0].id);
      }
      deleteConfirmId = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function sendMessage(): Promise<void> {
    const content = messageInput.trim();
    const outgoingFiles = pendingFiles;
    const hasFiles = outgoingFiles.length > 0;
    if (!connectedEndpoint || !activeProfileId || !activeSessionId || sending || !modelReady) return;
    if (!content && !hasFiles) return;

    sending = true;
    error = "";
    activity = hasFiles ? copy.uploading : copy.working;
    streamingText = "";
    streamingThinking = "";
    activityEntries = [];
    pendingApproval = null;
    messageInput = "";
    pendingFiles = [];
    messages = [...messages, {
      id: `pending-${Date.now()}`,
      conversationId: activeSessionId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      attachments: hasFiles
        ? outgoingFiles.map((file) => ({
            original: file.name,
            local: "",
            mediaType: inferAttachmentKind(file),
            mimeType: file.type || undefined,
            size: file.size
          }))
        : undefined
    }];
    await scrollToBottom();

    if (hasFiles) {
      sendAbortController = new AbortController();
      try {
        await sendDesktopChatWithFiles(connectedEndpoint, {
          profileId: activeProfileId,
          sessionId: activeSessionId,
          message: content,
          thinkingLevel,
          files: outgoingFiles
        }, sendAbortController.signal);
        await refreshSessions();
        await selectSession(activeSessionId);
        activity = "";
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
        await selectSession(activeSessionId).catch(() => undefined);
      } finally {
        sending = false;
        sendAbortController = null;
      }
      drainQueue();
      return;
    }

    sendAbortController = new AbortController();
    try {
      await streamDesktopChat(
        connectedEndpoint,
        {
          profileId: activeProfileId,
          sessionId: activeSessionId,
          message: content,
          thinkingLevel
        },
        async (event, data) => {
          if (event === "token") streamingText += String(data.delta ?? "");
          if (event === "replace") streamingText = String(data.text ?? "");
          if (event === "thinking_delta") streamingThinking += String(data.delta ?? "");
          if (event === "status") activity = String(data.text ?? copy.working);
          if (event === "runner_event") activity = String(data.diagnostic ?? copy.working);
          const step = parseDesktopActivity(event, data);
          if (step) activityEntries = [...activityEntries, step];
          if (event === "host_bash_approval") pendingApproval = parseDesktopApproval(data);
          if (event === "done") {
            streamingText = String(data.response ?? streamingText);
            streamingThinking = String(data.thinkingText ?? streamingThinking);
          }
          if (event === "error") throw new Error(String(data.error ?? "Stream failed"));
          await scrollToBottom();
        },
        sendAbortController.signal
      );
      await refreshSessions();
      await selectSession(activeSessionId);
      activity = "";
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      await selectSession(activeSessionId).catch(() => undefined);
    } finally {
      sending = false;
      sendAbortController = null;
    }
    drainQueue();
  }

  async function stopRun(): Promise<void> {
    if (!connectedEndpoint || !activeSessionId || !sending) return;
    queuedMessages = [];
    sendAbortController?.abort();
    try {
      const stopped = await stopDesktopChat(connectedEndpoint, activeProfileId, activeSessionId);
      activity = stopped ? copy.stopped : copy.idle;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function approvalOptionLabel(option: { id: string; label: string }): string {
    if (option.id === "approve_once") return copy.approveOnce;
    if (option.id === "approve_session") return copy.approveSession;
    if (option.id === "approve_persistent") return copy.approvePersistent;
    if (option.id === "reject") return copy.reject;
    return option.label;
  }

  async function resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
    if (!connectedEndpoint || !pendingApproval || sending) return;
    const requestId = pendingApproval.requestId;
    const sessionId = activeSessionId;
    pendingApproval = null;
    sending = true;
    error = "";
    activity = copy.resuming;
    try {
      await resolveDesktopHostBash(connectedEndpoint, activeProfileId, sessionId, requestId, decision);
      // The approved command runs and the original turn resumes in the background,
      // appending its answer asynchronously; poll the transcript until it lands.
      const before = messages.filter((message) => message.role === "assistant").length;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (sessionId !== activeSessionId) return;
        await selectSession(sessionId);
        const after = messages.filter((message) => message.role === "assistant").length;
        if (decision === "reject" || after > before) break;
      }
      await refreshSessions();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      sending = false;
      activity = "";
    }
  }

  async function changeModel(event: Event): Promise<void> {
    if (!connectedEndpoint || sending || changingModel) return;
    changingModel = true;
    error = "";
    try {
      const state = await switchDesktopModel(
        connectedEndpoint,
        (event.currentTarget as HTMLSelectElement).value
      );
      modelOptions = state.options;
      activeModelKey = state.currentKey;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      changingModel = false;
    }
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (sending) queueFollowUp();
      else void sendMessage();
    }
  }

  function queueFollowUp(): void {
    const next = addToFollowUpQueue(queuedMessages, messageInput);
    if (next !== queuedMessages) {
      queuedMessages = next;
      messageInput = "";
    }
  }

  function removeQueued(index: number): void {
    queuedMessages = queuedMessages.filter((_, position) => position !== index);
  }

  function drainQueue(): void {
    if (sending || queuedMessages.length === 0) return;
    const { next, rest } = nextFollowUp(queuedMessages);
    queuedMessages = rest;
    if (next) {
      messageInput = next;
      void sendMessage();
    }
  }

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  type NativeRecordingResult = {
    audioBase64: string;
    mimeType: string;
    durationMs: number;
    sampleRate: number;
    channels: number;
  };

  let recording = false;
  let recordingError = "";
  let recordingSeconds = 0;
  let recordingBusy = false;
  let recordingTimer: ReturnType<typeof setInterval> | null = null;
  // Browser-only fallback state, used when ChatView runs in a plain dev browser
  // (`npm run dev`) instead of the Tauri WebView.
  let mediaRecorder: MediaRecorder | null = null;
  let recordingChunks: Blob[] = [];
  let recordingStream: MediaStream | null = null;

  function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function startRecordingTimer(): void {
    recordingSeconds = 0;
    recordingTimer = setInterval(() => { recordingSeconds += 1; }, 1000);
  }

  function stopRecordingTimer(): void {
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  }

  function teardownRecordingStream(): void {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    mediaRecorder = null;
    recordingChunks = [];
  }

  function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function toggleRecording(): Promise<void> {
    if (recordingBusy) return;
    if (recording) { void finishRecording(true); return; }
    if (!activeSessionId || !modelReady) return;
    recordingError = "";

    if (isTauriRuntime()) {
      recordingBusy = true;
      try {
        await invoke("start_recording");
        recording = true;
        startRecordingTimer();
      } catch (cause) {
        recordingError = cause instanceof Error ? cause.message : String(cause);
      } finally {
        recordingBusy = false;
      }
      return;
    }

    // Browser fallback (dev only).
    if (!navigator.mediaDevices?.getUserMedia) {
      recordingError = copy.recordingUnsupported;
      return;
    }
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      recordingError = cause instanceof Error ? cause.message : String(cause);
      return;
    }
    recordingChunks = [];
    try {
      mediaRecorder = new MediaRecorder(recordingStream);
    } catch (cause) {
      recordingError = cause instanceof Error ? cause.message : String(cause);
      teardownRecordingStream();
      return;
    }
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    };
    mediaRecorder.onstop = () => { teardownRecordingStream(); };
    mediaRecorder.start();
    recording = true;
    startRecordingTimer();
  }

  async function finishRecording(send: boolean): Promise<void> {
    if (!recording || recordingBusy) return;

    if (isTauriRuntime()) {
      recordingBusy = true;
      stopRecordingTimer();
      try {
        if (!send) {
          await invoke("cancel_recording");
          return;
        }
        const result = await invoke<NativeRecordingResult>("stop_recording");
        const bytes = base64ToBytes(result.audioBase64);
        if (bytes.length === 0) return;
        const mimeType = result.mimeType || "audio/wav";
        const file = new File([bytes.buffer as ArrayBuffer], `recording-${Date.now()}.wav`, { type: mimeType });
        pendingFiles = [...pendingFiles, file];
      } catch (cause) {
        recordingError = cause instanceof Error ? cause.message : String(cause);
        try { await invoke("cancel_recording"); } catch { /* ignore */ }
      } finally {
        recording = false;
        recordingBusy = false;
      }
      return;
    }

    // Browser fallback (dev only).
    if (!mediaRecorder) { recording = false; return; }
    stopRecordingTimer();
    const recorder = mediaRecorder;
    const chunks = recordingChunks;
    const stopped = new Promise<void>((resolve) => {
      if (recorder.state === "inactive") { resolve(); return; }
      recorder.onstop = () => { teardownRecordingStream(); resolve(); };
    });
    try { recorder.stop(); } catch { /* ignore */ }
    await stopped;
    recording = false;
    if (!send) return;
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const ext = (blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm");
    const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
    pendingFiles = [...pendingFiles, file];
  }

  onDestroy(() => {
    connectionGeneration += 1;
    sendAbortController?.abort();
    stopRecordingTimer();
    if (recording && isTauriRuntime()) {
      void invoke("cancel_recording").catch(() => { /* ignore */ });
    }
    teardownRecordingStream();
    for (const url of pendingAudioTracked.values()) URL.revokeObjectURL(url);
    pendingAudioTracked.clear();
    for (const url of messageAudioUrls.values()) URL.revokeObjectURL(url);
    closePreview();
  });
</script>

<main
  class="chat-layout"
  class:with-files={filePanelOpen && serviceState === "ready" && profiles.length > 0}
  class:resizing={resizingSidebar}
  style={`--sidebar-w:${sidebarWidth}px`}
>
  <aside class="chat-sidebar">
    <div class="brand-row">
      <div class="brand-mark" aria-hidden="true">M</div>
      <div class="brand-copy">
        <strong>{copy.appName}</strong>
      </div>
    </div>

    <button class="new-chat" type="button" disabled={!activeProfileId || sending} onclick={() => { switchViewMode("local"); void createSession(); }}>
      <i class="ph ph-plus-circle" aria-hidden="true"></i>
      <span>{copy.newChat}</span>
    </button>

    <div class="nav-list">
      <button class="nav-item" type="button" onclick={() => openSettings("tasks")}>
        <i class="ph ph-clock-countdown" aria-hidden="true"></i>
        <span>{copy.autoTasks}</span>
      </button>
      <button class="nav-item" type="button" onclick={() => openSettings("skills")}>
        <i class="ph ph-magic-wand" aria-hidden="true"></i>
        <span>{copy.skillsSquare}</span>
      </button>
    </div>

    <p class="nav-section-label">{copy.localKnowledge}</p>
    <div class="nav-list">
      <button class="nav-item" type="button" disabled={!activeSessionId} onclick={() => { fileFilter = "all"; filePanelOpen = true; }}>
        <i class="ph ph-squares-four" aria-hidden="true"></i>
        <span>{copy.kbFiles}</span>
      </button>
      <button class="nav-item" type="button" disabled={!activeSessionId} onclick={() => { fileFilter = "file"; filePanelOpen = true; }}>
        <i class="ph ph-file-text" aria-hidden="true"></i>
        <span>{copy.kbDocs}</span>
      </button>
      <button class="nav-item" type="button" disabled={!activeSessionId} onclick={() => { fileFilter = "image"; filePanelOpen = true; }}>
        <i class="ph ph-image-square" aria-hidden="true"></i>
        <span>{copy.kbImages}</span>
      </button>
      <button class="nav-item" type="button" disabled={!activeSessionId} onclick={() => { fileFilter = "all"; filePanelOpen = true; }}>
        <i class="ph ph-desktop" aria-hidden="true"></i>
        <span>{copy.kbThisComputer}</span>
      </button>
    </div>

    <p class="nav-section-label">{copy.conversations}</p>
    <div class="conversation-list">
      {#each sessionGroups as group (group.key)}
        <div class="conv-group">
          <button class="conv-group-head" type="button" onclick={() => toggleGroup(group.key)} aria-expanded={!collapsedGroups.has(group.key)}>
            <i class="ph-bold ph-caret-down conv-caret" class:open={!collapsedGroups.has(group.key)} aria-hidden="true"></i>
            <span class="conv-group-tile" style={`background:${group.color}`} aria-hidden="true"><i class={`ph-fill ph-${group.icon}`}></i></span>
            <span class="conv-group-label">{group.label}</span>
            <span class="conv-group-count">{group.items.length}</span>
          </button>
          {#if !collapsedGroups.has(group.key)}
            {#each group.items as session (session.id)}
              <div class:active={session.id === activeSessionId && viewMode === "local"} class="conversation-row">
                {#if editingSessionId === session.id}
                  <div class="conversation-editor">
                    <input bind:value={editingSessionTitle} aria-label={copy.rename} onkeydown={(event) => event.key === "Enter" && saveRename(session)} />
                    <div>
                      <button type="button" onclick={() => saveRename(session)}>{copy.save}</button>
                      <button type="button" onclick={cancelRename}>{copy.cancel}</button>
                    </div>
                  </div>
                {:else}
                  <button
                    class="conversation-select"
                    type="button"
                    disabled={sending}
                    onclick={() => {
                      deleteConfirmId = "";
                      void selectSession(session.id);
                    }}
                  >
                    <span class="conversation-tile" style={`--tile-color:${group.color}`}><i class="ph-fill ph-chat-circle-dots" aria-hidden="true"></i></span>
                    <span class="conversation-text">
                      <strong>{session.title}</strong>
                      <small>{formatTime(session.updatedAt)}</small>
                    </span>
                  </button>
                  <div class="conversation-actions">
                    <button type="button" aria-label={copy.rename} title={copy.rename} onclick={() => beginRename(session)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                    <button type="button" class="danger-action" aria-label={copy.delete} title={copy.delete} onclick={() => removeSession(session)}>
                      <i class="ph ph-trash" aria-hidden="true"></i>
                    </button>
                    {#if deleteConfirmId === session.id}
                      <button type="button" class="confirm-delete" onclick={() => deleteConfirmId = ""}>{copy.cancel}</button>
                    {/if}
                  </div>
                  {#if deleteConfirmId === session.id}
                    <span class="confirm-delete-banner">{copy.confirmDelete}</span>
                  {/if}
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/each}
      {#if sessions.length > 0 && visibleSessions.length === 0}
        <p class="external-empty">{copy.noMatches}</p>
      {/if}

      {#if externalLoading && externalSessionCount === 0}
        <p class="external-empty">{copy.loading}</p>
      {:else if externalError}
        <p class="external-empty external-error">{externalError}</p>
      {:else if externalSessionCount > 0}
        {#each externalSections as section (section.channel)}
          <div class="conv-group conv-group-readonly">
            <button class="conv-group-head" type="button" onclick={() => toggleGroup(`ext:${section.channel}`)} aria-expanded={!collapsedGroups.has(`ext:${section.channel}`)}>
              <i class="ph-bold ph-caret-down conv-caret" class:open={!collapsedGroups.has(`ext:${section.channel}`)} aria-hidden="true"></i>
              <span class="conv-group-tile" style={`background:${channelColor(section.channel)}`} aria-hidden="true"><i class={`ph-fill ph-${channelIcon(section.channel)}`}></i></span>
              <span class="conv-group-label">{section.channel}</span>
              <span class="conv-group-tail">
                <i class="ph ph-eye conv-group-readonly-icon" aria-hidden="true" title={copy.externalSessionReadOnly}></i>
                <span class="conv-group-count">{externalSectionCount(section)}</span>
              </span>
            </button>
            {#if !collapsedGroups.has(`ext:${section.channel}`)}
              {#each section.instances as instance (instance.botInstanceName ?? "__none__")}
                {#each instance.sessions as session (session.id)}
                  <div class:active={session.id === activeExternalSessionId} class="conversation-row">
                    <button
                      class="conversation-select"
                      type="button"
                      title={session.title}
                      onclick={() => void openExternalTranscript(session.id)}
                    >
                      <span class="conversation-tile" style={`--tile-color:${channelColor(section.channel)}`}><i class="ph-fill ph-chat-circle-dots" aria-hidden="true"></i></span>
                      <span class="conversation-text">
                        <strong>{session.title}</strong>
                        <small>{formatTime(session.updatedAt)}</small>
                      </span>
                    </button>
                  </div>
                {/each}
              {/each}
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <button class="sidebar-footer" type="button" aria-label={copy.openSettings} title={copy.openSettings} onclick={() => openSettings()}>
      <span class="sidebar-avatar" aria-hidden="true">{activeProfileInitial}</span>
      <span class="sidebar-footer-info">{copy.accountSettings}</span>
      <i class="ph ph-gear-six" aria-hidden="true"></i>
    </button>
  </aside>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
  <div
    class="sidebar-resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label={copy.resizeSidebar}
    aria-valuenow={sidebarWidth}
    aria-valuemin={SIDEBAR_MIN}
    aria-valuemax={SIDEBAR_MAX}
    tabindex="0"
    onmousedown={startSidebarResize}
    onkeydown={onSidebarKeydown}
  ></div>

  <section class="chat-content">
    <header class="chat-header">
      <div class="chat-title-block">
        <div class="chat-header-avatar" aria-hidden="true">{viewMode === "external" ? (activeExternalSession?.title?.replace(/^@/, "").charAt(0) || "·") : "M"}</div>
        <div class="chat-title-text">
          <div class="chat-title-name">{viewMode === "external" ? (activeExternalSession?.title ?? copy.chat) : (activeSession?.title ?? copy.chat)}</div>
          <div class="chat-title-sub">
            {#if profiles.length > 1}
              <label class="header-profile">
                <select value={activeProfileId} disabled={sending} onchange={changeProfile} aria-label={copy.profile}>
                  {#each profiles as profile (profile.id)}
                    <option value={profile.id}>{profile.name}</option>
                  {/each}
                </select>
                <i class="ph-bold ph-caret-down" aria-hidden="true"></i>
              </label>
            {:else}
              <span>{profiles[0]?.name ?? copy.local}</span>
            {/if}
            <span class="status-dot" data-state={serviceState}></span>
            <span>{serviceState === "ready" ? copy.statusOnline : copy.statusOffline}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        {#if serviceState === "ready" && profiles.length > 0}
          <button
            class="icon-button"
            type="button"
            aria-pressed={searchOpen}
            aria-label={copy.search}
            title={copy.search}
            onclick={toggleSearch}
          >
            <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          </button>
          <button
            class="icon-button"
            type="button"
            aria-pressed={filePanelOpen}
            aria-label={copy.files}
            title={copy.files}
            onclick={() => (filePanelOpen = !filePanelOpen)}
          >
            <i class="ph ph-sidebar-simple flip" aria-hidden="true"></i>
            {#if sessionFiles.length}<span class="icon-badge">{sessionFiles.length}</span>{/if}
          </button>
        {/if}
        <button class="icon-button" type="button" aria-label={copy.openSettings} title={copy.openSettings} onclick={() => openSettings()}>
          <i class="ph ph-gear-six" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    {#if searchOpen && serviceState === "ready" && profiles.length > 0}
      <div class="search-bar">
        <input
          type="search"
          bind:value={searchQuery}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          oninput={onSearchInput}
        />
        <span class="search-count">
          {searchQuery.trim() ? (searchMatchIds.length ? `${searchIndex + 1}/${searchMatchIds.length}` : copy.noMatches) : ""}
        </span>
        <button type="button" aria-label={copy.prevMatch} disabled={searchMatchIds.length === 0} onclick={() => gotoMatch(-1)}>‹</button>
        <button type="button" aria-label={copy.nextMatch} disabled={searchMatchIds.length === 0} onclick={() => gotoMatch(1)}>›</button>
        <button type="button" aria-label={copy.closeSearch} onclick={toggleSearch}>×</button>
      </div>
    {/if}

    {#if serviceState !== "ready"}
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
        <h2>{copy.serviceStarting}</h2>
        <p>{copy.disconnectedHint}</p>
      </div>
    {:else if loading}
      <div class="empty-state"><p>{copy.loadingChat}</p></div>
    {:else if profiles.length === 0}
      <div class="empty-state">
        <h2>{copy.noProfiles}</h2>
        <p>{copy.noProfilesHint}</p>
        <button class="secondary-button" type="button" onclick={() => openSettings()}>{copy.openSettings}</button>
      </div>
    {:else if viewMode === "external" && !activeExternalSessionId}
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
        <h2>{copy.chat}</h2>
        <p>{copy.externalChannelsHint}</p>
      </div>
    {:else}
      <div class="messages" bind:this={messagesElement} aria-live="polite">
        {#if viewMode === "external"}
          {#if externalTranscriptLoading}
            <div class="conversation-empty">
              <h2>{copy.loading}</h2>
            </div>
          {:else if externalTranscriptError}
            <div class="conversation-empty">
              <p class="onboarding-error">{externalTranscriptError}</p>
            </div>
          {:else if externalTranscript}
            {#if externalTranscript.messages.length === 0}
              <div class="conversation-empty">
                <h2>{copy.noExternalSessions}</h2>
              </div>
            {/if}
            {#if activeExternalSession?.channel}
              <div class="transcript-divider">
                <i class={`ph-fill ph-${channelIcon(activeExternalSession.channel)}`} style={`color:${channelColor(activeExternalSession.channel)}`} aria-hidden="true"></i>
                <span>{copy.externalSessionDivider.replace("{channel}", activeExternalSession.channel)}</span>
              </div>
            {/if}
            {#each externalTranscript.messages as message (message.id)}
              <article class="message-row" class:mine={message.role === "user"} data-message-id={message.id}>
                <div class="message-bubble markdown-body">{@html renderMarkdown(message.content)}</div>
                <time class="message-time">{formatTime(message.createdAt)}</time>
                {#if message.attachments && message.attachments.length > 0}
                  <div class="attachment-strip">
                    {#each message.attachments as attachment}
                      <div class="attachment-chip" data-kind={attachment.mediaType}>
                        <span class="attachment-icon" data-kind={attachment.mediaType} aria-hidden="true"></span>
                        <span class="attachment-name" title={attachment.original}>{attachment.original}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </article>
            {/each}
          {/if}
        {:else}
          {#if messages.length === 0 && !streamingText}
            <div class="conversation-empty">
              <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
              <h2>{copy.emptyChatTitle}</h2>
              <p>{copy.emptyChatHint}</p>
            </div>
          {/if}
          {#each messages as message (message.id)}
          <article
            class:mine={message.role === "user"}
            class:assistant={message.role !== "user"}
            class:search-match={searchMatchIds.includes(message.id)}
            class:search-active={message.id === activeMatchId}
            class="message-row"
            data-message-id={message.id}
          >
            {#if message.role === "user"}
              <div class="message-bubble markdown-body">{@html renderMarkdown(message.content)}</div>
              <time class="message-time">
                {formatTime(message.createdAt)}
                <i class="ph ph-checks message-read" aria-hidden="true"></i>
              </time>
              {#if message.attachments && message.attachments.length > 0}
                <div class="attachment-strip">
                  {#each message.attachments as attachment, index (index)}
                    {@const file = fileByLocal.get(attachment.local)}
                    <div class="attachment-chip" data-kind={attachment.mediaType}>
                      <span class="attachment-icon" data-kind={attachment.mediaType} aria-hidden="true"></span>
                      <span class="attachment-name" title={attachment.original}>{attachment.original}</span>
                      {#if file}
                        {#if attachment.mediaType === "audio"}
                          {#if messageAudioUrls.get(attachment.local)}
                            <!-- svelte-ignore a11y_media_has_caption -->
                            <audio class="attachment-audio" controls src={messageAudioUrls.get(attachment.local)}></audio>
                          {:else}
                            <button type="button" disabled={messageAudioLoading.has(attachment.local)} onclick={() => revealMessageAudio(file)}>{copy.play}</button>
                          {/if}
                        {:else if canPreview(file)}
                          <button type="button" onclick={() => openPreview(file)}>{copy.preview}</button>
                        {/if}
                        <button type="button" onclick={() => downloadFile(file)}>{copy.download}</button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
              {#if message.thinking}
                <details class="thinking-card"><summary>{copy.thinking}</summary><pre>{message.thinking}</pre></details>
              {/if}
            {:else}
              <div class="message-avatar" aria-hidden="true">M</div>
              <div class="message-stack">
                <div class="message-bubble markdown-body">{@html renderMarkdown(message.content)}</div>
                <time class="message-time">{formatTime(message.createdAt)}</time>
                {#if message.attachments && message.attachments.length > 0}
                  <div class="attachment-strip">
                    {#each message.attachments as attachment, index (index)}
                      {@const file = fileByLocal.get(attachment.local)}
                      <div class="attachment-chip" data-kind={attachment.mediaType}>
                        <span class="attachment-icon" data-kind={attachment.mediaType} aria-hidden="true"></span>
                        <span class="attachment-name" title={attachment.original}>{attachment.original}</span>
                        {#if file}
                          {#if attachment.mediaType === "audio"}
                            {#if messageAudioUrls.get(attachment.local)}
                              <!-- svelte-ignore a11y_media_has_caption -->
                              <audio class="attachment-audio" controls src={messageAudioUrls.get(attachment.local)}></audio>
                            {:else}
                              <button type="button" disabled={messageAudioLoading.has(attachment.local)} onclick={() => revealMessageAudio(file)}>{copy.play}</button>
                            {/if}
                          {:else if canPreview(file)}
                            <button type="button" onclick={() => openPreview(file)}>{copy.preview}</button>
                          {/if}
                          <button type="button" onclick={() => downloadFile(file)}>{copy.download}</button>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if message.thinking}
                  <details class="thinking-card"><summary>{copy.thinking}</summary><pre>{message.thinking}</pre></details>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
        {#if sending}
          <article class="message-row assistant streaming-message">
            <div class="message-avatar" aria-hidden="true">M</div>
            <div class="message-stack">
              <div class="message-status"><span>{activity || copy.working}</span></div>
              {#if activityEntries.length > 0}
                <details class="activity-card" open>
                  <summary class="activity-head">
                    <i class="ph ph-circle-notch activity-spin" aria-hidden="true"></i>
                    <span class="activity-head-title">{copy.runProgress}</span>
                    <span class="activity-head-count">{activityEntries.length}</span>
                    <i class="ph ph-caret-up activity-head-caret" aria-hidden="true"></i>
                  </summary>
                  <div class="activity-steps">
                    {#each activityEntries as entry, index (index)}
                      {#if index > 0}
                        <i class="ph ph-caret-right activity-step-arrow" aria-hidden="true"></i>
                      {/if}
                      <div class="activity-step" data-state={entry.state}>
                        <i class={`ph-fill ph-${activityStepIcon(entry.state)} activity-step-icon`} class:spin={entry.state === "start"} aria-hidden="true"></i>
                        <span class="activity-step-label">{entry.label}</span>
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}
              {#if streamingThinking}
                <details class="thinking-card" open><summary>{copy.thinking}</summary><pre>{streamingThinking}</pre></details>
              {/if}
              <div class="message-bubble markdown-body">{@html renderMarkdown(streamingText || activity || copy.working)}</div>
            </div>
          </article>
        {/if}
        {#if pendingApproval}
          <div class="approval-card" role="alertdialog" aria-label={copy.approvalTitle}>
            <strong class="approval-title">⚠️ {copy.approvalTitle}</strong>
            <div class="approval-field">
              <span>{copy.approvalCommand}</span>
              <code>{pendingApproval.command}</code>
            </div>
            {#if pendingApproval.reason}
              <div class="approval-field">
                <span>{copy.approvalReason}</span>
                <p>{pendingApproval.reason}</p>
              </div>
            {/if}
            <div class="approval-actions">
              {#each pendingApproval.options as option (option.id)}
                <button
                  type="button"
                  class:danger-action={option.id === "reject"}
                  disabled={sending}
                  onclick={() => resolveApproval(option.id as DesktopApprovalDecision)}
                >{approvalOptionLabel(option)}</button>
              {/each}
            </div>
          </div>
        {/if}
        {/if}
      </div>

      {#if viewMode === "external"}
        {#if externalTranscript}
          <footer class="composer-wrap">
            <p class="onboarding-hint" style="text-align: center; font-style: italic; opacity: 0.8; margin: 6px 0;">
              {copy.externalSessionReadOnly}
            </p>
          </footer>
        {/if}
      {:else}
        <footer class="composer-wrap">
          {#if !modelReady}
            <div class="model-banner" role="status">
              <div>
                <strong>{copy.noModelBannerTitle}</strong>
                <p>{copy.noModelBannerHint}</p>
              </div>
              <button class="secondary-button" type="button" onclick={() => openSettings()}>{copy.openSettings}</button>
            </div>
          {/if}
          {#if error}<p class="composer-error">{error}</p>{/if}
          {#if recordingError}<p class="composer-error">{recordingError}</p>{/if}
          {#if queuedMessages.length > 0}
            <div class="queued-messages">
              <span class="queued-badge">{copy.queued} · {queuedMessages.length}</span>
              {#each queuedMessages as queued, index (index)}
                <span class="pending-chip">
                  <span class="pending-name" title={queued}>{queued}</span>
                  <button type="button" aria-label={copy.removeQueued} onclick={() => removeQueued(index)}>×</button>
                </span>
              {/each}
            </div>
          {/if}
          {#if pendingFiles.length > 0}
            <div class="pending-files">
              {#each pendingFiles as file, index (index)}
                <span class="pending-chip" data-kind={inferAttachmentKind(file)}>
                  <span class="pending-name" title={file.name}>{file.name}</span>
                  {#if pendingAudioUrls.get(file)}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <audio class="pending-audio" controls src={pendingAudioUrls.get(file)}></audio>
                  {/if}
                  <button type="button" aria-label={copy.removeFile} disabled={sending} onclick={() => removePendingFile(index)}>×</button>
                </span>
              {/each}
            </div>
          {/if}
          <div class="composer">
            <input
              bind:this={fileInput}
              type="file"
              multiple
              hidden
              onchange={onFilesPicked}
            />
            <textarea
              bind:value={messageInput}
              rows="1"
              placeholder={sending ? copy.queueHint : copy.enterHint}
              disabled={!activeSessionId || !modelReady}
              onkeydown={handleComposerKeydown}
            ></textarea>
            {#if recording}
              <div class="recording-bar" role="status" aria-live="polite">
                <span class="recording-indicator" aria-hidden="true"></span>
                <span class="recording-label">{copy.recording}</span>
                <time>{formatDuration(recordingSeconds)}</time>
                <button type="button" class="recording-action" onclick={() => finishRecording(false)}>{copy.cancel}</button>
                <button type="button" class="recording-action primary" onclick={() => finishRecording(true)}>{copy.finishRecording}</button>
              </div>
            {/if}
            <div class="composer-bar">
              <div class="composer-tools">
                <button
                  class="composer-tool"
                  type="button"
                  aria-label={copy.addFiles}
                  title={copy.addFiles}
                  disabled={!activeSessionId || sending || !modelReady}
                  onclick={() => fileInput?.click()}
                ><i class="ph ph-paperclip" aria-hidden="true"></i></button>
                <button
                  class="composer-tool"
                  type="button"
                  aria-label={copy.files}
                  title={copy.files}
                  disabled={!activeSessionId}
                  onclick={() => (filePanelOpen = !filePanelOpen)}
                ><i class="ph ph-squares-four" aria-hidden="true"></i></button>
                <button
                  class="composer-tool"
                  class:recording={recording}
                  type="button"
                  aria-label={recording ? copy.finishRecording : copy.startRecording}
                  title={recording ? copy.finishRecording : copy.startRecording}
                  aria-pressed={recording}
                  disabled={!activeSessionId || sending || !modelReady}
                  onclick={toggleRecording}
                ><i class="ph ph-microphone" aria-hidden="true"></i></button>
              </div>
              <div class="composer-selectors">
                <label class="composer-pill">
                  <i class="ph ph-cpu" aria-hidden="true"></i>
                  <span class="composer-pill-label">{copy.model}</span>
                  <select value={activeModelKey} disabled={sending || changingModel || modelOptions.length === 0} onchange={changeModel} aria-label={copy.model}>
                    {#each modelOptions as model (model.key)}
                      <option value={model.key}>{model.label}</option>
                    {/each}
                  </select>
                  <i class="ph-bold ph-caret-down" aria-hidden="true"></i>
                </label>
                <label class="composer-pill">
                  <i class="ph ph-brain" aria-hidden="true"></i>
                  <span class="composer-pill-label">{copy.thinkingLevel}</span>
                  <select bind:value={thinkingLevel} disabled={sending} aria-label={copy.thinkingLevel}>
                    <option value="off">{copy.thinkingOff}</option>
                    <option value="low">{copy.thinkingLow}</option>
                    <option value="medium">{copy.thinkingMedium}</option>
                    <option value="high">{copy.thinkingHigh}</option>
                  </select>
                  <i class="ph-bold ph-caret-down" aria-hidden="true"></i>
                </label>
              </div>
              {#if sending}
                <button class="stop-button" type="button" aria-label={copy.stop} title={copy.stop} onclick={stopRun}>
                  <i class="ph-fill ph-stop" aria-hidden="true"></i>
                </button>
              {:else}
                <button class="send-button" type="button" aria-label={copy.send} title={copy.send} disabled={(!messageInput.trim() && pendingFiles.length === 0) || !activeSessionId || !modelReady} onclick={sendMessage}>
                  <i class="ph-fill ph-arrow-up" aria-hidden="true"></i>
                </button>
              {/if}
            </div>
          </div>
        </footer>
      {/if}
    {/if}
  </section>

  {#if filePanelOpen && serviceState === "ready" && profiles.length > 0}
    <aside class="file-panel">
      <div class="file-panel-head">
        <i class="ph-fill ph-folder-simple file-panel-icon" aria-hidden="true"></i>
        <strong>{copy.files}</strong>
        <button type="button" class="file-panel-close" aria-label={copy.closePanel} title={copy.closePanel} onclick={() => (filePanelOpen = false)}>
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="file-filters">
        {#each [["all", copy.fileFilterAll], ["image", copy.fileFilterImage], ["video", copy.fileFilterVideo], ["audio", copy.fileFilterAudio], ["file", copy.fileFilterFile]] as [value, label] (value)}
          <button
            type="button"
            class:active={fileFilter === value}
            onclick={() => (fileFilter = value as DesktopFileFilter)}
          >{label}</button>
        {/each}
      </div>

      {#if filesLoading && sessionFiles.length === 0}
        <p class="file-empty">{copy.filesLoading}</p>
      {:else if filteredFiles.length === 0}
        <p class="file-empty">{copy.noFiles}</p>
      {:else}
        <ul class="file-list">
          {#each filteredFiles as file (file.id)}
            <li class="file-row">
              <div class="file-info">
                <span class="file-kind" data-kind={file.mediaType} aria-hidden="true">
                  <i class={`ph-fill ph-${fileTypeIcon(file.mediaType)}`}></i>
                </span>
                <div class="file-meta">
                  <strong title={file.original}>{file.original}</strong>
                  <small>{formatFileSize(file.size)} · {formatTime(file.createdAt)}</small>
                </div>
              </div>
              <div class="file-actions">
                {#if canPreview(file)}
                  <button type="button" aria-label={copy.preview} title={copy.preview} onclick={() => openPreview(file)}><i class="ph ph-eye" aria-hidden="true"></i></button>
                {/if}
                <button type="button" aria-label={copy.download} title={copy.download} onclick={() => downloadFile(file)}><i class="ph ph-download-simple" aria-hidden="true"></i></button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="file-panel-footer">
        <i class="ph ph-cloud" aria-hidden="true"></i>
        <span>{sessionFiles.length} {copy.files} · {formatFileSize(sessionFiles.reduce((sum, f) => sum + f.size, 0))}</span>
        <button type="button" class="file-panel-manage" onclick={() => (fileFilter = "all")}>{copy.fileFilterAll}</button>
      </div>
    </aside>
  {/if}

  {#if showOnboarding}
    <div class="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div class="onboarding-card">
        <h2 id="onboarding-title">{onboardingTitle}</h2>
        <p class="onboarding-hint">{onboardingHint}</p>

        {#if onboardingIsGuided}
          <p class="onboarding-step-of">{onboardingStepOfText} · {onboardingStepLabels[onboardingStep]}</p>
          <ol class="onboarding-steps">
            {#each ONBOARDING_STEPS as step, i (step)}
              <li class:active={i === onboardingStepIndex} class:done={i < onboardingStepIndex}>{onboardingStepLabels[step]}</li>
            {/each}
          </ol>

          {#if onboardingStep === "provider"}
            <p class="onboarding-hint">{copy.onboardingProviderHint}</p>
            <label class="onboarding-field">
              <span>{copy.onboardingProviderName}</span>
              <input type="text" bind:value={providerDraft.name} placeholder="My Provider" />
              {#if providerValidation.errors.some((e) => e.field === "name")}
                <small class="onboarding-error">{providerValidation.errors.find((e) => e.field === "name")?.message}</small>
              {/if}
            </label>
            <label class="onboarding-field">
              <span>{copy.onboardingProviderProtocol}</span>
              <select bind:value={providerDraft.protocol}>
                <option value="openai-compatible">{copy.protocolOpenaiCompatible}</option>
                <option value="anthropic">{copy.protocolAnthropic}</option>
              </select>
            </label>
            <label class="onboarding-field">
              <span>{copy.onboardingProviderBaseUrl}</span>
              <input type="text" bind:value={providerDraft.baseUrl} placeholder="https://api.example.com/v1" />
              {#if providerValidation.errors.some((e) => e.field === "baseUrl")}
                <small class="onboarding-error">{providerValidation.errors.find((e) => e.field === "baseUrl")?.message}</small>
              {/if}
            </label>
            <div class="onboarding-model-registry">
              <div class="onboarding-model-toolbar">
                <strong>{copy.providerModelRegistry}</strong>
                <button type="button" class="secondary-button" disabled={providerSubmitted} onclick={addOnboardingProviderModel}>{copy.providerAddModel}</button>
              </div>
              {#each onboardingProviderModels as model, index (index)}
                <div class="onboarding-model-card">
                  <div class="onboarding-model-fields">
                    <label class="onboarding-field">
                      <span>{copy.providerModelId}</span>
                      <input type="text" value={model.id} disabled={providerSubmitted} placeholder="gpt-4o" oninput={(event) => updateOnboardingProviderModel(index, { id: event.currentTarget.value })} />
                    </label>
                    <label class="onboarding-field onboarding-context-field">
                      <span>{copy.providerModelContext}</span>
                      <input type="number" min="1" value={model.contextWindow ?? ""} disabled={providerSubmitted} placeholder="128000" oninput={(event) => { const value = Number(event.currentTarget.value); updateOnboardingProviderModel(index, { contextWindow: Number.isFinite(value) && value > 0 ? value : undefined }); }} />
                    </label>
                  </div>
                  <div class="onboarding-model-tags" aria-label={copy.providerModelTags}>
                    {#each onboardingProviderTags as tag (tag)}
                      <button type="button" class:active={model.tags.includes(tag)} disabled={providerSubmitted} onclick={() => toggleOnboardingProviderTag(index, tag)}>{tag}</button>
                    {/each}
                  </div>
                  <button type="button" class="onboarding-model-remove" disabled={providerSubmitted} onclick={() => removeOnboardingProviderModel(index)}>{copy.providerModelRemove}</button>
                </div>
              {/each}
              {#if providerValidation.errors.some((e) => e.field === "model")}
                <small class="onboarding-error">{providerValidation.errors.find((e) => e.field === "model")?.message}</small>
              {/if}
            </div>
            <label class="onboarding-field">
              <span>{copy.onboardingProviderApiKey}</span>
              <input type="password" value={providerApiKeyInput} oninput={onApiKeyInput} placeholder="sk-..." autocomplete="off" />
              <small>{providerDraft.apiKeyPresent ? copy.onboardingProviderApiKeyEntered : copy.onboardingProviderApiKeyEmpty}</small>
              {#if providerValidation.errors.some((e) => e.field === "apiKeyPresent")}
                <small class="onboarding-error">{providerValidation.errors.find((e) => e.field === "apiKeyPresent")?.message}</small>
              {/if}
            </label>
            <div class="onboarding-actions onboarding-provider-actions">
              <button type="button" class="secondary-button" disabled={!providerValidation.valid || providerSubmitting || providerSubmitted} onclick={saveOnboardingProvider}>
                {providerSubmitting ? copy.onboardingProviderSaving : providerSubmitted ? copy.onboardingProviderSaved : copy.onboardingProviderSave}
              </button>
              {#if providerSubmitted}
                <button type="button" class="secondary-button" disabled={providerTesting} onclick={testOnboardingProvider}>
                  {providerTesting ? copy.onboardingProviderTesting : copy.onboardingProviderTest}
                </button>
              {/if}
            </div>
            {#if providerSubmitError}
              <p class="onboarding-error">{copy.onboardingProviderSaveError}: {providerSubmitError}</p>
            {/if}
            {#if providerTestResult === "ok"}
              <p class="health-check-status">{copy.onboardingProviderTestOk}</p>
            {:else if providerTestResult === "fail"}
              <p class="onboarding-error">{copy.onboardingProviderTestFail}: {providerTestError}</p>
            {/if}
          {:else if onboardingStep === "agent"}
            <p class="onboarding-hint">{copy.onboardingAgentHint}</p>
            {#if onboardingProfiles.length === 0}
              <p class="onboarding-error">{copy.onboardingAgentNoProfiles}</p>
            {:else if onboardingEnabledAgents.length === 0}
              <p class="onboarding-error">{copy.onboardingAgentNoAgents}</p>
            {:else}
              <label class="onboarding-field">
                <span>{copy.profile}</span>
                <select value={onboardingProfileId} onchange={changeOnboardingProfile}>
                  {#each onboardingProfiles as profile (profile.id)}
                    <option value={profile.id}>{profile.name}</option>
                  {/each}
                </select>
              </label>
              <label class="onboarding-field">
                <span>{copy.onboardingStepAgent}</span>
                <select value={onboardingAgentId} onchange={changeOnboardingAgent}>
                  {#each onboardingEnabledAgents as agent (agent.id)}
                    <option value={agent.id}>{agent.name}</option>
                  {/each}
                </select>
              </label>
              <button type="button" class="secondary-button" disabled={!onboardingAgentCanConfirm} onclick={confirmOnboardingAgent}>
                {onboardingAgentSaving ? copy.onboardingAgentSaving : copy.onboardingAgentConfirm}
              </button>
              {#if onboardingAgentSaved}
                <p class="health-check-status">{copy.onboardingAgentSaved}</p>
              {:else if onboardingAgentError}
                <p class="onboarding-error">{onboardingAgentError}</p>
              {/if}
            {/if}
          {:else if onboardingStep === "launch"}
            <p class="onboarding-hint">{copy.onboardingLaunchHint}</p>
            <div class="onboarding-choice">
              <div>
                <strong>{copy.launchAtLogin}</strong>
                <p>{copy.launchAtLoginDescription}</p>
              </div>
              <button
                class:active={onboardingLaunchChoice}
                class="switch"
                type="button"
                role="switch"
                aria-label={copy.launchAtLogin}
                aria-checked={onboardingLaunchChoice}
                disabled={launchAtLoginBusy || onboardingLaunchChanging}
                onclick={toggleOnboardingLaunch}
              >
                <span></span>
              </button>
            </div>
            <p class="health-check-status">{onboardingLaunchChoice ? copy.onboardingLaunchEnabled : copy.onboardingLaunchDisabled}</p>
            {#if onboardingLaunchError}
              <p class="onboarding-error">{onboardingLaunchError}</p>
            {/if}
          {:else if onboardingStep === "channels"}
            <p class="onboarding-hint">{copy.onboardingChannelsHint}</p>
            {#if onboardingChannels.rows.length === 0}
              <p class="onboarding-deferred">{copy.onboardingChannelsNone}</p>
            {:else}
              <ul class="onboarding-channels">
                {#each onboardingChannels.rows as row (row.channel)}
                  <li>
                    <span>{row.channel}</span>
                    <span class="diag-value">{copy.channelsEnabledOfTotal.replace("{enabled}", String(row.enabled)).replace("{total}", String(row.total))}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="health-check-status">{copy.onboardingChannelsConnected.replace("{count}", String(onboardingChannels.connectedCount))}</p>
            <p class="onboarding-deferred">{copy.onboardingChannelsManage}</p>
          {:else if onboardingStep === "diagnostics"}
            <p class="onboarding-hint">{copy.onboardingDiagnosticsHint}</p>
            <ul class="onboarding-channels">
              <li>
                <span>{copy.onboardingDiagnosticsService}</span>
                <span class="diag-value">{onboardingDiagnostics.serviceReady ? copy.healthCheckReady : copy.healthCheckNotReady}</span>
              </li>
              <li>
                <span>{copy.runtimeEnv}</span>
                <span class="diag-value">{copy.onboardingDiagnosticsDeps.replace("{installed}", String(onboardingDiagnostics.depsInstalled)).replace("{total}", String(onboardingDiagnostics.depsTotal))}</span>
              </li>
            </ul>
            {#if onboardingDiagnostics.missingDependencyNames.length > 0}
              <p class="health-check-status">{copy.onboardingDiagnosticsMissing.replace("{names}", onboardingDiagnostics.missingDependencyNames.join(", "))}</p>
            {/if}
            <p class="onboarding-deferred">{copy.onboardingDiagnosticsManage}</p>
          {:else}
            <p class="onboarding-hint">{copy.onboardingProviderHint}</p>
            <p class="onboarding-deferred">{copy.onboardingProviderSubmitDeferred}</p>
          {/if}
        {/if}

        {#if onboardingMode === "usable"}
          <div class="health-check-card" data-ready={onboardingHealthCheck.ready}>
            <ul class="health-check-lines">
              {#each onboardingHealthCheck.lines as line}
                <li>{line}</li>
              {/each}
            </ul>
            <p class="health-check-status">{onboardingHealthCheck.ready ? copy.healthCheckReady : copy.healthCheckNotReady}</p>
          </div>
        {/if}

        <div class="onboarding-actions">
          {#if onboardingIsGuided && onboardingStepIndex > 0}
            <button type="button" class="secondary-button" onclick={prevOnboardingStep}>{copy.onboardingBack}</button>
          {/if}
          <button type="button" class="secondary-button" onclick={() => openSettings()}>{copy.openSettings}</button>
          {#if onboardingMode === "usable"}
            <button type="button" class="primary-button" onclick={dismissOnboarding}>{copy.onboardingContinue}</button>
          {:else if onboardingIsGuided && onboardingStepIndex < ONBOARDING_STEPS.length - 1}
            <button type="button" class="primary-button" disabled={(onboardingStep === "provider" && !providerSubmitted) || (onboardingStep === "agent" && !onboardingAgentSaved)} onclick={nextOnboardingStep}>{copy.onboardingNext}</button>
          {:else}
            <button type="button" class="primary-button" onclick={dismissOnboarding}>{copy.onboardingFinish}</button>
          {/if}
          <button type="button" class="secondary-button" onclick={dismissOnboarding}>{copy.onboardingDontShowAgain}</button>
        </div>
      </div>
    </div>
  {/if}
</main>

{#if previewFile && previewUrl}
  <div class="preview-overlay" role="dialog" aria-modal="true" aria-label={previewFile.original}>
    <div class="preview-card">
      <header>
        <strong title={previewFile.original}>{previewFile.original}</strong>
        <button type="button" onclick={closePreview}>{copy.closePreview}</button>
      </header>
      <div class="preview-body">
        {#if previewFile.mediaType === "image"}
          <img src={previewUrl} alt={previewFile.original} />
        {:else if previewFile.mediaType === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={previewUrl} controls></video>
        {:else if previewFile.mediaType === "audio"}
          <audio src={previewUrl} controls></audio>
        {/if}
      </div>
    </div>
  </div>
{/if}
