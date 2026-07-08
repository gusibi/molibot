<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type {
    DesktopAgentItem,
    DesktopChannelsSummary,
    DesktopApprovalDecision,
    DesktopConversationChannel,
    DesktopConversationItem,
    DesktopConversationMessage,
    DesktopExternalTranscript,
    DesktopMessageAttachment,
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
    filterDesktopFiles,
    findTranscriptMatches,
    listDesktopConversations,
    listDesktopSessionFiles,
    loadDesktopAgents,
    loadDesktopAgentFiles,
    loadDesktopBootstrap,
    loadDesktopChannels,
    loadDesktopExternalTranscript,
    loadDesktopModels,
    loadDesktopRuntimeEnv,
    loadDesktopSession,
    loadDesktopWebProfiles,
    ONBOARDING_STEPS,
    patchDesktopWebProfile,
    resolveOnboardingAgentSelection,
    resolveOnboardingRepairTarget,
    resolveOnboardingStartStep,
    summarizeDesktopReadiness,
    summarizeOnboardingChannels,
    summarizeOnboardingDiagnostics,
    saveDesktopAgentFiles,
    switchDesktopModel,
    testDesktopProvider,
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
  import type { TranscriptAttachmentActions } from "./lib/chat/transcript";
  import ConversationLiveView from "./lib/chat/ConversationLiveView.svelte";
  import ChatComposerShell from "./lib/chat/ChatComposerShell.svelte";
  import ChatSidebar from "./lib/chat/ChatSidebar.svelte";
  import type { ChannelDescriptor } from "./lib/chat/ChannelAccordion.svelte";
  import ConversationBrowserDialog from "./lib/chat/ConversationBrowserDialog.svelte";
  import BotSelector from "./lib/chat/BotSelector.svelte";
  import { ChatSessionStore } from "./lib/chat/chatSessionStore.svelte";
  import type { ConversationLabels, UiMessage } from "./lib/chat/conversationController.svelte";
  import { stickToBottom } from "./lib/chat/stickToBottom";
  import type { ChatWorkspacePane as ChatWorkspacePaneName } from "./lib/chat/workspace";

  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceState: "disconnected" | "ready" | "incompatible" | "error";
  export let launchAtLogin: boolean;
  export let launchAtLoginBusy: boolean;
  export let setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  export let openSettings: (section?: string) => void;
  export let openProjects: () => void;

  const PROFILE_STORAGE_KEY = "molibot-desktop-profile";
  const LAST_BOT_KEY = "molibot-desktop-last-bot";
  const LAST_CHANNEL_KEY = "molibot-desktop-last-channel";
  const LAST_SESSION_KEY = "molibot-desktop-last-session";
  const FIRST_LAUNCH_SEEN_KEY = "molibot-desktop-first-launch-seen";
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

  // Sidebar navigation: five mutually-exclusive channel accordions (plan §2.2).
  // `expandedChannel` is the one open; `expandedItems` is its cross-Bot recent
  // list (max 10) from `listDesktopConversations`.
  let expandedChannel: DesktopConversationChannel = "web";
  let expandedItems: DesktopConversationItem[] = [];
  let expandedHasMore = false;
  let expandedLoading = false;
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
  let viewMode: "local" | "external" = "local";
  let workspacePane: ChatWorkspacePaneName = "chat";

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
  let messagesElement: HTMLDivElement;
  let sessionFiles: DesktopSessionFile[] = [];
  let fileFilter: DesktopFileFilter = "all";
  let filesLoading = false;
  let filePanelOpen = false;
  let previewFile: DesktopSessionFile | null = null;
  let previewUrl = "";

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
  $: botOptions = profiles.map((profile) => ({ id: profile.id, name: profile.name }));
  $: activeBotName = profiles.find((profile) => profile.id === (draftMode ? draftProfileId : activeProfileId))?.name ?? copy.bot;
  $: activeSessionTitle = expandedItems.find((item) => item.sessionId === activeSessionId)?.title ?? copy.chat;
  $: sidebarActiveSessionId = viewMode === "external" ? activeExternalSessionId : activeSessionId;
  $: sidebarChannels = buildSidebarChannels(profiles, channelSummary);
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
    expandedItems = [];
    expandedHasMore = false;
    expandedChannel = "web";
    activeExternalSessionId = "";
    activeExternalTitle = "";
    activeExternalChannel = "";
    viewMode = "local";
    externalTranscript = null;
    sessionFiles = [];
    chatStore.disposeAll();
    closePreview();
  }

  function buildSidebarChannels(profilesList: DesktopProfileSummary[], summary: DesktopChannelsSummary | null): ChannelDescriptor[] {
    const enabled = (channel: string): number => summary?.groups.find((group) => group.channel === channel)?.enabled ?? 0;
    return [
      { id: "web", icon: "globe", name: copy.channelWeb, configured: profilesList.length > 0 },
      { id: "telegram", icon: "telegram-logo", name: "Telegram", configured: enabled("telegram") > 0 },
      { id: "feishu", icon: "lark-logo", name: copy.channelFeishu, configured: enabled("feishu") > 0 },
      { id: "qq", icon: "qq-logo", name: "QQ", configured: enabled("qq") > 0 },
      { id: "weixin", icon: "wechat-logo", name: copy.channelWeixin, configured: enabled("weixin") > 0 }
    ];
  }

  function conversationLabels(): ConversationLabels {
    return {
      working: copy.working,
      uploading: copy.uploading,
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

  function persistChannel(channel: DesktopConversationChannel): void {
    localStorage.setItem(LAST_CHANNEL_KEY, channel);
  }
  function restoreChannel(): DesktopConversationChannel {
    const saved = localStorage.getItem(LAST_CHANNEL_KEY);
    return saved === "telegram" || saved === "feishu" || saved === "qq" || saved === "weixin" || saved === "web"
      ? saved
      : "web";
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
        refreshSidebar: () => loadExpanded(),
        onSessionCreated: (profileId, sessionId) => {
          localStorage.setItem(LAST_BOT_KEY, profileId);
          void loadExpanded();
          void refreshFiles(profileId, sessionId);
        }
      });

      await selectDefaultSession(generation);
      void chatStore.reconnect();
      startReconnectPoll();
    } catch (cause) {
      if (generation === connectionGeneration) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (generation === connectionGeneration) loading = false;
    }
  }

  async function selectDefaultSession(generation = connectionGeneration): Promise<void> {
    // The sidebar opens the last-expanded channel; the right pane's default is
    // always a Web conversation (plan §2.3), independent of that channel.
    expandedChannel = restoreChannel();
    await loadExpanded();
    if (generation !== connectionGeneration) return;
    let webItems: DesktopConversationItem[] = expandedChannel === "web" ? expandedItems : [];
    if (expandedChannel !== "web") {
      try {
        const webRes = await listDesktopConversations(connectedEndpoint, { channel: "web", limit: 10 });
        webItems = webRes.items;
      } catch {
        webItems = [];
      }
    }
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

  async function loadExpanded(): Promise<void> {
    if (!connectedEndpoint) {
      expandedItems = [];
      expandedHasMore = false;
      return;
    }
    expandedLoading = true;
    try {
      const res = await listDesktopConversations(connectedEndpoint, { channel: expandedChannel, limit: 10 });
      expandedItems = res.items;
      expandedHasMore = Boolean(res.hasMore) || res.items.length >= 10;
    } catch {
      expandedItems = [];
      expandedHasMore = false;
    } finally {
      expandedLoading = false;
    }
  }

  function toggleChannel(channel: DesktopConversationChannel): void {
    workspacePane = "chat";
    if (expandedChannel === channel) return;
    expandedChannel = channel;
    persistChannel(channel);
    void loadExpanded();
  }

  function newConversation(): void {
    if (!connectedEndpoint) return;
    workspacePane = "chat";
    viewMode = "local";
    closeExternalTranscript();
    if (expandedChannel !== "web") {
      expandedChannel = "web";
      persistChannel("web");
      void loadExpanded();
    }
    syncDraftOut();
    chatStore.newConversationDraft(defaultBot());
    loadDraftIn();
  }

  function openSession(item: DesktopConversationItem): void {
    browserOpen = false;
    if (expandedChannel !== item.channel) {
      expandedChannel = item.channel;
      persistChannel(item.channel);
      void loadExpanded();
    }
    if (item.readOnly) {
      void openExternalTranscript(item.sessionId, item.channel, item.title);
      return;
    }
    workspacePane = "chat";
    viewMode = "local";
    closeExternalTranscript();
    syncDraftOut();
    chatStore.selectSession(item.botId, item.sessionId);
    loadDraftIn();
    persistSelected(item.botId, item.sessionId);
    void refreshFiles(item.botId, item.sessionId);
  }

  function stopSessionRow(item: DesktopConversationItem): void {
    void chatStore.stopSession(item.botId, item.sessionId);
  }

  function openBrowser(channel: DesktopConversationChannel): void {
    browserChannel = channel;
    browserOpen = true;
  }

  async function openExternalTranscript(sessionId: string, channel: string, title: string): Promise<void> {
    if (!connectedEndpoint || sessionId === activeExternalSessionId) return;
    workspacePane = "chat";
    viewMode = "external";
    activeExternalSessionId = sessionId;
    activeExternalTitle = title;
    activeExternalChannel = channel;
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
    if (!connectedEndpoint || !activeProfileId || !activeSessionId) return;
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
    if (!connectedEndpoint || !activeProfileId || !activeSessionId) return;
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
  let messageMediaSession = "";
  $: if (activeSessionId !== messageMediaSession) {
    for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
    messageMediaUrls = new Map();
    messageMediaLoading = new Set();
    messageMediaFailed = new Set();
    messageMediaSession = activeSessionId;
  }

  async function loadMessageMedia(file: DesktopSessionFile): Promise<void> {
    if (!connectedEndpoint || !activeProfileId || !activeSessionId) return;
    if (messageMediaUrls.has(file.local) || messageMediaLoading.has(file.local)) return;
    const requestedSessionId = activeSessionId;
    const loading = new Set(messageMediaLoading);
    loading.add(file.local);
    messageMediaLoading = loading;
    const retrying = new Set(messageMediaFailed);
    retrying.delete(file.local);
    messageMediaFailed = retrying;
    try {
      const blob = await fetchDesktopFileBlob(connectedEndpoint, activeProfileId, activeSessionId, file.id);
      const url = URL.createObjectURL(blob);
      if (activeSessionId !== requestedSessionId) {
        URL.revokeObjectURL(url);
        return;
      }
      const next = new Map(messageMediaUrls);
      next.set(file.local, url);
      messageMediaUrls = next;
    } catch (cause) {
      if (activeSessionId !== requestedSessionId) return;
      const failed = new Set(messageMediaFailed);
      failed.add(file.local);
      messageMediaFailed = failed;
    } finally {
      if (activeSessionId === requestedSessionId) {
        const done = new Set(messageMediaLoading);
        done.delete(file.local);
        messageMediaLoading = done;
      }
    }
  }

  async function sendMessage(): Promise<void> {
    const text = messageInput;
    const files = pendingFiles;
    messageInput = "";
    pendingFiles = [];
    await chatStore.send(text, files);
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
    if (chatStore.enqueueFollowUp(messageInput)) messageInput = "";
  }

  function removeQueued(index: number): void {
    chatStore.removeQueued(index);
  }

  function toggleSearch(): void {
    searchOpen = !searchOpen;
    if (!searchOpen) {
      searchQuery = "";
      searchIndex = 0;
    }
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

  async function scrollToMatch(): Promise<void> {
    await tick();
    if (!activeMatchId) return;
    const target = messagesElement?.querySelector(`[data-message-id="${activeMatchId}"]`);
    target?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function openWorkspacePane(pane: Exclude<ChatWorkspacePaneName, "chat">): void {
    workspacePane = pane;
    searchOpen = false;
    filePanelOpen = false;
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

  let reconnectTimer: ReturnType<typeof setInterval> | null = null;
  function startReconnectPoll(): void {
    stopReconnectPoll();
    reconnectTimer = setInterval(() => { void chatStore.reconnect(); }, 4000);
  }
  function stopReconnectPoll(): void {
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
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
    connectionGeneration += 1;
    stopReconnectPoll();
    chatStore.disposeAll();
    stopRecordingTimer();
    if (recording && isTauriRuntime()) {
      void invoke("cancel_recording").catch(() => { /* ignore */ });
    }
    teardownRecordingStream();
    for (const url of pendingAudioTracked.values()) URL.revokeObjectURL(url);
    pendingAudioTracked.clear();
    for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
    closePreview();
  });
</script>

<main
  class="chat-layout"
  class:with-files={filePanelOpen && serviceState === "ready" && profiles.length > 0}
  class:resizing={resizingSidebar}
  style={`--sidebar-w:${sidebarWidth}px`}
>
  <ChatSidebar
    {copy}
    channels={sidebarChannels}
    {expandedChannel}
    expandedItems={expandedItems}
    expandedHasMore={expandedHasMore}
    expandedLoading={expandedLoading}
    activeSessionId={sidebarActiveSessionId}
    {statusDots}
    formatTime={formatSessionTime}
    onNewConversation={newConversation}
    onOpenProjects={openProjects}
    onOpenAutoTasks={() => openWorkspacePane("automations")}
    onOpenSkills={() => openWorkspacePane("skills")}
    onOpenSettings={() => openSettings()}
    onToggleChannel={(channel) => toggleChannel(channel as DesktopConversationChannel)}
    onSelectSession={openSession}
    onStopSession={stopSessionRow}
    onMoreChannel={(channel) => openBrowser(channel as DesktopConversationChannel)}
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
    onmousedown={startSidebarResize}
    onkeydown={onSidebarKeydown}
  ></div>

  <section class="chat-content">
    {#if workspacePane !== "chat"}
      <ChatWorkspacePane pane={workspacePane} {copy} serviceEndpoint={connectedEndpoint || serviceEndpoint} serviceReady={serviceState === "ready"} />
    {:else}
    <header class="chat-header" data-tauri-drag-region>
      <div class="chat-title-block" data-tauri-drag-region>
        <div class="chat-header-avatar" aria-hidden="true">{viewMode === "external" ? (activeExternalTitle?.replace(/^@/, "").charAt(0) || "·") : "M"}</div>
        <div class="chat-title-text" data-tauri-drag-region>
          <div class="chat-title-name">{viewMode === "external" ? (activeExternalTitle || copy.chat) : activeSessionTitle}</div>
          <div class="chat-title-sub">
            {#if viewMode !== "external"}
              <span>{activeBotName}</span>
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
      <div class="messages" bind:this={messagesElement} use:stickToBottom={activeSessionId} aria-live="polite">
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
            {#if activeExternalChannel}
              <div class="transcript-divider">
                <i class={`ph-fill ph-${sidebarChannels.find((c) => c.id === activeExternalChannel)?.icon ?? "chat-circle-dots"}`} style={`color:#006bff`} aria-hidden="true"></i>
                <span>{copy.externalSessionDivider.replace("{channel}", activeExternalChannel)}</span>
              </div>
            {/if}
            <ConversationTranscript messages={externalTranscript.messages} {copy} formatTime={formatSessionTime} />
          {/if}
        {:else}
          <ConversationLiveView
            {messages}
            {copy}
            formatTime={formatSessionTime}
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
          />
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
            <p class="external-readonly-notice">
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
          {#if error || chatError}<div class="composer-error" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><span><strong>{copy.chatErrorTitle}</strong>{error || chatError}</span><button type="button" aria-label={copy.chatErrorDismiss} onclick={() => { error = ""; chatStore.clearActiveError?.(); }}><i class="ph ph-x" aria-hidden="true"></i></button></div>{/if}
          {#if recordingError}<div class="composer-error" role="alert"><i class="ph ph-warning-circle" aria-hidden="true"></i><span><strong>{copy.chatErrorTitle}</strong>{recordingError}</span><button type="button" aria-label={copy.chatErrorDismiss} onclick={() => (recordingError = "")}><i class="ph ph-x" aria-hidden="true"></i></button></div>{/if}
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
          {#if profiles.length > 0 && (draftMode || activeSessionId)}
            <BotSelector
              mode={draftMode ? "select" : "locked"}
              bots={botOptions}
              selectedId={draftMode ? draftProfileId : activeProfileId}
              onSelect={(id) => chatStore.setDraftProfileId(id)}
              labels={{ bot: copy.bot, chooseHint: copy.chooseBot, lockedHint: copy.botLocked }}
            />
          {/if}
          <ChatComposerShell
            bind:value={messageInput}
            {copy}
            {sending}
            disabled={!modelReady || (!draftMode && !activeSessionId)}
            canSend={Boolean(messageInput.trim() || pendingFiles.length > 0) && (draftMode ? Boolean(draftProfileId) : true)}
            placeholder={sending ? copy.queueHint : copy.enterHint}
            onSend={sendMessage}
            onStop={stopRun}
            onKeydown={handleComposerKeydown}
          >
            <input
              bind:this={fileInput}
              type="file"
              multiple
              hidden
              onchange={onFilesPicked}
            />
            {#if recording}
              <div class="recording-bar" role="status" aria-live="polite">
                <span class="recording-indicator" aria-hidden="true"></span>
                <span class="recording-label">{copy.recording}</span>
                <time>{formatDuration(recordingSeconds)}</time>
                <button type="button" class="recording-action" onclick={() => finishRecording(false)}>{copy.cancel}</button>
                <button type="button" class="recording-action primary" onclick={() => finishRecording(true)}>{copy.finishRecording}</button>
              </div>
            {/if}
              <div class="composer-tools" slot="tools">
                <button
                  class="composer-tool"
                  type="button"
                  aria-label={copy.addFiles}
                  title={copy.addFiles}
                  disabled={(!draftMode && !activeSessionId) || sending || !modelReady}
                  onclick={() => fileInput?.click()}
                ><i class="ph ph-paperclip" aria-hidden="true"></i></button>
                <button
                  class="composer-tool"
                  type="button"
                  aria-label={copy.files}
                  title={copy.files}
                  disabled={!draftMode && !activeSessionId}
                  onclick={() => (filePanelOpen = !filePanelOpen)}
                ><i class="ph ph-squares-four" aria-hidden="true"></i></button>
                <button
                  class="composer-tool"
                  class:recording={recording}
                  type="button"
                  aria-label={recording ? copy.finishRecording : copy.startRecording}
                  title={recording ? copy.finishRecording : copy.startRecording}
                  aria-pressed={recording}
                  disabled={(!draftMode && !activeSessionId) || sending || !modelReady}
                  onclick={toggleRecording}
                ><i class="ph ph-microphone" aria-hidden="true"></i></button>
              </div>
              <div class="composer-selectors" slot="selectors">
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
          </ChatComposerShell>
        </footer>
      {/if}
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

  <ConversationBrowserDialog
    endpoint={connectedEndpoint}
    channel={browserChannel}
    open={browserOpen}
    labels={{ search: copy.searchConversations, searchEmpty: copy.searchEmpty, loading: copy.loading, loadMore: copy.loadMore, empty: copy.noConversations, deletedBot: copy.deletedBot, unknownBot: copy.unknownBot }}
    formatTime={formatSessionTime}
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
