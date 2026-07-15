<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type {
    DesktopApprovalDecision,
    DesktopModelOption,
    DesktopSessionFile,
    DesktopThinkingLevel
  } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import ApprovalCard from "../chat/ApprovalCard.svelte";
  import ChatInputArea from "../chat/ChatInputArea.svelte";
  import ChatMessagesPane from "../chat/ChatMessagesPane.svelte";
  import { projectChatStore } from "./projectChatStore.svelte";
  import {
    fetchDesktopFileBlob,
    listDesktopSessionFiles,
    loadDesktopModels,
    loadDesktopModelRouting,
    summarizeDesktopReadiness,
    truncateDesktopMessages
  } from "../api";
  import type {
    TranscriptAttachmentActions,
    TranscriptMessage,
    TranscriptMessageActions
  } from "../chat/transcript";
  import { projectsStore, refreshProjectSessionList } from "../stores/projects.svelte";

  export let copy: Translation;
  let message = "";
  let pendingFiles: File[] = [];
  let fileInput: HTMLInputElement;
  let thinkingLevel: DesktopThinkingLevel = "medium";

  // Edit-and-resend state (mirrors ChatView): the composer shows an "editing"
  // banner and sendMessage truncates the server transcript at the picked
  // message before re-running the turn.
  let editingMessageId = "";
  let editingSessionId = "";
  let copiedMessageId = "";
  let copiedMessageTimer: ReturnType<typeof setTimeout> | null = null;
  let modelOptions: DesktopModelOption[] = [];
  let activeModelKey = "";
  let globalModelKey = "";
  let globalThinkingLevel: DesktopThinkingLevel = "medium";
  let changingModel = false;
  let appliedSessionId = "";
  const sessionModelOverrides = new Map<string, string>();
  const sessionThinkingOverrides = new Map<string, DesktopThinkingLevel>();

  const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));

  $: modelReady = summarizeDesktopReadiness([], { currentKey: activeModelKey, options: modelOptions }).hasModel;
  $: activeModelFullLabel = modelOptions.find((model) => model.key === activeModelKey)?.label ?? copy.model;
  $: activeModelLabel = (() => {
    const slash = activeModelFullLabel.lastIndexOf("/");
    return (slash >= 0 ? activeModelFullLabel.slice(slash + 1) : activeModelFullLabel).trim();
  })();
  $: thinkingLabel = {
    off: copy.thinkingOff,
    low: copy.thinkingLow,
    medium: copy.thinkingMedium,
    high: copy.thinkingHigh
  }[thinkingLevel];

  // Load model options for the project composer so it matches the chat surface.
  // Re-loads whenever the endpoint changes (e.g. service restart).
  $: if (projectsStore.endpoint) void loadModelOptions(projectsStore.endpoint);
  $: currentProject = projectsStore.projects.find((item) => item.id === projectsStore.selectedProjectId);
  $: projectToolProgress = currentProject?.toolProgress ?? "all";
  $: projectShowReasoning = currentProject?.showReasoning ?? "on";
  // Resolve the composer's model/thinking UI for the newly-selected session
  // (per-session override → project default → global). Gated on loaded models
  // so the selector reflects a valid option; transcript pinning is a separate
  // `$:` below that does NOT wait on models.
  $: if (projectsStore.selectedSessionId && projectsStore.selectedSessionId !== appliedSessionId && modelOptions.length > 0) {
    appliedSessionId = projectsStore.selectedSessionId;
    const requestedModel = sessionModelOverrides.get(appliedSessionId) ?? currentProject?.modelKey ?? globalModelKey;
    activeModelKey = modelOptions.some((option) => option.key === requestedModel) ? requestedModel : globalModelKey;
    thinkingLevel = sessionThinkingOverrides.get(appliedSessionId) ?? currentProject?.thinkingLevel ?? globalThinkingLevel;
  }
  $: if (appliedSessionId && projectsStore.selectedSessionId === appliedSessionId) sessionThinkingOverrides.set(appliedSessionId, thinkingLevel);
  async function loadModelOptions(endpoint: string): Promise<void> {
    try {
      const [state, routing] = await Promise.all([loadDesktopModels(endpoint), loadDesktopModelRouting(endpoint)]);
      modelOptions = state.options;
      activeModelKey = state.currentKey;
      globalModelKey = state.currentKey;
      globalThinkingLevel = routing.defaultThinkingLevel;
    } catch {
      // model selectors simply stay empty; sending is blocked until a model is configured
    }
  }

  async function changeModel(event: Event): Promise<void> {
    if (!projectsStore.endpoint || changingModel) return;
    changingModel = true;
    projectsStore.error = "";
    try {
      activeModelKey = (event.currentTarget as HTMLSelectElement).value;
      if (projectsStore.selectedSessionId) sessionModelOverrides.set(projectsStore.selectedSessionId, activeModelKey);
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      changingModel = false;
    }
  }

  // Per-session resolvers the pinned controllers read at send time. Model /
  // thinking overrides plus project/global defaults live here; the store injects
  // these into each session's runtime so a background turn keeps its own model.
  function resolveSessionModel(sessionId: string): string {
    return sessionModelOverrides.get(sessionId) ?? currentProject?.modelKey ?? globalModelKey;
  }
  function resolveSessionThinking(sessionId: string): DesktopThinkingLevel {
    return sessionThinkingOverrides.get(sessionId) ?? currentProject?.thinkingLevel ?? globalThinkingLevel;
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
      stopped: copy.stopped,
      idle: copy.idle,
      resuming: copy.resuming
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
  $: queuedMessages = chatState.queue;
  $: turnError = chatState.error;

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
    const files = pendingFiles;
    const editingId = editingMessageId;
    const editingSession = editingSessionId;
    if (editingId) {
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

  function startEditUserMessage(msg: TranscriptMessage): void {
    if (!msg.id || !projectsStore.selectedSessionId || sending) return;
    editingMessageId = msg.id;
    editingSessionId = projectsStore.selectedSessionId;
    message = msg.content ?? "";
    pendingFiles = [];
    void tick().then(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".project-chat textarea");
      textarea?.focus();
      if (textarea) {
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      }
    });
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

  function approvalOptionLabel(option: { id: string; label: string }): string {
    if (option.id === "approve_once") return copy.approveOnce;
    if (option.id === "approve_session") return copy.approveSession;
    if (option.id === "approve_persistent") return copy.approvePersistent;
    if (option.id === "reject") return copy.reject;
    return option.label;
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
  $: messageActions = messages.length === 0
    ? null
    : {
        copiedId: copiedMessageId,
        onCopy: (m: TranscriptMessage) => void copyMessageContent(m),
        onEditUser: sending ? undefined : (m: TranscriptMessage) => startEditUserMessage(m),
        editingId: editingMessageId
      } satisfies TranscriptMessageActions;
  $: if (editingMessageId && editingSessionId && projectsStore.selectedSessionId !== editingSessionId) {
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

  $: if (projectsStore.endpoint && projectsStore.selectedSessionId) {
    void refreshProjectSessionFiles(projectsStore.endpoint, projectsStore.selectedSessionId, projectsStore.selectedProjectId);
  }
  // Drop cached blob URLs and pending media state when the active session
  // changes; otherwise the new session's attachments can briefly render the
  // previous session's media (and leak object URLs).
  $: if (projectsStore.selectedSessionId !== messageMediaSession) {
    for (const url of messageMediaUrls.values()) URL.revokeObjectURL(url);
    messageMediaUrls = new Map();
    messageMediaLoading = new Set();
    messageMediaFailed = new Set();
    messageMediaSession = projectsStore.selectedSessionId;
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
    download: (file) => void downloadProjectFile(file)
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
    emptyTitle={copy.projectEmptyChat}
    emptyHint={copy.projectEmptyChatHint}
    messageActions={messageActions}
    attachmentActions={transcriptAttachmentActions}
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

  <input bind:this={fileInput} type="file" multiple hidden onchange={onFilesPicked} />
  <ChatInputArea
    bind:value={message}
    bind:thinkingLevel
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
    onPickFiles={() => fileInput?.click()}
    onToggleRecording={toggleRecording}
    onFinishRecording={(send) => void finishRecording(send)}
    onRemoveQueued={removeQueued}
    onRemoveFile={removePendingFile}
    onDismissError={() => { projectsStore.error = ""; projectChatStore.clearActiveError(); }}
    onDismissRecordingError={() => (recordingError = "")}
    onOpenSettings={() => undefined}
    onChangeModel={changeModel}
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
  <div class="preview-overlay" role="dialog" aria-modal="true" aria-label={previewFile.original}>
    <div class="preview-card">
      <header>
        <strong title={previewFile.original}>{previewFile.original}</strong>
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
    </div>
  </div>
{/if}
