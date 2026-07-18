<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import type {
    DesktopAgentItem,
    DesktopChannelsSummary,
    DesktopApprovalDecision,
    DesktopConversationChannel,
    DesktopConversationItem,
    DesktopConversationMessage,
    DesktopExternalTranscript,
    DesktopMessageAttachment,
    DesktopMemoryTraceResponse,
    DesktopModelOption,
    DesktopProfileSummary,
    DesktopProviderCreateRequest,
    DesktopProviderModel,
    DesktopProviderModelTag,
    DesktopSessionFile,
    DesktopThinkingLevel,
    DesktopWebProfile
  } from "@molibot/desktop-contract";
  import type { Translation } from "./lib/i18n";
  import {
    buildOnboardingHealthCheck,
    classifyFirstLaunch,
    createDesktopProvider,
    fetchDesktopFileBlob,
    deleteDesktopConversation,
    filterDesktopFiles,
    listDesktopConversations,
    renameDesktopConversation,
    listDesktopSessionFiles,
    loadDesktopAgents,
    loadDesktopAgentFiles,
    loadDesktopBootstrap,
    loadDesktopChannels,
    loadDesktopExternalTranscript,
    loadDesktopModels,
    loadDesktopMemoryTrace,
    loadDesktopTaskUnreadCount,
    loadDesktopRuntimeEnv,
    loadDesktopSession,
    loadDesktopWebProfiles,
    ONBOARDING_STEPS,
    patchDesktopWebProfile,
    resolveOnboardingAgentSelection,
    resolveOnboardingRepairTarget,
    resolveOnboardingStartStep,
    saveDesktopAgentFiles,
    summarizeDesktopReadiness,
    summarizeOnboardingChannels,
    summarizeOnboardingDiagnostics,
    switchDesktopModel,
    submitDesktopMemoryTraceFeedback,
    testDesktopProvider,
    truncateDesktopMessages,
    type OnboardingChannelsView,
    type OnboardingDiagnostics,
    type DesktopFileFilter,
    type FirstLaunchClassification,
    type OnboardingStep,
    type OnboardingRepairTarget,
    type ProviderDraft,
    validateProviderDraft
  } from "./lib/api";
  import ChatWorkspacePane from "./lib/chat/ChatWorkspacePane.svelte";
  import ConversationTranscript from "./lib/chat/ConversationTranscript.svelte";
  import {
    clampTranscriptSearchIndex,
    findTranscriptMatches,
    type TranscriptAttachmentActions,
    type TranscriptMessage,
    type TranscriptMessageActions
  } from "./lib/chat/transcript";
  import ApprovalCard from "./lib/chat/ApprovalCard.svelte";
  import ChatInputArea from "./lib/chat/ChatInputArea.svelte";
  import ChatMessagesPane from "./lib/chat/ChatMessagesPane.svelte";
  import ChatSidebar from "./lib/chat/ChatSidebar.svelte";
  import TranscriptSearch from "./lib/chat/TranscriptSearch.svelte";
  import ProjectDetail from "./lib/projects/ProjectDetail.svelte";
  import ProjectFilePanel from "./lib/projects/ProjectFilePanel.svelte";
  import { projectsStore } from "./lib/stores/projects.svelte";
  import WindowDragMask from "./lib/WindowDragMask.svelte";
  import type { ChannelDescriptor } from "./lib/chat/ChannelAccordion.svelte";
  import ConversationBrowserDialog from "./lib/chat/ConversationBrowserDialog.svelte";
  import BotMention from "./lib/chat/BotMention.svelte";
  import { ChatSessionStore } from "./lib/chat/chatSessionStore.svelte";
  import { projectChatStore } from "./lib/projects/projectChatStore.svelte";
  import type { ConversationLabels, UiMessage } from "./lib/chat/conversationController.svelte";
  import { stickToBottom } from "./lib/chat/stickToBottom";
  import { openWorkspacePaneState, type ChatWorkspacePane as ChatWorkspacePaneName } from "./lib/chat/workspace";
  import {
    CommandSystem,
    CallbackCommandHostAdapter,
    type CommandContext,
    type CommandExecution,
    type CommandId,
    type CommandSnapshot
  } from "./lib/native/commandSystem";
  import { humanizeModelOption } from "./lib/presentation";
  import {
    loadCommandUsage,
    rankCommands,
    recordCommandSuccess,
    saveCommandUsage,
    type CommandUsage
  } from "./lib/native/commandPalette";
  import { DirectManipulation } from "./lib/native/directManipulation";
  import { ActivityScheduler, backgroundActivityPolicy, documentActivityVisibility, reconnectActivityPolicy } from "./lib/native/activityScheduler";
  import MemoryTraceDrawer from "./lib/chat/MemoryTraceDrawer.svelte";

  export let copy: Translation;
  export let locale: "zh-CN" | "en";
  export let serviceEndpoint: string | null;
  export let serviceState: "disconnected" | "ready" | "incompatible" | "error";
  export let startupPhase: "checking" | "starting" | "delayed" | "ready" | "error" | "retrying" = "checking";
  export let startupError = "";
  export let retryStartup: () => void = () => {};
  export let openStartupDiagnostics: () => void = () => {};
  export let openStartupLogs: () => void = () => {};
  export let serviceOwnership: "managed" | "external" | null = null;
  export let launchAtLogin: boolean;
  export let launchAtLoginBusy: boolean;
  export let setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  export let onHapticCommit: (gestureId: string) => void = () => {};
  export let onCommandResult: (result: CommandExecution) => void = () => {};
  export let openSettings: (section?: string) => void;
  export let requestedWorkspacePane: ChatWorkspacePaneName = "chat";

  const PROFILE_STORAGE_KEY = "molibot-desktop-profile";
  const LAST_BOT_KEY = "molibot-desktop-last-bot";
  const LAST_SESSION_KEY = "molibot-desktop-last-session";
  const FIRST_LAUNCH_SEEN_KEY = "molibot-desktop-first-launch-seen";
  const NATIVE_COMMAND_EVENT = "native-command";
  const PERSONALIZATION_MARKER_START = "<!-- molibot:onboarding-personalization:start -->";
  const PERSONALIZATION_MARKER_END = "<!-- molibot:onboarding-personalization:end -->";

  // The per-session runtime registry + active-session bridge (plan §4/§5). The
  // registry owns a pinned ConversationController per session so background turns
  // keep streaming into their own state; this store projects the active entry's
  // live turn state through the `state` store so the legacy `$:` template stays
  // reactive (memory: legacy `$:` can't track runes `$state` directly).
  const chatStore = new ChatSessionStore();

  let profiles: DesktopProfileSummary[] = [];
  let modelOptions: DesktopModelOption[] = [];
  let activeModelKey = "";
  let changingModel = false;
  let connectedEndpoint = "";
  let connectionReady = false;
  let loading = false;
  let error = "";
  let connectionGeneration = 0;

  // Composer state (bound to the textarea). Per-session drafts are persisted in
  // the SessionDraftStore; these locals are mirrored into/out of it on session
  // switch (plan §10.1).
  let messageInput = "";
  let pendingFiles: File[] = [];
  let fileInput: HTMLInputElement;
  let thinkingLevel: DesktopThinkingLevel = "medium";

  // Edit-and-resend state. `editingMessageId` is set when the user clicked the
  // pencil on one of their own messages; the composer then shows an "editing"
  // banner and `sendMessage` truncates the server transcript at that message
  // before re-running the turn so the history stays coherent.
  let editingMessageId = "";
  let editingSessionId = "";
  let copiedMessageId = "";
  let copiedMessageTimer: ReturnType<typeof setTimeout> | null = null;
  let memoryTraceId = "";
  let memoryTrace: DesktopMemoryTraceResponse["trace"] | null = null;
  let memoryTraceLoading = false;
  let memoryTraceError = "";
  let memoryTraceFeedback = new Set<string>();
  let memoryTraceReturnFocus: HTMLElement | null = null;

  async function openMemoryTrace(traceId: string): Promise<void> {
    memoryTraceReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    memoryTraceId = traceId;
    memoryTrace = null;
    memoryTraceError = "";
    memoryTraceLoading = true;
    try {
      memoryTrace = await loadDesktopMemoryTrace(connectedEndpoint, traceId);
    } catch (error) {
      memoryTraceError = error instanceof Error ? error.message : String(error);
    } finally {
      memoryTraceLoading = false;
    }
  }

  function closeMemoryTrace(): void {
    memoryTraceId = "";
    memoryTrace = null;
    memoryTraceError = "";
    memoryTraceFeedback = new Set();
    const target = memoryTraceReturnFocus;
    memoryTraceReturnFocus = null;
    void tick().then(() => target?.focus());
  }

  async function submitMemoryTraceFeedback(memoryId: string, value: "helpful" | "irrelevant" | "incorrect" | "expired" | "too_private"): Promise<void> {
    if (!memoryTraceId) return;
    try {
      await submitDesktopMemoryTraceFeedback(connectedEndpoint, memoryTraceId, memoryId, value);
      memoryTraceFeedback = new Set(memoryTraceFeedback).add(memoryId);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  // Sidebar expansion is separate from selection. Every group may be open and
  // the preference survives restarts.
  const SIDEBAR_TREE_KEY = "molibot-desktop-sidebar-tree-v2";
  let conversationsExpanded = true;
  let projectsExpanded = true;
  let expandedChannels: Record<DesktopConversationChannel, boolean> = { web: true, telegram: false, feishu: false, qq: false, weixin: false };
  let channelItems: Record<string, DesktopConversationItem[]> = {};
  let channelHasMore: Record<string, boolean> = {};
  let channelLoading: Record<string, boolean> = {};
  let browserChannel: DesktopConversationChannel = "web";
  let browserOpen = false;
  let channelSummary: DesktopChannelsSummary | null = null;

  // Read-only external transcript view (plan §3.3): opened from an external
  // channel's session row; never goes through the registry.
  let externalTranscript: DesktopExternalTranscript | null = null;
  let externalTranscriptLoading = false;
  let externalTranscriptError = "";
  let activeExternalSessionId = "";
  let activeExternalTitle = "";
  let activeExternalChannel = "";
  let activeExternalBotName = "";
  let viewMode: "local" | "external" = "local";
  let projectPaneActive = false;
  let activeProjectSessionId = "";
  let workspacePane: ChatWorkspacePaneName = requestedWorkspacePane;
  let appliedRequestedWorkspacePane: ChatWorkspacePaneName = requestedWorkspacePane;
  let automationUnreadCount = 0;
  let automationUnreadScheduler: ActivityScheduler | null = null;
  let reconnectScheduler: ActivityScheduler | null = null;

  async function refreshAutomationUnread(): Promise<void> {
    const endpoint = connectedEndpoint;
    const generation = connectionGeneration;
    if (!connectionReady || !endpoint) return;
    try {
      const unreadCount = await loadDesktopTaskUnreadCount(endpoint);
      if (generation !== connectionGeneration || endpoint !== connectedEndpoint || !connectionReady) return;
      automationUnreadCount = unreadCount;
    } catch {
      // The Automations workspace owns visible loading errors; a stale badge is
      // less disruptive than surfacing a second global error for the same API.
    }
  }

  function startAutomationUnreadPolling(): void {
    automationUnreadScheduler?.dispose();
    automationUnreadScheduler = new ActivityScheduler(
      backgroundActivityPolicy,
      refreshAutomationUnread,
      documentActivityVisibility
    );
    automationUnreadScheduler.start();
  }

  function stopAutomationUnreadPolling(): void {
    automationUnreadScheduler?.dispose();
    automationUnreadScheduler = null;
  }

  const SIDEBAR_WIDTH_KEY = "molibot-desktop-sidebar-width";
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 420;
  let sidebarWidth = clampSidebarWidth(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY) || 0) || 260);
  let resizingSidebar = false;
  let sidebarGestureId = "";
  let sidebarResizer: HTMLDivElement | null = null;
  const sidebarManipulation = new DirectManipulation({
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    mode: "continuous",
    onUpdate(snapshot) {
      sidebarWidth = clampSidebarWidth(snapshot.position);
      resizingSidebar = snapshot.phase === "tracking" || snapshot.phase === "dragging";
    },
    onSettled(target) {
      sidebarWidth = clampSidebarWidth(target);
      resizingSidebar = false;
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    },
    onCommitted() {
      if (sidebarGestureId) onHapticCommit(sidebarGestureId);
    }
  });
  function clampSidebarWidth(value: number): number {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));
  }
  function startSidebarResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarGestureId = `sidebar:${event.pointerId}:${event.timeStamp}`;
    sidebarResizer?.setPointerCapture(event.pointerId);
    sidebarManipulation.begin(event.pointerId, event.clientX, event.timeStamp, sidebarWidth);
  }
  function onSidebarResize(event: PointerEvent): void {
    sidebarManipulation.move(event.pointerId, event.clientX, event.timeStamp);
  }
  function stopSidebarResize(event?: PointerEvent): void {
    if (event && sidebarResizer?.hasPointerCapture(event.pointerId)) {
      sidebarResizer.releasePointerCapture(event.pointerId);
    }
    if (event) sidebarManipulation.end(event.pointerId, event.timeStamp);
    else sidebarManipulation.cancel();
  }
  function cancelSidebarResize(event?: PointerEvent): void {
    if (sidebarManipulation.current().phase === "idle") return;
    if (event && sidebarResizer?.hasPointerCapture(event.pointerId)) {
      sidebarResizer.releasePointerCapture(event.pointerId);
    }
    sidebarManipulation.cancel();
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
  let commandOpen = false;
  let commandElement: HTMLElement | null = null;
  let commandInputElement: HTMLInputElement | null = null;
  let commandReturnFocus: HTMLElement | null = null;
  let commandQuery = "";
  let commandIndex = 0;
  let commandSystem: CommandSystem;
  let commandContext: CommandContext = {
    locale: "en",
    runtime: "browser",
    workspace: "chat",
    service: { restartAvailable: false, webAvailable: false }
  };
  let commandSnapshot: CommandSnapshot[] = [];
  let commandUsage: CommandUsage = [];
  let nativeCommandUnlisten: UnlistenFn | null = null;
  let searchQuery = "";
  let searchIndex = 0;
  let previousSearchMatchCount = 0;
  let searchReturnFocus: HTMLElement | null = null;
  let messagesElement: HTMLDivElement;
  let sessionFiles: DesktopSessionFile[] = [];
  let fileFilter: DesktopFileFilter = "all";
  let filesLoading = false;
  let filePanelOpen = false;
  let previewFile: DesktopSessionFile | null = null;
  let previewUrl = "";
  let copiedPath = "";

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
  let onboardingUserName = "";
  let onboardingAiStyle: "concise" | "patient" | "rigorous" | "natural" = "concise";
  let onboardingPersonalizationSaving = false;
  let onboardingPersonalizationSaved = false;
  let onboardingPersonalizationError = "";
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
    personalization: copy.onboardingStepPersonalization,
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

  // Active-session live state, bridged through the store (plan §5). One store
  // subscription; downstream `$:` re-derive the fields the template needs.
  const stateStore = chatStore.state;
  $: chatState = $stateStore;
  $: sending = chatState.sending;
  $: messages = chatState.messages;
  $: streamingText = chatState.streamingText;
  $: streamingThinking = chatState.streamingThinking;
  $: activity = chatState.activity;
  $: activityEntries = chatState.activities;
  $: pendingApproval = chatState.pendingApproval;
  $: queuedMessages = chatState.queue;
  $: chatError = chatState.error;
  $: activeSessionId = chatState.activeSessionId;
  $: activeProfileId = chatState.activeProfileId;
  $: draftMode = chatState.draftMode;
  $: draftProfileId = chatState.draftProfileId;
  $: statusDots = chatState.statusDots;

  $: modelReady = summarizeDesktopReadiness(profiles, { currentKey: activeModelKey, options: modelOptions }).hasModel;
  $: readinessSummary = summarizeDesktopReadiness(profiles, { currentKey: activeModelKey, options: modelOptions });
  $: showOnboarding = serviceState === "ready" && !onboardingDismissed;
  $: filteredFiles = filterDesktopFiles(sessionFiles, fileFilter);
  $: fileByLocal = new Map(sessionFiles.map((file) => [file.local, file]));
  $: botOptions = profiles.map((profile) => ({
    id: profile.id,
    name: profile.agentName || copy.agentStudioGlobalName,
    subtitle: profile.name
  }));
  $: activeModelFullLabel = modelOptions.find((model) => model.key === activeModelKey)?.label ?? copy.model;
  // The pill only shows the bare model name (last "/"-segment); the provider
  // prefix like "[Custom] CliProxyAPI /" is kept for the dropdown + tooltip.
  $: activeModelLabel = humanizeModelOption(activeModelFullLabel, activeModelKey).label.split(" · ").at(-1) ?? copy.model;
  $: thinkingLabel = {
    off: copy.thinkingOff,
    low: copy.thinkingLow,
    medium: copy.thinkingMedium,
    high: copy.thinkingHigh
  }[thinkingLevel];
  $: if (requestedWorkspacePane !== appliedRequestedWorkspacePane) {
    appliedRequestedWorkspacePane = requestedWorkspacePane;
    workspacePane = requestedWorkspacePane;
  }
  $: activeBotName = profiles.find((profile) => profile.id === (draftMode ? draftProfileId : activeProfileId))?.name ?? copy.bot;
  $: activeAgentName = profiles.find((profile) => profile.id === (draftMode ? draftProfileId : activeProfileId))?.agentName || copy.agentStudioGlobalName;
  $: activeHeaderBotName = viewMode === "external" ? (activeExternalBotName || copy.bot) : activeBotName;
  $: activeHeaderAvatar = activeHeaderBotName.trim().charAt(0).toUpperCase() || "M";
  $: activeSessionItem = Object.values(channelItems).flat().find((item) => item.sessionId === activeSessionId);
  $: activeExternalSessionItem = Object.values(channelItems).flat().find((item) => item.sessionId === activeExternalSessionId);
  $: activeSessionTitle = activeSessionItem
    ? `${sidebarChannels.find((channel) => channel.id === activeSessionItem?.channel)?.name ?? activeSessionItem.channel} / ${activeSessionItem.title}`
    : copy.chat;
  $: activeExternalTitleWithSource = activeExternalSessionId
    ? `${sidebarChannels.find((channel) => channel.id === activeExternalChannel)?.name ?? activeExternalChannel} / ${activeExternalTitle}`
    : copy.chat;
  $: sidebarActiveSessionId = projectPaneActive ? "" : (viewMode === "external" ? activeExternalSessionId : activeSessionId);
  $: sidebarChannels = buildSidebarChannels(profiles, channelSummary);
  $: searchMatchIds = findTranscriptMatches(messages, searchOpen ? searchQuery : "", copy.chatAssistantError);
  $: if (searchMatchIds.length !== previousSearchMatchCount) {
    previousSearchMatchCount = searchMatchIds.length;
    searchIndex = clampTranscriptSearchIndex(searchIndex, searchMatchIds.length);
  }
  $: boundedSearchIndex = clampTranscriptSearchIndex(searchIndex, searchMatchIds.length);
  $: activeMatchId = searchMatchIds[boundedSearchIndex] ?? "";
  $: approvalOptions = pendingApproval?.options.map((option) => ({
    id: option.id,
    label: approvalOptionLabel(option)
  })) ?? [];
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
    connectionReady = false;
    stopAutomationUnreadPolling();
    stopReconnectPoll();
    profiles = [];
    onboardingProfiles = [];
    onboardingAgents = [];
    onboardingChannels = { rows: [], connectedCount: 0 };
    onboardingDiagnostics = { serviceReady: false, depsInstalled: 0, depsTotal: 0, missingDependencyNames: [] };
    onboardingProfileId = "";
    onboardingAgentId = "";
    onboardingAgentSaved = false;
    onboardingAgentError = "";
    onboardingUserName = "";
    onboardingAiStyle = "concise";
    onboardingPersonalizationSaving = false;
    onboardingPersonalizationSaved = false;
    onboardingPersonalizationError = "";
    onboardingLaunchError = "";
    onboardingLaunchTouched = false;
    onboardingLaunchChanging = false;
    onboardingLaunchChoice = launchAtLogin;
    onboardingMode = "new";
    onboardingRepairTarget = null;
    onboardingStep = "provider";
    channelItems = {};
    channelHasMore = {};
    channelLoading = {};
    expandedChannels = { web: true, telegram: false, feishu: false, qq: false, weixin: false };
    projectPaneActive = false;
    activeProjectSessionId = "";
    activeExternalSessionId = "";
    activeExternalTitle = "";
    activeExternalChannel = "";
    activeExternalBotName = "";
    viewMode = "local";
    externalTranscript = null;
    sessionFiles = [];
    chatStore.disposeAll();
    projectChatStore.disposeAll();
    closePreview();
  }

  function buildSidebarChannels(profilesList: DesktopProfileSummary[], summary: DesktopChannelsSummary | null): ChannelDescriptor[] {
    const enabled = (channel: string): number => summary?.groups.find((group) => group.channel === channel)?.enabled ?? 0;
    return [
      { id: "web", icon: "globe", name: copy.channelWeb, configured: profilesList.length > 0 },
      { id: "telegram", icon: "telegram-logo", name: "Telegram", configured: enabled("telegram") > 0 },
      { id: "feishu", icon: "bird", name: copy.channelFeishu, configured: enabled("feishu") > 0 },
      { id: "qq", icon: "linux-logo", name: "QQ", configured: enabled("qq") > 0 },
      { id: "weixin", icon: "wechat-logo", name: copy.channelWeixin, configured: enabled("weixin") > 0 }
    ];
  }

  function conversationLabels(): ConversationLabels {
    return {
      working: copy.working,
      uploading: copy.uploading,
      recognizingImage: copy.recognizingImage,
      stopped: copy.stopped,
      idle: copy.idle,
      resuming: copy.resuming
    };
  }

  async function loadTranscript(profileId: string, sessionId: string): Promise<UiMessage[]> {
    const detail = await loadDesktopSession(connectedEndpoint, profileId, sessionId);
    return detail.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ ...message }));
  }

  function defaultBot(): string {
    const last = localStorage.getItem(LAST_BOT_KEY) ?? "";
    if (last && profiles.some((profile) => profile.id === last)) return last;
    return profiles[0]?.id ?? "";
  }

  function persistSelected(profileId: string, sessionId: string): void {
    if (!profileId || !sessionId) return;
    localStorage.setItem(LAST_SESSION_KEY, `${profileId}:${sessionId}`);
  }
  function restoreSelected(): { profileId: string; sessionId: string } | null {
    const saved = localStorage.getItem(LAST_SESSION_KEY) ?? "";
    const [profileId, sessionId] = saved.split(":");
    if (!profileId || !sessionId) return null;
    return { profileId, sessionId };
  }

  // Mirror the composer locals into the draft store for the outgoing session,
  // then load the incoming session's draft back into the locals (plan §10.1).
  function syncDraftOut(): void {
    const key = chatStore.currentDraftKey();
    chatStore.draftStore.setText(key, messageInput);
    chatStore.draftStore.setFiles(key, pendingFiles);
    chatStore.draftStore.setThinking(key, thinkingLevel);
  }
  function loadDraftIn(): void {
    const draft = chatStore.draftStore.get(chatStore.currentDraftKey());
    messageInput = draft.text;
    pendingFiles = draft.files;
    thinkingLevel = draft.thinkingLevel;
  }
  const settingsChannel = new BroadcastChannel("molibot-settings-channel");
  settingsChannel.onmessage = (event) => {
    if (event.data?.type === "refresh-models") {
      void refreshModelsAndProfiles();
    }
  };

  async function refreshModelsAndProfiles(): Promise<void> {
    if (!connectedEndpoint || loading) return;
    try {
      const [nextProfiles, modelState, nextWebProfiles, nextAgents, nextChannels, nextRuntimeEnv] = await Promise.all([
        loadDesktopBootstrap(connectedEndpoint),
        loadDesktopModels(connectedEndpoint),
        loadDesktopWebProfiles(connectedEndpoint),
        loadDesktopAgents(connectedEndpoint).catch(() => null),
        loadDesktopChannels(connectedEndpoint).catch(() => null),
        loadDesktopRuntimeEnv(connectedEndpoint).catch(() => null)
      ]);
      
      profiles = nextProfiles;
      modelOptions = modelState.options;
      activeModelKey = modelState.currentKey;
      onboardingProfiles = nextWebProfiles;
      if (nextAgents) onboardingAgents = nextAgents.items;
      if (nextChannels) {
        channelSummary = nextChannels;
        onboardingChannels = summarizeOnboardingChannels(nextChannels);
      }
      if (nextRuntimeEnv) {
        onboardingDiagnostics = summarizeOnboardingDiagnostics(nextRuntimeEnv, true);
      }
      
      const nextReadiness = summarizeDesktopReadiness(nextProfiles, modelState);
      onboardingMode = classifyFirstLaunch(nextReadiness);
      onboardingRepairTarget = resolveOnboardingRepairTarget(nextReadiness);
      onboardingStep = resolveOnboardingStartStep(nextReadiness);
    } catch (e) {
      console.error("Failed to refresh models and profiles:", e);
    }
  }

  async function connect(endpoint: string): Promise<void> {
    const generation = ++connectionGeneration;
    connectedEndpoint = endpoint;
    connectionReady = false;
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
      channelSummary = nextChannels;
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

      chatStore.init({
        endpoint: () => connectedEndpoint,
        modelReady: () => modelReady,
        labels: () => conversationLabels(),
        loadTranscript,
        refreshSidebar: () => loadChannel("web"),
        onSessionCreated: (profileId, sessionId) => {
          localStorage.setItem(LAST_BOT_KEY, profileId);
          void loadChannel("web");
          void refreshFiles(profileId, sessionId);
        }
      });

      connectionReady = true;
      loading = false;
      startAutomationUnreadPolling();
      void selectDefaultSession(generation);
      void chatStore.reconnect();
      startReconnectPoll();
    } catch (cause) {
      if (generation === connectionGeneration) {
        connectionReady = false;
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (generation === connectionGeneration) loading = false;
    }
  }

  function restoreSidebarTree(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(SIDEBAR_TREE_KEY) || "{}");
      conversationsExpanded = saved.conversationsExpanded !== false;
      projectsExpanded = saved.projectsExpanded !== false;
      if (saved.expandedChannels && typeof saved.expandedChannels === "object") {
        expandedChannels = { ...expandedChannels, ...saved.expandedChannels };
      }
    } catch { /* defaults are intentional */ }
  }

  function persistSidebarTree(): void {
    localStorage.setItem(SIDEBAR_TREE_KEY, JSON.stringify({ conversationsExpanded, projectsExpanded, expandedChannels }));
  }

  async function selectDefaultSession(generation = connectionGeneration): Promise<void> {
    restoreSidebarTree();
    await Promise.all((Object.entries(expandedChannels) as Array<[DesktopConversationChannel, boolean]>).filter(([, open]) => open).map(([channel]) => loadChannel(channel)));
    if (generation !== connectionGeneration) return;
    const webItems = channelItems.web ?? [];
    const last = restoreSelected();
    const lastItem = last
      ? webItems.find((item) => item.sessionId === last.sessionId && item.botId === last.profileId)
      : null;
    const target = lastItem ?? webItems[0] ?? null;
    if (target) {
      chatStore.selectSession(target.botId, target.sessionId);
      loadDraftIn();
      void refreshFiles(target.botId, target.sessionId);
    } else {
      chatStore.newConversationDraft(defaultBot());
      loadDraftIn();
    }
  }

  async function loadChannel(channel: DesktopConversationChannel): Promise<void> {
    if (!connectedEndpoint) return;
    channelLoading = { ...channelLoading, [channel]: true };
    try {
      const res = await listDesktopConversations(connectedEndpoint, { channel, limit: 10 });
      channelItems = { ...channelItems, [channel]: res.items };
      channelHasMore = { ...channelHasMore, [channel]: Boolean(res.hasMore) || res.items.length >= 10 };
    } catch {
      channelItems = { ...channelItems, [channel]: [] };
      channelHasMore = { ...channelHasMore, [channel]: false };
    } finally {
      channelLoading = { ...channelLoading, [channel]: false };
    }
  }

  function toggleChannel(channel: DesktopConversationChannel): void {
    const open = !expandedChannels[channel];
    expandedChannels = { ...expandedChannels, [channel]: open };
    persistSidebarTree();
    if (open) void loadChannel(channel);
  }

  function toggleConversations(): void {
    conversationsExpanded = !conversationsExpanded;
    persistSidebarTree();
  }

  function toggleProjects(): void {
    projectsExpanded = !projectsExpanded;
    persistSidebarTree();
  }

  function newConversation(): void {
    if (!connectedEndpoint) return;
    workspacePane = "chat";
    viewMode = "local";
    projectPaneActive = false;
    closeExternalTranscript();
    conversationsExpanded = true;
    expandedChannels = { ...expandedChannels, web: true };
    persistSidebarTree();
    syncDraftOut();
    chatStore.newConversationDraft(defaultBot());
    loadDraftIn();
    void refreshFiles("", "");
  }

  function openSession(item: DesktopConversationItem): void {
    browserOpen = false;
    expandedChannels = { ...expandedChannels, [item.channel]: true };
    persistSidebarTree();
    if (item.readOnly) {
      projectPaneActive = false;
      void openExternalTranscript(item.sessionId, item.channel, item.title, item.botName);
      void refreshFiles(item.botId, item.sessionId);
      return;
    }
    workspacePane = "chat";
    viewMode = "local";
    projectPaneActive = false;
    closeExternalTranscript();
    syncDraftOut();
    chatStore.selectSession(item.botId, item.sessionId);
    loadDraftIn();
    persistSelected(item.botId, item.sessionId);
    void refreshFiles(item.botId, item.sessionId);
  }

  async function renameSession(item: DesktopConversationItem, title: string): Promise<void> {
    if (!connectedEndpoint || item.readOnly) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === item.title) return;
    try {
      const saved = await renameDesktopConversation(connectedEndpoint, item.sessionId, trimmed);
      // Reflect the sanitized title immediately, then refresh from the server.
      channelItems = { ...channelItems, [item.channel]: (channelItems[item.channel] ?? []).map((it) =>
        it.sessionId === item.sessionId ? { ...it, title: saved } : it
      ) };
      await loadChannel(item.channel);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function deleteSession(item: DesktopConversationItem): Promise<void> {
    // Confirmation happens inline in the row menu (native window.confirm is
    // unreliable in the Tauri webview), so this just performs the delete.
    if (!connectedEndpoint || item.readOnly) return;
    try {
      await deleteDesktopConversation(connectedEndpoint, item.sessionId);
      chatStore.disposeSession(item.botId, item.sessionId);
      const remaining = (channelItems[item.channel] ?? []).filter((it) => it.sessionId !== item.sessionId);
      channelItems = { ...channelItems, [item.channel]: remaining };
      if (viewMode === "local" && item.sessionId === activeSessionId) {
        if (remaining[0]) openSession(remaining[0]);
        else {
          chatStore.newConversationDraft(defaultBot());
          loadDraftIn();
        }
      }
      await loadChannel(item.channel);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function openBrowser(channel: DesktopConversationChannel): void {
    browserChannel = channel;
    browserOpen = true;
  }

  async function openExternalTranscript(sessionId: string, channel: string, title: string, botName: string): Promise<void> {
    if (!connectedEndpoint || sessionId === activeExternalSessionId) return;
    workspacePane = "chat";
    viewMode = "external";
    activeExternalSessionId = sessionId;
    activeExternalTitle = title;
    activeExternalChannel = channel;
    activeExternalBotName = botName;
    externalTranscript = null;
    externalTranscriptError = "";
    externalTranscriptLoading = true;
    try {
      externalTranscript = await loadDesktopExternalTranscript(connectedEndpoint, sessionId);
    } catch (cause) {
      externalTranscript = null;
      externalTranscriptError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      externalTranscriptLoading = false;
    }
  }

  function closeExternalTranscript(): void {
    externalTranscript = null;
    externalTranscriptError = "";
    activeExternalSessionId = "";
    activeExternalTitle = "";
    activeExternalChannel = "";
    activeExternalBotName = "";
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
      const modelState = await loadDesktopModels(connectedEndpoint, "text");
      modelOptions = modelState.options;
      activeModelKey = modelState.currentKey;
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
    if (onboardingStep === "personalization" && !onboardingPersonalizationSaved) return;
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
    onboardingPersonalizationSaved = false;
    onboardingPersonalizationError = "";
  }

  function changeOnboardingAgent(event: Event): void {
    onboardingAgentId = (event.currentTarget as HTMLSelectElement).value;
    onboardingAgentSaved = false;
    onboardingAgentError = "";
    onboardingPersonalizationSaved = false;
    onboardingPersonalizationError = "";
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
      onboardingAgentSaved = true;
    } catch (cause) {
      onboardingAgentError = cause instanceof Error ? cause.message : String(cause);
      onboardingAgentSaved = false;
    } finally {
      onboardingAgentSaving = false;
    }
  }

  function replacePersonalizationSection(existing: string, body: string): string {
    const section = `${PERSONALIZATION_MARKER_START}\n${body.trim()}\n${PERSONALIZATION_MARKER_END}`;
    const pattern = new RegExp(`${PERSONALIZATION_MARKER_START}[\\s\\S]*?${PERSONALIZATION_MARKER_END}`);
    if (pattern.test(existing)) return existing.replace(pattern, section);
    const trimmed = existing.trimEnd();
    return `${trimmed}${trimmed ? "\n\n" : ""}${section}\n`;
  }

  function onboardingStyleInstruction(): string {
    if (onboardingAiStyle === "patient") return "Use a patient, explanatory style. Explain assumptions and next steps clearly.";
    if (onboardingAiStyle === "rigorous") return "Use a rigorous, direct style. Surface tradeoffs, weak assumptions, and verification steps.";
    if (onboardingAiStyle === "natural") return "Use a natural conversational style. Keep answers warm, clear, and practical.";
    return "Use a concise, practical style. Lead with the answer and avoid unnecessary detail.";
  }

  async function saveOnboardingPersonalization(): Promise<void> {
    if (!connectedEndpoint || !onboardingAgentId || onboardingPersonalizationSaving) return;
    onboardingPersonalizationSaving = true;
    onboardingPersonalizationError = "";
    try {
      const currentFiles = await loadDesktopAgentFiles(connectedEndpoint, onboardingAgentId);
      const userLines = [
        "# User Preferences",
        "",
        `Preferred name: ${onboardingUserName.trim() || "Not specified"}`
      ];
      const soulLines = [
        "# Assistant Style",
        "",
        onboardingStyleInstruction()
      ];
      await saveDesktopAgentFiles(connectedEndpoint, onboardingAgentId, {
        "USER.md": replacePersonalizationSection(currentFiles["USER.md"] ?? "", userLines.join("\n")),
        "SOUL.md": replacePersonalizationSection(currentFiles["SOUL.md"] ?? "", soulLines.join("\n"))
      });
      onboardingPersonalizationSaved = true;
    } catch (cause) {
      onboardingPersonalizationError = cause instanceof Error ? cause.message : String(cause);
      onboardingPersonalizationSaved = false;
    } finally {
      onboardingPersonalizationSaving = false;
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

  async function refreshFiles(profileId: string, sessionId: string): Promise<void> {
    if (!connectedEndpoint || !profileId || !sessionId) {
      sessionFiles = [];
      return;
    }
    filesLoading = true;
    try {
      const files = await listDesktopSessionFiles(connectedEndpoint, profileId, sessionId);
      sessionFiles = files;
    } catch {
      sessionFiles = [];
    } finally {
      filesLoading = false;
    }
  }

  async function openPreview(file: DesktopSessionFile): Promise<void> {
    const currentProfileId = viewMode === "external" ? (activeExternalSessionItem?.botId ?? "") : activeProfileId;
    const currentSessionId = viewMode === "external" ? activeExternalSessionId : activeSessionId;
    if (!connectedEndpoint || !currentProfileId || !currentSessionId) return;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, currentProfileId, currentSessionId, file.id);
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
    const currentProfileId = viewMode === "external" ? (activeExternalSessionItem?.botId ?? "") : activeProfileId;
    const currentSessionId = viewMode === "external" ? activeExternalSessionId : activeSessionId;
    if (!connectedEndpoint || !currentProfileId || !currentSessionId) return;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, currentProfileId, currentSessionId, file.id, true);
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

  async function copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      copiedPath = path;
      setTimeout(() => { if (copiedPath === path) copiedPath = ""; }, 1200);
    } catch { /* clipboard unavailable */ }
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

  function addPastedFiles(files: File[]): void {
    pendingFiles = [...pendingFiles, ...files];
  }

  function removePendingFile(index: number): void {
    pendingFiles = pendingFiles.filter((_, position) => position !== index);
  }

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

  let messageMediaUrls = new Map<string, string>();
  let messageMediaLoading = new Set<string>();
  let messageMediaFailed = new Set<string>();
  $: transcriptAttachmentActions = {
    filesByLocal: fileByLocal,
    mediaUrls: messageMediaUrls,
    mediaLoading: messageMediaLoading,
    mediaFailed: messageMediaFailed,
    loadMedia: (file) => void loadMessageMedia(file),
    canPreview,
    preview: (file) => void openPreview(file),
    download: (file) => void downloadFile(file)
  } satisfies TranscriptAttachmentActions;
  $: messageActions = messages.length === 0
    ? null
    : {
        copiedId: copiedMessageId,
        onCopy: (m: TranscriptMessage) => void copyMessageContent(m),
        onEditUser: viewMode === "external" || sending
          ? undefined
          : (m: TranscriptMessage) => startEditUserMessage(m),
        editingId: editingMessageId,
        onOpenMemoryTrace: (traceId: string) => void openMemoryTrace(traceId)
      } satisfies TranscriptMessageActions;
  // Read-only external transcript supports copy-only (no edit); bind its own
  // actions so the clipboard still works there even when `messageActions`
  // above is null (e.g. main transcript empty).
  $: externalMessageActions = externalTranscript?.messages?.length
    ? {
        copiedId: copiedMessageId,
        onCopy: (m: TranscriptMessage) => void copyMessageContent(m)
      } satisfies TranscriptMessageActions
    : null;
  // Reset the editing banner when the active session changes underneath us;
  // the edit is bound to a specific message id in a specific session.
  $: if (editingMessageId && editingSessionId && activeSessionId !== editingSessionId) {
    editingMessageId = "";
    editingSessionId = "";
  }
  let messageMediaSession = "";
  $: {
    const currentSessionId = viewMode === "external" ? activeExternalSessionId : activeSessionId;
    if (currentSessionId !== messageMediaSession) {
      for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
      messageMediaUrls = new Map();
      messageMediaLoading = new Set();
      messageMediaFailed = new Set();
      messageMediaSession = currentSessionId;
    }
  }

  async function loadMessageMedia(file: DesktopSessionFile): Promise<void> {
    const currentProfileId = viewMode === "external" ? (activeExternalSessionItem?.botId ?? "") : activeProfileId;
    const currentSessionId = viewMode === "external" ? activeExternalSessionId : activeSessionId;
    if (!connectedEndpoint || !currentProfileId || !currentSessionId) return;
    if (messageMediaUrls.has(file.local) || messageMediaLoading.has(file.local)) return;
    const requestedSessionId = currentSessionId;
    const loading = new Set(messageMediaLoading);
    loading.add(file.local);
    messageMediaLoading = loading;
    const retrying = new Set(messageMediaFailed);
    retrying.delete(file.local);
    messageMediaFailed = retrying;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, currentProfileId, currentSessionId, file.id);
      const url = URL.createObjectURL(blob);
      if ((viewMode === "external" ? activeExternalSessionId : activeSessionId) !== requestedSessionId) {
        URL.revokeObjectURL(url);
        return;
      }
      const next = new Map(messageMediaUrls);
      next.set(file.local, url);
      messageMediaUrls = next;
    } catch (cause) {
      if ((viewMode === "external" ? activeExternalSessionId : activeSessionId) !== requestedSessionId) return;
      const failed = new Set(messageMediaFailed);
      failed.add(file.local);
      messageMediaFailed = failed;
    } finally {
      if ((viewMode === "external" ? activeExternalSessionId : activeSessionId) === requestedSessionId) {
        const done = new Set(messageMediaLoading);
        done.delete(file.local);
        messageMediaLoading = done;
      }
    }
  }

  async function sendMessage(): Promise<void> {
    const text = messageInput;
    const files = pendingFiles;
    const editingId = editingMessageId;
    const editingSession = editingSessionId;
    if (editingId) {
      // Edit-and-resend: drop the original user message and everything that
      // followed it on the server before re-running the turn. If truncate fails,
      // restore the composer so the user can retry instead of losing the edit.
      if (!connectedEndpoint || !activeProfileId || !activeSessionId) {
        error = copy.editMessageUnavailable;
        return;
      }
      messageInput = "";
      pendingFiles = [];
      editingMessageId = "";
      editingSessionId = "";
      try {
        await truncateDesktopMessages(connectedEndpoint, activeProfileId, activeSessionId, editingId);
      } catch (cause) {
        const status = (cause as Error & { status?: number }).status;
        if (status === 422) {
          // The server didn't find that message id in this session - the
          // local transcript is stale (typically an optimistic `pending-...`
          // id left over from a failed reload). Refresh from the server and
          // ask the user to pick the message again.
          await chatStore.reloadActive();
          error = copy.editMessageStale;
        } else {
          error = cause instanceof Error ? cause.message : String(cause);
        }
        messageInput = text;
        pendingFiles = files;
        editingMessageId = editingId;
        editingSessionId = editingSession;
        return;
      }
    } else {
      messageInput = "";
      pendingFiles = [];
    }
    await chatStore.send(text, files);
  }

  async function copyMessageContent(message: TranscriptMessage): Promise<void> {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      copiedMessageId = message.id ?? "";
      if (copiedMessageTimer) clearTimeout(copiedMessageTimer);
      copiedMessageTimer = setTimeout(() => {
        copiedMessageId = "";
        copiedMessageTimer = null;
      }, 1500);
    } catch { /* clipboard unavailable */ }
  }

  function startEditUserMessage(message: TranscriptMessage): void {
    if (!message.id || !activeSessionId) return;
    if (sending) return;
    editingMessageId = message.id;
    editingSessionId = activeSessionId;
    messageInput = message.content ?? "";
    pendingFiles = [];
    void tick().then(() => {
      const textarea = messagesElement?.closest(".chat-content")?.querySelector("textarea");
      textarea?.focus();
      if (textarea instanceof HTMLTextAreaElement) {
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      }
    });
  }

  function cancelEditMessage(): void {
    editingMessageId = "";
    editingSessionId = "";
  }

  async function stopRun(): Promise<void> {
    await chatStore.stopActive();
  }

  function approvalOptionLabel(option: { id: string; label: string }): string {
    if (option.id === "approve_once") return copy.approveOnce;
    if (option.id === "approve_session") return copy.approveSession;
    if (option.id === "approve_persistent") return copy.approvePersistent;
    if (option.id === "reject") return copy.reject;
    return option.label;
  }

  async function resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
    await chatStore.resolveApproval(decision);
  }

  function resolveApprovalId(decision: string): void {
    void resolveApproval(decision as DesktopApprovalDecision);
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
    // Command/Ctrl+Return is the product-wide send shortcut. Shift+Enter remains
    // supported for existing users; a bare Enter inserts a newline.
    if (event.key === "Enter" && (event.shiftKey || event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      if (sending) queueFollowUp();
      else void sendMessage();
    }
  }

  function queueFollowUp(): void {
    if (chatStore.enqueueFollowUp(messageInput)) messageInput = "";
  }

  function removeQueued(index: number): void {
    chatStore.removeQueued(index);
  }

  async function toggleSearch(): Promise<void> {
    if (searchOpen) {
      searchOpen = false;
      searchQuery = "";
      searchIndex = 0;
      await tick();
      searchReturnFocus?.focus();
      searchReturnFocus = null;
      return;
    }
    searchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchOpen = true;
  }

  async function executeCommand(id: CommandId): Promise<void> {
    switch (id) {
      case "app.open-chat":
      case "app.open-web":
      case "app.quit":
        await invoke("execute_native_command", { id });
        return;
      case "chat.new":
        newConversation();
        return;
      case "chat.search":
        if (!searchOpen) await toggleSearch();
        return;
      case "workspace.automations":
        openWorkspacePane("automations");
        return;
      case "workspace.skills":
        openWorkspacePane("skills");
        return;
      case "workspace.agents":
        openWorkspacePane("agents");
        return;
      case "app.open-settings":
        openSettings();
        return;
      case "diagnostics.open":
        openSettings("diagnostics");
        return;
      case "service.restart":
        await invoke("restart_service");
        return;
      default:
        if (id.startsWith("settings.")) {
          openSettings(id.slice("settings.".length));
        }
    }
  }

  commandSystem = new CommandSystem(new CallbackCommandHostAdapter(executeCommand));
  // Deps must be referenced directly in the reactive statement (a no-arg
  // helper call would run once and go stale — tray items stay disabled).
  $: commandContext = {
    locale,
    runtime: isTauriRuntime() ? "desktop" : "browser",
    workspace: projectPaneActive ? "project" : workspacePane,
    service: {
      restartAvailable: serviceOwnership === "managed",
      webAvailable: Boolean(serviceEndpoint)
    }
  };
  $: commandSnapshot = commandSystem.snapshot(commandContext);
  $: commandResults = rankCommands(commandSnapshot, commandQuery, commandUsage);
  $: if (commandIndex >= commandResults.length) commandIndex = 0;
  $: if (commandContext.runtime === "desktop") {
    void invoke("sync_native_command_menu", { commands: commandSnapshot });
  }

  async function runSystemCommand(id: string): Promise<void> {
    const result = await commandSystem.execute(id, commandContext);
    if (result.status === "executed") {
      commandUsage = recordCommandSuccess(commandUsage, result.id, commandSnapshot);
      saveCommandUsage(localStorage, commandUsage);
    }
    onCommandResult(result);
  }

  onMount(() => {
    commandUsage = loadCommandUsage(localStorage, commandSnapshot);
    if (!isTauriRuntime()) return;
    void listen<string>(NATIVE_COMMAND_EVENT, (event) => {
      void runSystemCommand(event.payload);
    }).then((unlisten) => {
      nativeCommandUnlisten = unlisten;
    });
  });

  async function toggleCommandPalette(): Promise<void> {
    if (commandOpen) {
      commandOpen = false;
      commandReturnFocus?.focus();
      return;
    }
    commandReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    commandQuery = "";
    commandIndex = 0;
    commandOpen = true;
    await tick();
    commandInputElement?.focus();
  }

  function closeCommandPalette(): void {
    commandOpen = false;
    commandReturnFocus?.focus();
  }

  function runCommand(id: CommandId): void {
    commandOpen = false;
    void runSystemCommand(id);
  }

  function selectCommand(delta: number): void {
    if (commandResults.length === 0) return;
    commandIndex = (commandIndex + delta + commandResults.length) % commandResults.length;
  }

  function onCommandInput(event: Event): void {
    commandQuery = (event.currentTarget as HTMLInputElement).value;
    commandIndex = 0;
  }

  function onCommandKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selectCommand(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      const command = commandResults[commandIndex];
      if (!command) return;
      event.preventDefault();
      runCommand(command.id);
    }
  }

  function onChatShortcut(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      void toggleCommandPalette();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && workspacePane === "chat" && !projectPaneActive) {
      event.preventDefault();
      if (!searchOpen) void toggleSearch();
    } else if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      openSettings();
    } else if (event.key === "Escape" && commandOpen) {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === "Escape" && searchOpen) {
      event.preventDefault();
      void toggleSearch();
    }
  }

  function onSearchInput(): void {
    searchIndex = 0;
    void scrollToMatch();
  }

  function gotoMatch(delta: number): void {
    if (searchMatchIds.length === 0) return;
    searchIndex = (boundedSearchIndex + delta + searchMatchIds.length) % searchMatchIds.length;
    void scrollToMatch();
  }

  async function scrollToMatch(): Promise<void> {
    await tick();
    if (!activeMatchId) return;
    const target = messagesElement?.querySelector(`[data-message-id="${CSS.escape(activeMatchId)}"]`);
    target?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function openWorkspacePane(pane: Exclude<ChatWorkspacePaneName, "chat">): void {
    const next = openWorkspacePaneState(pane);
    workspacePane = next.workspacePane;
    projectPaneActive = next.projectPaneActive;
    searchOpen = next.searchOpen;
    filePanelOpen = next.filePanelOpen;
    if (!connectionReady && !loading && serviceState === "ready" && serviceEndpoint) {
      void connect(serviceEndpoint);
    }
    if (pane === "automations") automationUnreadScheduler?.wake("manual");
  }

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatSessionTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
    if (date.getTime() >= startOfToday) return time;
    if (date.getTime() >= startOfYesterday) return `${copy.groupYesterday} ${time}`;
    const sameYear = date.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(undefined, sameYear
      ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  // Sidebar list timestamps: show the clock only for today; anything older
  // collapses to a bare date (no hour/minute) to keep the compact rows tidy.
  function formatListTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    if (date.getTime() >= startOfToday) {
      return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    if (date.getTime() >= startOfYesterday) return copy.groupYesterday;
    const sameYear = date.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(undefined, sameYear
      ? { month: "numeric", day: "numeric" }
      : { year: "numeric", month: "numeric", day: "numeric" }).format(date);
  }

  function startReconnectPoll(): void {
    reconnectScheduler?.dispose();
    reconnectScheduler = new ActivityScheduler(
      reconnectActivityPolicy,
      async () => { await chatStore.reconnect(); },
      documentActivityVisibility
    );
    reconnectScheduler.start();
  }

  function stopReconnectPoll(): void {
    reconnectScheduler?.dispose();
    reconnectScheduler = null;
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
  let mediaRecorder: MediaRecorder | null = null;
  let recordingChunks: Blob[] = [];
  let recordingStream: MediaStream | null = null;

  function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
    nativeCommandUnlisten?.();
    nativeCommandUnlisten = null;
    connectionGeneration += 1;
    stopSidebarResize();
    stopReconnectPoll();
    stopAutomationUnreadPolling();
    chatStore.disposeAll();
    projectChatStore.disposeAll();
    stopRecordingTimer();
    if (recording && isTauriRuntime()) {
      void invoke("cancel_recording").catch(() => { /* ignore */ });
    }
    teardownRecordingStream();
    for (const url of pendingAudioTracked.values()) URL.revokeObjectURL(url);
    pendingAudioTracked.clear();
    for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
    closePreview();
    settingsChannel.close();
  });
</script>

<svelte:window onkeydown={onChatShortcut} />

<main
  class="chat-layout"
  class:with-files={filePanelOpen && serviceState === "ready" && (projectPaneActive || profiles.length > 0)}
  class:resizing={resizingSidebar}
  style={`--sidebar-w:${sidebarWidth}px`}
>
  <WindowDragMask />
  {#if commandOpen}
    <div class="command-palette-layer" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeCommandPalette(); }}>
      <div class="command-palette" role="dialog" aria-modal="false" aria-label={copy.commandPalette} tabindex="-1" bind:this={commandElement} onkeydown={onCommandKeydown}>
        <header><strong>{copy.commandPalette}</strong><kbd>⌘K</kbd></header>
        <input
          class="command-palette-input"
          bind:this={commandInputElement}
          value={commandQuery}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.commandPalette}
          aria-controls="command-palette-results"
          oninput={onCommandInput}
        />
        <div id="command-palette-results" class="command-palette-results" role="listbox" aria-label={copy.commandPalette}>
          {#if commandResults.length === 0}
            <p class="command-palette-empty">{copy.noMatches}</p>
          {:else}
            {#each commandResults as command, index (command.id)}
              <button
                type="button"
                role="option"
                aria-selected={index === commandIndex}
                class:selected={index === commandIndex}
                disabled={!command.enabled}
                title={command.disabledReason}
                onclick={() => runCommand(command.id)}
              >
                <span>{command.label}</span>
                {#if command.shortcut}<kbd>{command.shortcut}</kbd>{/if}
                {#if !command.enabled && command.disabledReason}<small>{command.disabledReason}</small>{/if}
              </button>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}
  <ChatSidebar
    {copy}
    channels={sidebarChannels}
    {conversationsExpanded}
    {projectsExpanded}
    activeWorkspacePane={workspacePane}
    {automationUnreadCount}
    {expandedChannels}
    {channelItems}
    {channelHasMore}
    {channelLoading}
    activeSessionId={sidebarActiveSessionId}
    {activeProjectSessionId}
    endpoint={connectedEndpoint}
    serviceState={serviceState}
    {statusDots}
    formatTime={formatListTime}
    onNewConversation={newConversation}
    onOpenAutoTasks={() => openWorkspacePane("automations")}
    onOpenSkills={() => openWorkspacePane("skills")}
    onOpenAgents={() => openWorkspacePane("agents")}
    onOpenSettings={() => openSettings()}
    onToggleConversations={toggleConversations}
    onToggleProjects={toggleProjects}
    onToggleChannel={(channel) => toggleChannel(channel as DesktopConversationChannel)}
    onSelectSession={openSession}
    onMoreChannel={(channel) => openBrowser(channel as DesktopConversationChannel)}
    onRenameSession={renameSession}
    onDeleteSession={deleteSession}
    onActivateProjectSession={() => {
      projectPaneActive = true;
      workspacePane = "chat";
      viewMode = "local";
      activeProjectSessionId = projectsStore.selectedSessionId;
    }}
  />

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
    bind:this={sidebarResizer}
    onpointerdown={startSidebarResize}
    onpointermove={onSidebarResize}
    onpointerup={stopSidebarResize}
    onpointercancel={cancelSidebarResize}
    onlostpointercapture={cancelSidebarResize}
    onkeydown={onSidebarKeydown}
  ></div>

  {#if projectPaneActive}
    <ProjectDetail
      {copy}
      onOpenFiles={() => { filePanelOpen = !filePanelOpen; }}
    />
  {:else}
  <section class="chat-content">
    {#if workspacePane !== "chat"}
      <ChatWorkspacePane
        pane={workspacePane}
        {copy}
        serviceEndpoint={connectionReady ? connectedEndpoint : null}
        serviceReady={connectionReady}
        serviceError={error}
        onRetryService={() => serviceEndpoint && void connect(serviceEndpoint)}
        onOpenAgentSettings={() => openSettings("agents")}
        onAutomationUnreadChange={(count) => (automationUnreadCount = count)}
      />
    {:else}
    <header class:searching={searchOpen} class="chat-header" data-tauri-drag-region>
      <div class="chat-title-block" data-tauri-drag-region>
        <div class="chat-header-avatar" data-tauri-drag-region aria-hidden="true">{activeHeaderAvatar}</div>
        <div class="chat-title-text" data-tauri-drag-region>
          <div class="chat-title-name" data-tauri-drag-region>{viewMode === "external" ? activeExternalTitleWithSource : activeSessionTitle}</div>
        </div>
      </div>
      <div class="header-actions">
        {#if serviceState === "ready" && profiles.length > 0}
          <TranscriptSearch
            bind:value={searchQuery}
            open={searchOpen}
            matchCount={searchMatchIds.length}
            activeIndex={boundedSearchIndex}
            placeholder={copy.searchPlaceholder}
            noMatchesLabel={copy.noMatches}
            previousLabel={copy.prevMatch}
            nextLabel={copy.nextMatch}
            closeLabel={copy.closeSearch}
            onInput={onSearchInput}
            onPrevious={() => gotoMatch(-1)}
            onNext={() => gotoMatch(1)}
            onClose={toggleSearch}
          />
          {#if !searchOpen}
            <button
              class="icon-button"
              type="button"
              aria-label={copy.search}
              title={copy.search}
              onclick={toggleSearch}
            >
              <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
            </button>
          {/if}
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
      </div>
    </header>

    {#if serviceState !== "ready"}
      <div class="empty-state" aria-live="polite">
        {#if startupPhase === "checking" || startupPhase === "starting" || startupPhase === "retrying"}
          <div class="service-starting-spinner" aria-hidden="true"><img src="/molibot-icon.png" alt="" /><span></span></div>
        {:else}
          <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
        {/if}
        <h2>{startupPhase === "delayed" ? copy.serviceStarting : startupPhase === "error" ? copy.diagStateError : copy.serviceStarting}</h2>
        <p>{startupError || (serviceEndpoint ? copy.serviceLaunching : copy.serviceChecking)}</p>
        {#if startupPhase === "delayed" || startupPhase === "error"}
          <div class="startup-recovery-actions">
            <button class="secondary-button" type="button" onclick={retryStartup}>{copy.reconnectService}</button>
            <button class="secondary-button" type="button" onclick={openStartupDiagnostics}>{copy.diagnostics}</button>
            <button class="secondary-button" type="button" onclick={openStartupLogs}>{copy.openLogFile}</button>
          </div>
        {/if}
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
    {:else if viewMode === "external"}
      <div class="messages" bind:this={messagesElement} use:stickToBottom={activeSessionId} aria-live="polite">
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
            {#if activeExternalChannel}
              <div class="transcript-divider">
                <i class={`ph-fill ph-${sidebarChannels.find((c) => c.id === activeExternalChannel)?.icon ?? "chat-circle-dots"}`} style={`color:#006bff`} aria-hidden="true"></i>
                <span>{copy.externalSessionDivider.replace("{channel}", activeExternalChannel)}</span>
              </div>
            {/if}
            <ConversationTranscript messages={externalTranscript.messages} {copy} formatTime={formatSessionTime} assistantName={activeHeaderBotName} attachmentActions={transcriptAttachmentActions} messageActions={externalMessageActions} />
          {/if}
      </div>
      {#if externalTranscript}
        <footer class="composer-wrap">
          <p class="external-readonly-notice">
            {copy.externalSessionReadOnly}
          </p>
        </footer>
      {/if}
    {:else}
      <ChatMessagesPane
        bind:messagesElement
        {messages}
        {copy}
        formatTime={formatSessionTime}
        assistantName={activeAgentName}
        stickKey={activeSessionId}
        {sending}
        {streamingText}
        {streamingThinking}
        {activity}
        activities={activityEntries}
        emptyTitle={copy.emptyChatTitle}
        emptyHint={copy.emptyChatHint}
        {searchMatchIds}
        {activeMatchId}
        showReadReceipt={true}
        attachmentActions={transcriptAttachmentActions}
        messageActions={messageActions}
      >
        {#if pendingApproval}
          <ApprovalCard
            title={copy.approvalTitle}
            commandLabel={copy.approvalCommand}
            reasonLabel={copy.approvalReason}
            command={pendingApproval.command}
            reason={pendingApproval.reason}
            options={approvalOptions}
            onResolve={resolveApprovalId}
          />
        {/if}
      </ChatMessagesPane>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        hidden
        onchange={onFilesPicked}
      />
      <ChatInputArea
        bind:value={messageInput}
        bind:thinkingLevel
        endpoint={connectedEndpoint}
        {copy}
        {sending}
        disabled={!modelReady || (!draftMode && !activeSessionId)}
        canSend={Boolean(messageInput.trim() || pendingFiles.length > 0) && (draftMode ? Boolean(draftProfileId) : true)}
        placeholder={sending ? copy.queueHint : copy.enterHint}
        {modelReady}
        {modelOptions}
        {activeModelKey}
        {activeModelLabel}
        activeModelTitle={activeModelFullLabel}
        thinkingLevelLabel={thinkingLabel}
        {changingModel}
        error={error || chatError}
        {recordingError}
        {queuedMessages}
        {pendingFiles}
        {pendingAudioUrls}
        {recording}
        {recordingSeconds}
        showSettingsAction={true}
        fileToolDisabled={(!draftMode && !activeSessionId) || sending || !modelReady}
        recordingToolDisabled={(!draftMode && !activeSessionId) || sending || !modelReady}
        inferAttachmentKind={inferAttachmentKind}
        onSend={sendMessage}
        onStop={stopRun}
        onKeydown={handleComposerKeydown}
        onPasteFiles={addPastedFiles}
        onPickFiles={() => fileInput?.click()}
        onToggleRecording={toggleRecording}
        onFinishRecording={(send) => void finishRecording(send)}
        onRemoveQueued={removeQueued}
        onRemoveFile={removePendingFile}
        onDismissError={() => { error = ""; chatStore.clearActiveError?.(); }}
        onDismissRecordingError={() => (recordingError = "")}
        onOpenSettings={() => openSettings()}
        onChangeModel={changeModel}
      >
        {#if profiles.length > 0 && (draftMode || activeSessionId)}
          <BotMention
            mode={draftMode ? "select" : "locked"}
            bots={botOptions}
            selectedId={draftMode ? draftProfileId : activeProfileId}
            onSelect={(id) => chatStore.setDraftProfileId(id)}
            labels={{ chooseHint: copy.chooseBot, lockedHint: copy.botLocked }}
          />
        {/if}
        {#if editingMessageId}
          <div class="composer-edit-banner" role="status">
            <i class="ph ph-pencil-simple-line" aria-hidden="true"></i>
            <span>{copy.editingMessage}</span>
            <button type="button" aria-label={copy.cancelEdit} title={copy.cancelEdit} onclick={cancelEditMessage}>
              <i class="ph ph-x" aria-hidden="true"></i>{copy.cancelEdit}
            </button>
          </div>
        {/if}
      </ChatInputArea>
    {/if}
    {/if}
  </section>
  {/if}

  {#if filePanelOpen && serviceState === "ready" && projectPaneActive && projectsStore.selectedProjectId}
    <ProjectFilePanel
      endpoint={connectedEndpoint || serviceEndpoint || ""}
      projectId={projectsStore.selectedProjectId}
      sessionId={projectsStore.selectedSessionId}
      {copy}
      onClose={() => (filePanelOpen = false)}
    />
  {:else if filePanelOpen && serviceState === "ready" && profiles.length > 0}
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
                {#if file.local}
                  <button type="button" aria-label={copy.projectCopyPath} title={copy.projectCopyPath} onclick={() => void copyPath(file.local)}>
                    <i class={`ph ph-${copiedPath === file.local ? "check" : "copy"}`} aria-hidden="true"></i>
                  </button>
                {/if}
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

  <ConversationBrowserDialog
    endpoint={connectedEndpoint}
    channel={browserChannel}
    open={browserOpen}
    labels={{ search: copy.searchConversations, searchEmpty: copy.searchEmpty, loading: copy.loading, loadMore: copy.loadMore, empty: copy.noConversations, deletedBot: copy.deletedBot, unknownBot: copy.unknownBot, close: copy.closeConversationBrowser }}
    formatTime={formatListTime}
    onSelect={openSession}
    onClose={() => (browserOpen = false)}
  />

  {#if showOnboarding}
    <div class="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div class="onboarding-card">
        <h2 id="onboarding-title">{onboardingTitle}</h2>
        <p class="onboarding-hint">{onboardingHint}</p>

        {#if onboardingIsGuided}
          <p class="onboarding-step-of">{onboardingStepOfText} · {onboardingStepLabels[onboardingStep]}</p>
          <ol class="onboarding-steps">
            {#each ONBOARDING_STEPS as step, i (step)}
              <li class:active={i === onboardingStepIndex} class:done={i < onboardingStepIndex}>{#if i < onboardingStepIndex}<i class="ph ph-check-circle" aria-hidden="true"></i>{/if}{onboardingStepLabels[step]}</li>
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
          {:else if onboardingStep === "personalization"}
            <p class="onboarding-hint">{copy.onboardingPersonalizationHint}</p>
            <label class="onboarding-field">
              <span>{copy.onboardingUserName}</span>
              <input type="text" bind:value={onboardingUserName} placeholder={copy.onboardingUserNamePlaceholder} />
            </label>
            <label class="onboarding-field">
              <span>{copy.onboardingAiStyle}</span>
              <select bind:value={onboardingAiStyle}>
                <option value="concise">{copy.onboardingAiStyleConcise}</option>
                <option value="patient">{copy.onboardingAiStylePatient}</option>
                <option value="rigorous">{copy.onboardingAiStyleRigorous}</option>
                <option value="natural">{copy.onboardingAiStyleNatural}</option>
              </select>
            </label>
            <button type="button" class="secondary-button" disabled={onboardingPersonalizationSaving || !onboardingAgentId} onclick={saveOnboardingPersonalization}>
              {onboardingPersonalizationSaving ? copy.onboardingProviderSaving : onboardingPersonalizationSaved ? copy.onboardingPersonalizationSaved : copy.onboardingPersonalizationSave}
            </button>
            {#if onboardingPersonalizationSaved}
              <p class="health-check-status">{copy.onboardingPersonalizationSaved}</p>
            {:else if onboardingPersonalizationError}
              <p class="onboarding-error">{onboardingPersonalizationError}</p>
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
            <button type="button" class="primary-button" disabled={(onboardingStep === "provider" && !providerSubmitted) || (onboardingStep === "agent" && !onboardingAgentSaved) || (onboardingStep === "personalization" && !onboardingPersonalizationSaved)} onclick={nextOnboardingStep}>{copy.onboardingNext}</button>
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

{#if memoryTraceId}
  <MemoryTraceDrawer
    trace={memoryTrace}
    loading={memoryTraceLoading}
    error={memoryTraceError}
    copy={copy}
    recordedMemoryIds={memoryTraceFeedback}
    onClose={closeMemoryTrace}
    onRetry={() => void openMemoryTrace(memoryTraceId)}
    onFeedback={(memoryId, value) => void submitMemoryTraceFeedback(memoryId, value)}
    onManageMemory={(memoryId) => { localStorage.setItem("molibot-desktop-memory-focus", memoryId); closeMemoryTrace(); openSettings("memory"); }}
    {onHapticCommit}
  />
{/if}
