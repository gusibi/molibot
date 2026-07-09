<script lang="ts">
  import { onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type {
    DesktopApprovalDecision,
    DesktopModelOption,
    DesktopThinkingLevel
  } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import ApprovalCard from "../chat/ApprovalCard.svelte";
  import ChatInputArea from "../chat/ChatInputArea.svelte";
  import ChatMessagesPane from "../chat/ChatMessagesPane.svelte";
  import { createConversationController } from "../chat/conversationController.svelte";
  import {
    loadDesktopModels,
    summarizeDesktopReadiness,
    switchDesktopModel
  } from "../api";
  import { projectsStore, refreshProjectSessionList, selectProjectSession } from "../stores/projects.svelte";

  export let copy: Translation;
  let message = "";
  let pendingFiles: File[] = [];
  let fileInput: HTMLInputElement;
  let thinkingLevel: DesktopThinkingLevel = "medium";
  let modelOptions: DesktopModelOption[] = [];
  let activeModelKey = "";
  let changingModel = false;

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
  async function loadModelOptions(endpoint: string): Promise<void> {
    try {
      const state = await loadDesktopModels(endpoint);
      modelOptions = state.options;
      activeModelKey = state.currentKey;
    } catch {
      // model selectors simply stay empty; sending is blocked until a model is configured
    }
  }

  async function changeModel(event: Event): Promise<void> {
    if (!projectsStore.endpoint || changingModel) return;
    changingModel = true;
    projectsStore.error = "";
    try {
      const state = await switchDesktopModel(projectsStore.endpoint, (event.currentTarget as HTMLSelectElement).value);
      modelOptions = state.options;
      activeModelKey = state.currentKey;
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      changingModel = false;
    }
  }

  // The project surface shares the main chat's turn engine; it only supplies its
  // own transcript store, composer, and "personal / medium" defaults.
  const chat = createConversationController({
    endpoint: () => projectsStore.endpoint,
    profileId: () => "personal",
    sessionId: () => projectsStore.selectedSessionId,
    projectId: () => projectsStore.selectedProjectId,
    thinkingLevel: () => thinkingLevel,
    canSend: () => Boolean(projectsStore.selectedSessionId) && modelReady,
    labels: () => ({
      working: copy.working,
      uploading: copy.uploading,
      stopped: copy.stopped,
      idle: copy.idle,
      resuming: copy.resuming
    }),
    getMessages: () => projectsStore.messages,
    appendUserMessage: (content, files) => {
      projectsStore.messages = [...projectsStore.messages, {
        id: `pending-${Date.now()}`,
        conversationId: projectsStore.selectedSessionId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        attachments: files.length > 0
          ? files.map((file) => ({
              original: file.name,
              local: "",
              mediaType: inferAttachmentKind(file),
              mimeType: file.type || undefined,
              size: file.size
            }))
          : undefined
      }];
    },
    reload: (sessionId) => selectProjectSession(sessionId),
    refreshSessions: () => refreshProjectSessionList(projectsStore.selectedProjectId),
    clearComposer: () => { message = ""; pendingFiles = []; },
    setError: (msg) => (projectsStore.error = msg),
    clearError: () => (projectsStore.error = "")
  });

  // Legacy `$:` can't track the controller's runes `$state`; subscribe to its
  // `view` store so streaming/turn state stays reactive here.
  const conversationView = chat.view;
  $: sending = $conversationView.sending;
  $: activity = $conversationView.activity;
  $: streamingText = $conversationView.streamingText;
  $: streamingThinking = $conversationView.streamingThinking;
  $: activityEntries = $conversationView.activities;
  $: pendingApproval = $conversationView.pendingApproval;
  $: queuedMessages = $conversationView.queue;

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

  function sendMessage(): void {
    void chat.send({ message, files: pendingFiles });
  }

  function stopRun(): void {
    void chat.stop();
  }

  function queueFollowUp(): void {
    if (chat.enqueue(message)) message = "";
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (sending) queueFollowUp();
      else sendMessage();
    }
  }

  function removeQueued(index: number): void {
    chat.removeQueued(index);
  }

  function approvalOptionLabel(option: { id: string; label: string }): string {
    if (option.id === "approve_once") return copy.approveOnce;
    if (option.id === "approve_session") return copy.approveSession;
    if (option.id === "approve_persistent") return copy.approvePersistent;
    if (option.id === "reject") return copy.reject;
    return option.label;
  }

  function resolveApproval(decision: DesktopApprovalDecision): void {
    void chat.resolveApproval(decision);
  }

  function resolveApprovalId(decision: string): void {
    resolveApproval(decision as DesktopApprovalDecision);
  }

  $: approvalOptions = pendingApproval?.options.map((option) => ({
    id: option.id,
    label: approvalOptionLabel(option)
  })) ?? [];

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
    chat.dispose();
    stopRecordingTimer();
    if (recording && isTauriRuntime()) {
      void invoke("cancel_recording").catch(() => { /* ignore */ });
    }
    teardownRecordingStream();
    for (const url of pendingAudioTracked.values()) URL.revokeObjectURL(url);
    pendingAudioTracked.clear();
  });
</script>

<section class="project-chat">
  <ChatMessagesPane
    messages={projectsStore.messages}
    {copy}
    {formatTime}
    stickKey={projectsStore.selectedSessionId}
    loading={projectsStore.messagesLoading}
    loadingLabel={copy.projectLoadingSession}
    {sending}
    {streamingText}
    {streamingThinking}
    {activity}
    activities={activityEntries}
    emptyTitle={copy.projectEmptyChat}
    emptyHint={copy.projectEmptyChatHint}
  >
    {#if pendingApproval}
      <ApprovalCard
        title={copy.approvalTitle}
        commandLabel={copy.approvalCommand}
        reasonLabel={copy.approvalReason}
        command={pendingApproval.command}
        reason={pendingApproval.reason}
        options={approvalOptions}
        disabled={sending}
        onResolve={resolveApprovalId}
      />
    {/if}
  </ChatMessagesPane>

  <input bind:this={fileInput} type="file" multiple hidden onchange={onFilesPicked} />
  <ChatInputArea
    bind:value={message}
    bind:thinkingLevel
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
    error={projectsStore.error}
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
    onDismissError={() => (projectsStore.error = "")}
    onDismissRecordingError={() => (recordingError = "")}
    onOpenSettings={() => undefined}
    onChangeModel={changeModel}
  />
</section>
