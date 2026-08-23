<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    DESKTOP_THINKING_LEVELS,
    clampDesktopThinkingLevel,
    type DesktopThinkingLevel,
    type DesktopApprovalDecision,
    type DesktopApprovalOwner,
    type DesktopModelOption,
    type DesktopSessionFile
  } from "@molibot/desktop-contract";
  import { formatMessageTime } from "../chat/messageTime";
  import type { Translation } from "../i18n";
  import ApprovalCard from "../chat/ApprovalCard.svelte";
  import ChatInputArea from "../chat/ChatInputArea.svelte";
  import ChatMessagesPane from "../chat/ChatMessagesPane.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import { projectChatStore } from "./projectChatStore.svelte";
  import { appendReference, composerInsertion, insertComposerText, miniAppComposerInsertion, requestArtifactPathOpen, requestMiniAppDeepLinkOpen, type MiniAppComposerInsertion } from "./composerBridge";
  import MiniAppActionToast from "../miniapps/MiniAppActionToast.svelte";
  import {
    fetchDesktopFileBlob,
    truncateDesktopMessages,
    listDesktopSessionFiles,
    loadDesktopModels,
    loadDesktopModelRouting,
    loadDesktopSessionModel,
    saveDesktopSessionModel,
    loadDesktopSessionPermission,
    saveDesktopSessionPermission,
    resolveDesktopPlan,
    summarizeDesktopReadiness
  } from "../api";
  import type {
    TranscriptAttachmentActions,
    TranscriptContributionAction,
    TranscriptMessage,
    TranscriptMessageActions
  } from "../chat/transcript";
  import { lastTranscriptModelKey } from "../chat/modelSelection";
  import { projectsStore, projectsView, refreshProjectSessionList, selectProjectSession } from "../stores/projects.svelte";
  import { session, SETTINGS_CHANGED_EVENT } from "../stores/session.svelte";
  import { humanizeModelOption } from "../presentation";
  import { miniAppsCatalog } from "../stores/miniapps.svelte";
  import { catalogMessageActions, invokeTranscriptMessageAction } from "../miniapps/messageActions";

  export let copy: Translation;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  type PermissionMode = "plan" | "manual" | "accept_edits" | "auto";
  const permissionModeOptions: readonly PermissionMode[] = ["plan", "manual", "accept_edits", "auto"];
  let permissionMode: PermissionMode = "accept_edits";
  let permissionHydrationSession = "";
  let message = "";
  // Last file reference consumed from the panel. Guards the reactive block
  // below from re-appending the same reference when it re-runs for other reasons.
  let appliedInsertionId = 0;
  let appliedMiniAppInsertionId = 0;
  let pendingFiles: File[] = [];
  let fileInput: HTMLInputElement;
  let thinkingLevel: DesktopThinkingLevel = "medium";

  // Edit-and-resend state (mirrors ChatView): the composer shows an "editing"
  // banner and sendMessage truncates the server transcript at the picked
  // message before re-running the turn.
  let editingMessageId = "";
  let editingSessionId = "";
  let copiedMessageId = "";
  let miniAppActionPendingKey = "";
  let miniAppActionSuccessKey = "";
  let miniAppActionFeedback = "";
  let miniAppActionCard: import("@molibot/desktop-contract").DesktopMiniAppResultCard | null = null;
  let miniAppActionFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedMessageTimer: ReturnType<typeof setTimeout> | null = null;
  let modelOptions: DesktopModelOption[] = [];
  let activeModelKey = "";
  let globalModelKey = "";
  let globalThinkingLevel: DesktopThinkingLevel = "medium";
  let changingModel = false;
  let appliedSessionId = "";
  let loadedModelEndpoint = "";
  // Per-session model lives on the server (persisted on the conversation record);
  // this Map is a local write-through cache. It only ever holds non-empty
  // overrides — an empty persisted value means "follow the default" and is left
  // absent so `resolveSessionModel` falls through to project/global.
  const sessionModelOverrides = new Map<string, string>();
  // Sessions whose persisted model we've already fetched, so we don't re-hydrate
  // (an empty persisted value is a valid "known: follow default").
  const hydratedModelSessions = new Set<string>();
  let modelHydrationSeq = 0;
  // Bumped when a hydration settles, purely so the transcript-derived `$:` below
  // re-runs: `hydratedModelSessions` is a plain Set and tracks nothing.
  let modelHydrationMark = 0;
  // Sessions with no persisted override whose model we inferred from the last
  // assistant message (see `applyTranscriptModel`). Ranks below an explicit
  // override and above the project/global default.
  const transcriptModelKeys = new Map<string, string>();
  const sessionThinkingOverrides = new Map<string, DesktopThinkingLevel>();

  const formatTime = (value: string) => formatMessageTime(value, copy.groupYesterday);

  $: modelReady = summarizeDesktopReadiness([], { currentKey: activeModelKey, options: modelOptions }).hasModel;
  $: activeModelOption = modelOptions.find((model) => model.key === activeModelKey);
  $: activeModelFullLabel = activeModelOption?.label ?? copy.model;
  $: activeModelLabel = activeModelOption?.alias
    || (humanizeModelOption(activeModelFullLabel, activeModelKey).label.split(" · ").at(-1) ?? copy.model);
  $: thinkingLevelOptions = modelOptions.find((model) => model.key === activeModelKey)?.thinkingLevels ?? DESKTOP_THINKING_LEVELS;
  $: clampedThinkingLevel = clampDesktopThinkingLevel(thinkingLevel, thinkingLevelOptions);
  $: thinkingLabel = {
    off: copy.thinkingOff,
    minimal: copy.thinkingMinimal,
    low: copy.thinkingLow,
    medium: copy.thinkingMedium,
    high: copy.thinkingHigh,
    xhigh: copy.thinkingXHigh,
    max: copy.thinkingMax
  }[clampedThinkingLevel];

  // Every `$:` below must read the projected `$projectsView`, NOT `projectsStore`
  // directly: a legacy reactive statement's body runs untracked, and the only
  // dep the compiler records for an imported runes `$state` is the module
  // binding itself — so `projectsStore.x` reads here would fire once at mount
  // and then go stale forever (see the `projectsView` doc comment). Templates
  // are fine reading `projectsStore` directly.
  const projectsViewStore = projectsView;
  $: view = $projectsViewStore;

  // Load model options for the project composer so it matches the chat surface.
  // Re-loads only when the endpoint actually CHANGES (e.g. service restart):
  // `view` is a fresh object on every projects-store mutation (session list
  // refresh, `messagesLoading`, …), so an ungated call here re-ran on every
  // store tick and each run reset the selector to the global default — the
  // Session's own model was hydrated and then clobbered a tick later.
  $: if (view.endpoint && view.endpoint !== loadedModelEndpoint) {
    loadedModelEndpoint = view.endpoint;
    void loadModelOptions(view.endpoint);
  }

  function handleSettingsChanged(): void {
    if (view.endpoint) void loadModelOptions(view.endpoint);
  }
  if (typeof window !== "undefined") {
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  }
  $: currentProject = view.projects.find((item) => item.id === view.selectedProjectId);
  $: projectToolProgress = currentProject?.toolProgress ?? "all";
  $: projectShowReasoning = currentProject?.showReasoning ?? "on";
  // Resolve the composer's model/thinking UI for the newly-selected session
  // (per-session override → project default → global). Gated on loaded models
  // so the selector reflects a valid option; transcript pinning is a separate
  // `$:` below that does NOT wait on models.
  $: if (view.selectedSessionId && view.selectedSessionId !== appliedSessionId && modelOptions.length > 0) {
    appliedSessionId = view.selectedSessionId;
    const requestedModel = resolveSessionModel(appliedSessionId);
    activeModelKey = modelOptions.some((option) => option.key === requestedModel) ? requestedModel : globalModelKey;
    thinkingLevel = sessionThinkingOverrides.get(appliedSessionId) ?? currentProject?.thinkingLevel ?? globalThinkingLevel;
    void hydrateSessionModel(appliedSessionId);
  }
  $: if (view.endpoint && view.selectedSessionId && view.selectedSessionId !== permissionHydrationSession) {
    permissionHydrationSession = view.selectedSessionId;
    void loadDesktopSessionPermission(view.endpoint, "personal", view.selectedSessionId).then((mode) => {
      if (view.selectedSessionId === permissionHydrationSession) permissionMode = mode;
    }).catch(() => undefined);
  }

  async function changePermissionMode(mode: PermissionMode): Promise<void> {
    if (!projectsStore.endpoint || !projectsStore.selectedSessionId) return;
    permissionMode = mode;
    try {
      permissionMode = await saveDesktopSessionPermission(projectsStore.endpoint, "personal", projectsStore.selectedSessionId, mode);
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  // The composer must never contradict the transcript: with no explicit
  // per-session pick, the Session keeps the model that actually answered last
  // (and follows it as new replies land) instead of jumping to whatever the
  // global default happens to be now. Depends on `modelHydrationMark` so it
  // re-runs once the persisted override — which outranks it — is known.
  $: applyTranscriptModel(appliedSessionId, modelHydrationMark, messages, modelOptions);
  function applyTranscriptModel(
    sessionId: string,
    _hydrationMark: number,
    transcript: TranscriptMessage[],
    options: DesktopModelOption[]
  ): void {
    if (!sessionId || projectsStore.selectedSessionId !== sessionId) return;
    if (!hydratedModelSessions.has(sessionId) || sessionModelOverrides.has(sessionId)) return;
    const key = lastTranscriptModelKey(transcript, options);
    if (!key) return;
    transcriptModelKeys.set(sessionId, key);
    activeModelKey = key;
  }
  $: if (appliedSessionId && view.selectedSessionId === appliedSessionId) sessionThinkingOverrides.set(appliedSessionId, clampedThinkingLevel);
  async function loadModelOptions(endpoint: string): Promise<void> {
    try {
      const [state, routing] = await Promise.all([loadDesktopModels(endpoint), loadDesktopModelRouting(endpoint)]);
      modelOptions = state.options;
      globalModelKey = state.currentKey;
      globalThinkingLevel = routing.defaultThinkingLevel;
      // Keep the Session's own model: reloading the option list (service
      // restart, provider edit) must not silently re-point the composer at the
      // global default.
      const sessionId = projectsStore.selectedSessionId;
      const resolved = sessionId ? resolveSessionModel(sessionId) : "";
      activeModelKey = resolved && state.options.some((option) => option.key === resolved)
        ? resolved
        : state.currentKey;
    } catch {
      // model selectors simply stay empty; sending is blocked until a model is configured
    }
  }

  // Fetch a session's persisted model once and hydrate the composer + cache.
  // Guarded against stale responses (pitfall #3): a late reply for a session the
  // user already navigated away from must not overwrite the visible selector.
  async function hydrateSessionModel(sessionId: string): Promise<void> {
    if (!projectsStore.endpoint || !sessionId) return;
    if (sessionModelOverrides.has(sessionId) || hydratedModelSessions.has(sessionId)) return;
    const seq = ++modelHydrationSeq;
    try {
      const key = await loadDesktopSessionModel(projectsStore.endpoint, sessionId);
      if (seq !== modelHydrationSeq || projectsStore.selectedSessionId !== sessionId) return;
      hydratedModelSessions.add(sessionId);
      if (key && modelOptions.some((option) => option.key === key)) {
        sessionModelOverrides.set(sessionId, key);
        activeModelKey = key;
      }
      // No persisted pick: fall through to the transcript's last model.
      modelHydrationMark += 1;
    } catch {
      // network hiccup: leave the composer on its default; a later switch retries
    }
  }

  async function changeModel(value: string): Promise<void> {
    if (!projectsStore.endpoint || changingModel) return;
    const sessionId = projectsStore.selectedSessionId;
    changingModel = true;
    projectsStore.error = "";
    try {
      if (sessionId) {
        await saveDesktopSessionModel(projectsStore.endpoint, sessionId, value);
        sessionModelOverrides.set(sessionId, value);
        // An explicit pick outranks the transcript-derived model until the user
        // picks again, so the selector can't snap back on the next reply.
        transcriptModelKeys.delete(sessionId);
        hydratedModelSessions.add(sessionId);
        if (projectsStore.selectedSessionId === sessionId) activeModelKey = value;
      }
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
      if (projectsStore.selectedSessionId === sessionId) activeModelKey = resolveSessionModel(sessionId);
    } finally {
      changingModel = false;
    }
  }

  function changeThinking(value: DesktopThinkingLevel): void {
    thinkingLevel = clampDesktopThinkingLevel(
      value,
      thinkingLevelOptions
    );
    const sessionId = projectsStore.selectedSessionId;
    if (sessionId) sessionThinkingOverrides.set(sessionId, thinkingLevel);
  }

  // Per-session resolvers the pinned controllers read at send time. Model /
  // thinking overrides plus project/global defaults live here; the store injects
  // these into each session's runtime so a background turn keeps its own model.
  function resolveSessionModel(sessionId: string): string {
    return (
      sessionModelOverrides.get(sessionId) ??
      transcriptModelKeys.get(sessionId) ??
      currentProject?.modelKey ??
      globalModelKey
    );
  }
  function resolveSessionThinking(sessionId: string): DesktopThinkingLevel {
    const requested = sessionThinkingOverrides.get(sessionId) ?? currentProject?.thinkingLevel ?? globalThinkingLevel;
    const modelKey = resolveSessionModel(sessionId);
    const levels = modelOptions.find((model) => model.key === modelKey)?.thinkingLevels ?? DESKTOP_THINKING_LEVELS;
    return clampDesktopThinkingLevel(requested, levels);
  }

  // The project surface shares the main chat's per-session runtime registry
  // (a module singleton), so every project session gets its OWN pinned
  // controller: background turns keep streaming while the user views another
  // session, and stop/approval/queue always target the turn's own session.
  // init is re-callable on each mount; it only refreshes these host closures.
  projectChatStore.init({
    endpoint: () => projectsStore.endpoint,
    modelReady: () => modelReady,
    labels: () => ({
      working: copy.working,
      uploading: copy.uploading,
      recognizingImage: copy.recognizingImage,
      stopped: copy.stopped,
      idle: copy.idle,
      resuming: copy.resuming,
      approvalFailed: copy.approvalFailed,
      approvalNotFound: copy.approvalNotFound,
      transcriptLoadFailed: copy.transcriptLoadFailed
    }),
    refreshSessions: () => refreshProjectSessionList(projectsStore.selectedProjectId),
    resolveModel: resolveSessionModel,
    resolveThinking: resolveSessionThinking
  });
  if (projectsStore.selectedSessionId && projectsStore.endpoint) {
    const cachedMessages = projectChatStore.registry.get("personal", projectsStore.selectedSessionId)?.messages;
    projectChatStore.selectSession(
      projectsStore.selectedSessionId,
      projectsStore.selectedProjectId,
      cachedMessages ?? projectsStore.messages as Parameters<typeof projectChatStore.selectSession>[2]
    );
  }

  // Legacy `$:` can't track the store's runes `$state`; subscribe to its single
  // `state` store so the active session's transcript + streaming stay reactive.
  // The active entry IS the viewed session (pinned controllers), so no per-turn
  // session gating is needed — its live state is exactly this session's.
  const chatStateStore = projectChatStore.state;
  $: chatState = $chatStateStore;
  $: sending = chatState.sending;
  $: messages = chatState.messages;
  $: activity = chatState.activity;
  $: streamingText = chatState.streamingText;
  $: streamingThinking = chatState.streamingThinking;
  $: activityEntries = chatState.activities;
  $: pendingApproval = chatState.pendingApproval;
  $: pendingApprovals = chatState.pendingApprovals;
  $: liveSteps = chatState.liveSteps;
  /** Node the transcript dock watches; Svelte clears it when the card unmounts. */
  let approvalElement: HTMLElement | null = null;
  $: queuedMessages = chatState.queue;
  $: turnError = chatState.error;

  // File references requested from the Project file panel. The panel is a
  // sibling under ChatView, so it reaches the composer through this store.
  $: applyComposerInsertion($composerInsertion);
  function applyComposerInsertion(request: { id: number; reference: string } | null): void {
    if (!request || request.id === appliedInsertionId) return;
    appliedInsertionId = request.id;
    message = appendReference(message, request.reference);
  }

  $: applyMiniAppComposerInsertion($miniAppComposerInsertion);
  function applyMiniAppComposerInsertion(request: MiniAppComposerInsertion | null): void {
    if (!request || request.scope !== "project" || request.id === appliedMiniAppInsertionId) return;
    appliedMiniAppInsertionId = request.id;
    if (editingMessageId) {
      miniAppActionFeedback = copy.miniAppComposerEditing;
      return;
    }
    message = insertComposerText(message, request.text, request.mode);
    miniAppActionFeedback = copy.miniAppComposerInserted;
    focusComposerAtEnd();
  }

  function inferAttachmentKind(file: File): "image" | "audio" | "video" | "file" {
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

  async function sendMessage(): Promise<void> {
    const text = message;
    thinkingLevel = clampedThinkingLevel;
    if (projectsStore.selectedSessionId) sessionThinkingOverrides.set(projectsStore.selectedSessionId, thinkingLevel);
    const files = pendingFiles;
    const editingId = editingMessageId;
    const editingSession = editingSessionId;
    if (editingId) {
      // Edit-and-resend rewrites this Session in place: drop the original
      // message and everything after it before the edited turn re-runs.
      // Branching without rewriting is a separate action - see
      // `forkFromUserMessage`.
      if (!projectsStore.endpoint || !projectsStore.selectedSessionId) {
        projectsStore.error = copy.editMessageUnavailable;
        return;
      }
      message = "";
      pendingFiles = [];
      editingMessageId = "";
      editingSessionId = "";
      try {
        await truncateDesktopMessages(
          projectsStore.endpoint,
          "personal",
          projectsStore.selectedSessionId,
          editingId
        );
      } catch (cause) {
        const status = (cause as Error & { status?: number }).status;
        if (status === 422) {
          await projectChatStore.reloadActive();
          projectsStore.error = copy.editMessageStale;
        } else {
          projectsStore.error = cause instanceof Error ? cause.message : String(cause);
        }
        message = text;
        pendingFiles = files;
        editingMessageId = editingId;
        editingSessionId = editingSession;
        return;
      }
    } else {
      message = "";
      pendingFiles = [];
    }
    void projectChatStore.send(projectsStore.selectedSessionId, text, files);
  }

  async function copyMessageContent(msg: TranscriptMessage): Promise<void> {
    if (!msg.content) return;
    try {
      await navigator.clipboard.writeText(msg.content);
      copiedMessageId = msg.id ?? "";
      if (copiedMessageTimer) clearTimeout(copiedMessageTimer);
      copiedMessageTimer = setTimeout(() => {
        copiedMessageId = "";
        copiedMessageTimer = null;
      }, 1500);
    } catch { /* clipboard unavailable */ }
  }

  function focusComposerAtEnd(): void {
    void tick().then(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".project-chat textarea");
      textarea?.focus();
      if (textarea) {
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      }
    });
  }

  function startEditUserMessage(msg: TranscriptMessage): void {
    if (!msg.id || !projectsStore.selectedSessionId || sending) return;
    editingMessageId = msg.id;
    editingSessionId = projectsStore.selectedSessionId;
    message = msg.content ?? "";
    pendingFiles = [];
    focusComposerAtEnd();
  }

  function cancelEditMessage(): void {
    editingMessageId = "";
    editingSessionId = "";
  }

  function stopRun(): void {
    void projectChatStore.stopActive();
  }

  function queueFollowUp(): void {
    if (projectChatStore.enqueueFollowUp(message)) message = "";
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && (event.shiftKey || event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      // `sending` reflects the VIEWED session's pinned controller, so enqueuing
      // a follow-up while it runs always targets the right session; a background
      // turn on another session never leaks into this composer.
      if (sending) queueFollowUp();
      else sendMessage();
    }
  }

  function removeQueued(index: number): void {
    projectChatStore.removeQueued(index);
  }

  /** Injects a queued message into the running turn instead of waiting for it. */
  async function steerQueued(index: number): Promise<void> {
    const delivered = await projectChatStore.steerQueued(index);
    if (!delivered) projectsStore.error = copy.steerQueuedFailed;
  }

  function approvalOptionLabel(option: { id: string; label: string }): string {
    if (option.id === "approve_once") return copy.approveOnce;
    if (option.id === "approve_session") return copy.approveSession;
    // "一直允许" covers every session of one bot or one project — say which,
    // otherwise it reads as an install-wide grant, which it is not.
    if (option.id === "approve_persistent") return persistentApprovalLabel(pendingApproval?.owner);
    if (option.id === "reject") return copy.reject;
    return option.label;
  }

  function persistentApprovalLabel(owner: DesktopApprovalOwner | undefined): string {
    if (owner?.kind === "project") return copy.approvePersistentProject;
    if (owner?.kind === "bot") return copy.approvePersistentBot;
    return copy.approvePersistent;
  }

  function resolveApproval(decision: DesktopApprovalDecision): void {
    void projectChatStore.resolveApproval(decision);
  }

  function resolveApprovalId(decision: string): void {
    resolveApproval(decision as DesktopApprovalDecision);
  }

  $: approvalOptions = pendingApproval?.options.map((option) => ({
    id: option.id,
    label: approvalOptionLabel(option)
  })) ?? [];
  $: contributedMessageActions = catalogMessageActions($miniAppsCatalog, session.locale);

  /** Clears the action toast and whatever timer was going to. */
  function dismissMiniAppFeedback() {
    if (miniAppActionFeedbackTimer) clearTimeout(miniAppActionFeedbackTimer);
    miniAppActionFeedbackTimer = null;
    miniAppActionFeedback = "";
    miniAppActionCard = null;
    miniAppActionSuccessKey = "";
  }

  async function runMiniAppMessageAction(
    action: TranscriptContributionAction,
    transcriptMessage: TranscriptMessage,
    selection?: string,
    file?: DesktopSessionFile
  ): Promise<void> {
    if (!projectsStore.endpoint) return;
    const key = `${transcriptMessage.id ?? transcriptMessage.content}:${action.id}`;
    miniAppActionPendingKey = key;
    miniAppActionSuccessKey = "";
    try {
      const outcome = await invokeTranscriptMessageAction(
        projectsStore.endpoint,
        action,
        transcriptMessage,
        {
          selection,
          sessionTitle: projectsStore.sessions.find((item) => item.conversationId === projectsStore.selectedSessionId)?.title,
          ...(file ? {
            resource: {
              profileId: "personal",
              sessionId: projectsStore.selectedSessionId,
              projectId: projectsStore.selectedProjectId,
              fileId: file.id
            }
          } : {})
        }
      );
      miniAppActionFeedback = outcome.text;
      miniAppActionCard = outcome.card;
      miniAppActionSuccessKey = key;
    } catch (cause) {
      miniAppActionFeedback = cause instanceof Error ? cause.message : String(cause);
      miniAppActionCard = null;
    } finally {
      miniAppActionPendingKey = "";
      if (miniAppActionFeedbackTimer) clearTimeout(miniAppActionFeedbackTimer);
      miniAppActionFeedbackTimer = null;
      // A card is something to read, so it stays until dismissed; a bare
      // sentence self-clears. Both always offer the close button.
      if (!miniAppActionCard) {
        miniAppActionFeedbackTimer = setTimeout(() => {
          dismissMiniAppFeedback();
        }, 3000);
      }
    }
  }
  $: messageActions = messages.length === 0
    ? null
    : {
        copiedId: copiedMessageId,
        onCopy: (m: TranscriptMessage) => void copyMessageContent(m),
        onEditUser: sending ? undefined : (m: TranscriptMessage) => startEditUserMessage(m),
        editingId: editingMessageId,
        contributions: contributedMessageActions,
        pendingContributionKey: miniAppActionPendingKey,
        successfulContributionKey: miniAppActionSuccessKey,
        onRunContribution: (action, transcriptMessage, selection) => void runMiniAppMessageAction(action, transcriptMessage, selection),
        onResolvePlan: (transcriptMessage, plan, decision, edits) => void resolvePlan(transcriptMessage, plan, decision, edits)
      } satisfies TranscriptMessageActions;

  async function resolvePlan(
    _message: TranscriptMessage,
    plan: import("@molibot/desktop-contract").DesktopConversationPlan,
    decision: "accept" | "reject" | "modify",
    edits?: { title: string; summary: string; steps: string[]; mode?: "manual" | "accept_edits" }
  ): Promise<void> {
    if (!projectsStore.endpoint || !projectsStore.selectedSessionId) return;
    try {
      await resolveDesktopPlan(projectsStore.endpoint, {
        profileId: "personal",
        conversationId: projectsStore.selectedSessionId,
        planId: plan.id,
        decision,
        ...edits
      });
      await projectChatStore.reloadActive();
      if (decision === "accept") await projectChatStore.resumeActivePlan(plan.id);
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  $: if (editingMessageId && editingSessionId && view.selectedSessionId !== editingSessionId) {
    editingMessageId = "";
    editingSessionId = "";
  }

  // --- Attachment previews (mirrors ChatView so project chat images,
  // audio, and video render inline instead of just showing the filename) ---
  let sessionFiles: DesktopSessionFile[] = [];
  $: fileByLocal = new Map(sessionFiles.map((file) => [file.local, file]));
  let messageMediaUrls = new Map<string, string>();
  let messageMediaLoading = new Set<string>();
  let messageMediaFailed = new Set<string>();
  let messageMediaSession = "";
  let previewFile: DesktopSessionFile | null = null;
  let previewUrl = "";

  $: if (view.endpoint && view.selectedSessionId) {
    void refreshProjectSessionFiles(view.endpoint, view.selectedSessionId, view.selectedProjectId);
  }
  // Drop cached blob URLs and pending media state when the active session
  // changes; otherwise the new session's attachments can briefly render the
  // previous session's media (and leak object URLs).
  $: if (view.selectedSessionId !== messageMediaSession) {
    for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
    messageMediaUrls = new Map();
    messageMediaLoading = new Set();
    messageMediaFailed = new Set();
    messageMediaSession = view.selectedSessionId;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    previewFile = null;
  }
  $: transcriptAttachmentActions = {
    filesByLocal: fileByLocal,
    mediaUrls: messageMediaUrls,
    mediaLoading: messageMediaLoading,
    mediaFailed: messageMediaFailed,
    loadMedia: (file) => void loadProjectMessageMedia(file),
    canPreview: canPreviewProjectFile,
    preview: (file) => void openProjectPreview(file),
    download: (file) => void downloadProjectFile(file),
    contributions: contributedMessageActions,
    onRunContribution: (action, transcriptMessage, file) => void runMiniAppMessageAction(action, transcriptMessage, undefined, file)
  } satisfies TranscriptAttachmentActions;

  async function refreshProjectSessionFiles(endpoint: string, sessionId: string, projectId: string | undefined): Promise<void> {
    try {
      sessionFiles = await listDesktopSessionFiles(endpoint, "personal", sessionId, projectId);
    } catch {
      sessionFiles = [];
    }
  }

  function canPreviewProjectFile(file: DesktopSessionFile): boolean {
    return file.mediaType === "image" || file.mediaType === "audio" || file.mediaType === "video";
  }

  async function loadProjectMessageMedia(file: DesktopSessionFile): Promise<void> {
    if (!projectsStore.endpoint || !projectsStore.selectedSessionId) return;
    if (messageMediaUrls.has(file.local) || messageMediaLoading.has(file.local)) return;
    const requestedSessionId = projectsStore.selectedSessionId;
    const loading = new Set(messageMediaLoading);
    loading.add(file.local);
    messageMediaLoading = loading;
    const retrying = new Set(messageMediaFailed);
    retrying.delete(file.local);
    messageMediaFailed = retrying;
    try {
      const blob = await fetchDesktopFileBlob(
        projectsStore.endpoint,
        "personal",
        requestedSessionId,
        file.id,
        false,
        projectsStore.selectedProjectId
      );
      const url = URL.createObjectURL(blob);
      if (projectsStore.selectedSessionId !== requestedSessionId) {
        URL.revokeObjectURL(url);
        return;
      }
      const next = new Map(messageMediaUrls);
      next.set(file.local, url);
      messageMediaUrls = next;
    } catch {
      if (projectsStore.selectedSessionId !== requestedSessionId) return;
      const failed = new Set(messageMediaFailed);
      failed.add(file.local);
      messageMediaFailed = failed;
    } finally {
      if (projectsStore.selectedSessionId === requestedSessionId) {
        const done = new Set(messageMediaLoading);
        done.delete(file.local);
        messageMediaLoading = done;
      }
    }
  }

  async function openProjectPreview(file: DesktopSessionFile): Promise<void> {
    if (!projectsStore.endpoint || !projectsStore.selectedSessionId) return;
    try {
      const blob = await fetchDesktopFileBlob(
        projectsStore.endpoint,
        "personal",
        projectsStore.selectedSessionId,
        file.id,
        false,
        projectsStore.selectedProjectId
      );
      closeProjectPreview();
      previewFile = file;
      previewUrl = URL.createObjectURL(blob);
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function closeProjectPreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    previewFile = null;
  }

  async function downloadProjectFile(file: DesktopSessionFile): Promise<void> {
    if (!projectsStore.endpoint || !projectsStore.selectedSessionId) return;
    try {
      const blob = await fetchDesktopFileBlob(
        projectsStore.endpoint,
        "personal",
        projectsStore.selectedSessionId,
        file.id,
        true,
        projectsStore.selectedProjectId
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.original;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  // --- Voice recording (mirrors ChatView so project chat has parity) ---
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
    if (!projectsStore.selectedSessionId || !modelReady) return;
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
    if (typeof window !== "undefined") {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    }
    // The project runtime store is a module singleton: do NOT dispose it here,
    // or a background project turn would be aborted on pane/project switch. It
    // is torn down only by the host (ChatView) on disconnect / teardown.
    stopRecordingTimer();
    if (recording && isTauriRuntime()) {
      void invoke("cancel_recording").catch(() => { /* ignore */ });
    }
    teardownRecordingStream();
    for (const url of pendingAudioTracked.values()) URL.revokeObjectURL(url);
    pendingAudioTracked.clear();
    for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
</script>

<section class="project-chat">
  <ChatMessagesPane
    messages={projectToolProgress === "off"
      ? messages.map((item) => ({ ...item, activities: [] }))
      : messages}
    {copy}
    {formatTime}
    stickKey={projectsStore.selectedSessionId}
    loading={projectsStore.messagesLoading && messages.length === 0}
    loadingLabel={copy.projectLoadingSession}
    {sending}
    {streamingText}
    streamingThinking={projectShowReasoning === "off" ? "" : streamingThinking}
    {activity}
    activities={projectToolProgress === "off" ? [] : activityEntries}
    liveSteps={projectToolProgress === "off" ? liveSteps.filter((step) => step.kind !== "activity") : liveSteps}
    emptyTitle={copy.projectEmptyChat}
    emptyHint={copy.projectEmptyChatHint}
    messageActions={messageActions}
    attachmentActions={transcriptAttachmentActions}
    onOpenActivityPath={requestArtifactPathOpen}
    {searchMatchIds}
    {activeMatchId}
    attentionElement={approvalElement}
    attentionLabel={copy.pendingApprovalNotice}
    attentionAction={copy.pendingApprovalJump}
  >
    {#if pendingApproval}
      <!-- Wrapped so the pane can watch the card without knowing what it is;
           see the same seam in ChatView. -->
      <div bind:this={approvalElement}>
        <ApprovalCard
          cardId={pendingApproval.requestId}
          title={copy.approvalTitle}
          subtitle={[pendingApproval.displayName ?? "", pendingApprovals.length > 1 ? copy.approvalQueuePosition.replace("{index}", "1").replace("{total}", String(pendingApprovals.length)) : ""].filter(Boolean).join(" · ")}
          reasonLabel={copy.approvalReason}
          command={pendingApproval.command}
          reason={pendingApproval.reason}
          payload={pendingApproval.payload}
          options={approvalOptions}
          defaultOptionId="approve_once"
          waitingLabel={copy.approvalWaiting}
          secondsLabel={copy.approvalWaitingSeconds}
          minutesLabel={copy.approvalWaitingMinutes}
          moreLinesLabel={copy.approvalMoreDiffLines}
          onResolve={resolveApprovalId}
        />
      </div>
    {/if}
  </ChatMessagesPane>

  <input bind:this={fileInput} type="file" multiple hidden onchange={onFilesPicked} />
  {#if miniAppActionFeedback}
    <MiniAppActionToast
      text={miniAppActionFeedback}
      card={miniAppActionCard}
      dismissLabel={copy.miniAppToastDismiss}
      openLabel={copy.miniAppCardOpen}
      onOpenLink={requestMiniAppDeepLinkOpen}
      onDismiss={dismissMiniAppFeedback}
    />
  {/if}
  <ChatInputArea
    bind:value={message}
    thinkingLevel={clampedThinkingLevel}
    {thinkingLevelOptions}
    endpoint={projectsStore.endpoint}
    projectId={projectsStore.selectedProjectId}
    {copy}
    {sending}
    disabled={!projectsStore.selectedSessionId || !modelReady}
    canSend={Boolean(message.trim()) || pendingFiles.length > 0}
    placeholder={sending ? copy.queueHint : copy.projectComposerPlaceholder}
    {modelReady}
    {modelOptions}
    {activeModelKey}
    {activeModelLabel}
    activeModelTitle={activeModelFullLabel}
    thinkingLevelLabel={thinkingLabel}
    {changingModel}
    error={turnError || projectsStore.error}
    {recordingError}
    {queuedMessages}
    {pendingFiles}
    {pendingAudioUrls}
    {recording}
    {recordingSeconds}
    fileToolDisabled={!projectsStore.selectedSessionId || sending || !modelReady}
    recordingToolDisabled={!projectsStore.selectedSessionId || sending || !modelReady}
    inferAttachmentKind={inferAttachmentKind}
    onSend={sendMessage}
    onStop={stopRun}
    onKeydown={handleComposerKeydown}
    onPasteFiles={addPastedFiles}
    onPickFiles={() => fileInput?.click()}
    onToggleRecording={toggleRecording}
    onFinishRecording={(send) => void finishRecording(send)}
    onRemoveQueued={removeQueued}
    onSteerQueued={(index) => void steerQueued(index)}
    onRemoveFile={removePendingFile}
    onDismissError={() => { projectsStore.error = ""; projectChatStore.clearActiveError(); }}
    onDismissRecordingError={() => (recordingError = "")}
    onOpenSettings={() => undefined}
    onChangeModel={changeModel}
    onChangeThinking={changeThinking}
    {permissionMode}
    {permissionModeOptions}
    onChangePermissionMode={changePermissionMode}
  >
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
</section>

{#if previewFile && previewUrl}
  <Dialog open={true} contentClass="preview-card" labelledBy="project-preview-title" onOpenChange={(next) => { if (!next) closeProjectPreview(); }}>
    <header>
      <strong id="project-preview-title" title={previewFile.original}>{previewFile.original}</strong>
      <button type="button" onclick={closeProjectPreview}>{copy.closePreview}</button>
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
  </Dialog>
{/if}
