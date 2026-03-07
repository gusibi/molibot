<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";

  interface RuntimeSettings {
    providerMode: "pi" | "custom";
    piModelProvider: string;
    piModelName: string;
    defaultCustomProviderId: string;
    customProviders: Array<{
      id: string;
      name: string;
      enabled: boolean;
      models: Array<{ id: string; tags: string[] }>;
      defaultModel: string;
    }>;
    channels?: {
      web?: {
        instances?: Array<{
          id: string;
          name?: string;
          enabled?: boolean;
        }>;
      };
    };
  }

  interface SessionSummary {
    id: string;
    title: string;
    updatedAt: string;
  }

  interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }

  interface PromptSources {
    global: string[];
    agent: string[];
    bot: string[];
  }

  const QUICK_PROMPTS = [
    "帮我总结今天要做的 3 件事",
    "把这个项目当前状态给我一版执行清单",
    "检查我现在模型和路由配置有没有明显风险"
  ];

  const LS_USER = "molibot-web-user-id";
  const LS_USERS = "molibot-web-user-options";
  const LS_PROFILE = "molibot-web-profile-id";

  let userId = "web-anonymous";
  let userOptions: string[] = [];
  let activeProfileId = "default";
  let activeProfileName = "Default Web";
  let profileNameById: Record<string, string> = {};

  let sessions: SessionSummary[] = [];
  let activeSessionId = "";
  let editingSessionId = "";
  let editingSessionTitle = "";
  let messages: ChatMessage[] = [];
  let messageInput = "";
  let status = "Loading...";
  let sending = false;
  let loadingMessages = false;
  let showMobileSidebar = false;
  let sessionSearch = "";

  let runtimeSettings: RuntimeSettings | null = null;
  let modelOptions: Array<{ key: string; label: string }> = [];
  let activeModelKey = "";
  let changingModel = false;

  let pendingFiles: File[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  let recordingStream: MediaStream | null = null;
  let recordingChunks: Blob[] = [];
  let isRecording = false;
  let recordingSeconds = 0;
  let recordingTimer: ReturnType<typeof setInterval> | null = null;
  let preparingRecording = false;

  let showPromptPreview = false;
  let loadingPromptPreview = false;
  let promptPreviewText = "";
  let promptSources: PromptSources = { global: [], agent: [], bot: [] };

  let showNewChatDialog = false;
  let newChatUserId = "";

  let messagesContainer: HTMLDivElement | null = null;
  let composerEl: HTMLTextAreaElement | null = null;

  $: filteredSessions = sessions.filter((s) => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return true;
    return s.title.toLowerCase().includes(q);
  });

  function sanitizeUserId(value: string): string {
    const normalized = String(value ?? "").trim();
    return normalized || "web-anonymous";
  }

  function readJsonFromStorage<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  function persistIdentity(): void {
    try {
      localStorage.setItem(LS_USER, userId);
      localStorage.setItem(LS_USERS, JSON.stringify(userOptions));
      localStorage.setItem(LS_PROFILE, activeProfileId);
    } catch {
      // ignore storage failures
    }
  }

  function ensureUserOption(id: string): void {
    const next = sanitizeUserId(id);
    if (!next) return;
    if (!userOptions.includes(next)) {
      userOptions = [next, ...userOptions].slice(0, 12);
    }
  }

  function formatSessionTime(iso: string): string {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function resizeComposer(el: HTMLTextAreaElement | null): void {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }

  function normalizeProfileName(name: string | undefined, id: string): string {
    const next = String(name ?? "").trim();
    return next || id || "Default Web";
  }

  function applyWebProfilesFromSettings(settings: RuntimeSettings): void {
    const raw = settings.channels?.web?.instances ?? [];
    const profiles = (Array.isArray(raw) ? raw : [])
      .map((item) => {
        const id = String(item?.id ?? "").trim();
        if (!id) return null;
        return {
          id,
          name: normalizeProfileName(item?.name, id),
          enabled: item?.enabled !== false
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; enabled: boolean }>;

    const effective = profiles.length > 0 ? profiles : [{ id: "default", name: "Default Web", enabled: true }];
    profileNameById = Object.fromEntries(effective.map((p) => [p.id, p.name]));

    if (!effective.some((p) => p.id === activeProfileId)) {
      activeProfileId = effective[0].id;
    }
    activeProfileName = normalizeProfileName(profileNameById[activeProfileId], activeProfileId);
  }

  async function scrollMessagesToBottom(force: boolean = false): Promise<void> {
    await tick();
    const el = messagesContainer;
    if (!el) return;
    if (force) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      return;
    }

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }

  async function loadSessions(): Promise<void> {
    const response = await fetch(
      `/api/sessions?userId=${encodeURIComponent(userId)}&profileId=${encodeURIComponent(activeProfileId)}`
    );
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to load sessions");
    }
    sessions = payload.sessions ?? [];
  }

  async function ensureActiveSession(): Promise<void> {
    if (sessions.length > 0) {
      if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        activeSessionId = sessions[0].id;
      }
      return;
    }

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, profileId: activeProfileId })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to create session");
    }
    await loadSessions();
    activeSessionId = payload.session.id;
  }

  async function loadMessages(): Promise<void> {
    if (!activeSessionId) {
      messages = [];
      return;
    }

    loadingMessages = true;
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(activeSessionId)}?userId=${encodeURIComponent(userId)}&profileId=${encodeURIComponent(activeProfileId)}`
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to load session messages");
      }
      messages = (payload.session.messages ?? [])
        .filter((m: { role?: string }) => m.role === "user" || m.role === "assistant")
        .map((m: { role: "user" | "assistant"; content: string; createdAt: string }) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt
        }));
      await scrollMessagesToBottom(true);
    } finally {
      loadingMessages = false;
    }
  }

  async function switchSession(sessionId: string): Promise<void> {
    if (sessionId === activeSessionId) {
      showMobileSidebar = false;
      return;
    }
    activeSessionId = sessionId;
    showMobileSidebar = false;
    await loadMessages();
  }

  function startRenameSession(session: SessionSummary): void {
    editingSessionId = session.id;
    editingSessionTitle = session.title || "New Session";
  }

  function cancelRenameSession(): void {
    editingSessionId = "";
    editingSessionTitle = "";
  }

  async function saveRenameSession(sessionId: string): Promise<void> {
    const nextTitle = editingSessionTitle.trim();
    if (!nextTitle) {
      status = "Session name cannot be empty.";
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, profileId: activeProfileId, title: nextTitle })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to rename session");
      }
      sessions = sessions.map((item) =>
        item.id === sessionId ? { ...item, title: payload.session?.title ?? nextTitle } : item
      );
      cancelRenameSession();
      status = "";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function createSession(): Promise<void> {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, profileId: activeProfileId })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to create session");
    }
    await loadSessions();
    await switchSession(payload.session.id);
    status = "";
  }

  async function startNewChatWithUser(selectedUserId: string): Promise<void> {
    userId = sanitizeUserId(selectedUserId);
    ensureUserOption(userId);
    persistIdentity();

    activeSessionId = "";
    messages = [];
    await loadSessions();
    await createSession();
  }

  function openNewChatDialog(): void {
    newChatUserId = userId;
    showNewChatDialog = true;
  }

  async function confirmNewChat(): Promise<void> {
    try {
      await startNewChatWithUser(newChatUserId);
      showNewChatDialog = false;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function fetchRuntimeSettings(): Promise<RuntimeSettings> {
    const response = await fetch("/api/settings");
    const payload = await response.json();
    if (!response.ok || !payload?.ok || !payload?.settings) {
      throw new Error(payload?.error || "Failed to load runtime settings");
    }
    return payload.settings as RuntimeSettings;
  }

  function buildModelOptions(settings: RuntimeSettings): Array<{ key: string; label: string }> {
    const options: Array<{ key: string; label: string }> = [
      {
        key: `pi|${settings.piModelProvider}|${settings.piModelName}`,
        label: `[PI] ${settings.piModelProvider} / ${settings.piModelName}`
      }
    ];

    for (const provider of settings.customProviders.filter((p) => p.enabled)) {
      for (const model of provider.models ?? []) {
        const modelId = typeof model === "string" ? model : model.id;
        if (!modelId) continue;
        options.push({
          key: `custom|${provider.id}|${modelId}`,
          label: `[Custom] ${provider.name} / ${modelId}`
        });
      }
    }
    return options;
  }

  function computeActiveModelKey(settings: RuntimeSettings): string {
    if (settings.providerMode === "custom") {
      const enabledProviders = settings.customProviders.filter((p) => p.enabled);
      const id = settings.defaultCustomProviderId || enabledProviders[0]?.id || "";
      const provider = enabledProviders.find((p) => p.id === id) ?? enabledProviders[0];
      const firstModel = provider?.models?.[0];
      const firstModelId = typeof firstModel === "string" ? firstModel : firstModel?.id;
      const model = provider?.defaultModel || firstModelId || "";
      return id ? `custom|${id}|${model}` : `pi|${settings.piModelProvider}|${settings.piModelName}`;
    }
    return `pi|${settings.piModelProvider}|${settings.piModelName}`;
  }

  async function applyModelSelection(key: string): Promise<void> {
    if (!runtimeSettings) return;
    changingModel = true;
    try {
      let payload: Record<string, unknown>;
      if (key.startsWith("custom|")) {
        const [, customId, customModel = ""] = key.split("|");
        payload = {
          providerMode: "custom",
          defaultCustomProviderId: customId,
          customProviders: runtimeSettings.customProviders.map((p) =>
            p.id === customId
              ? {
                  ...p,
                  defaultModel:
                    customModel || p.defaultModel || (typeof p.models[0] === "string" ? p.models[0] : p.models[0]?.id) || ""
                }
              : p
          )
        };
      } else {
        const [, piProvider, ...rest] = key.split("|");
        payload = {
          providerMode: "pi",
          piModelProvider: piProvider,
          piModelName: rest.join("|")
        };
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update model selection");
      }
      runtimeSettings = data.settings as RuntimeSettings;
      modelOptions = buildModelOptions(runtimeSettings);
      activeModelKey = computeActiveModelKey(runtimeSettings);
      status = "";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      changingModel = false;
    }
  }

  function composeUserMessageDisplay(text: string, files: File[]): string {
    const trimmed = text.trim();
    if (files.length === 0) return trimmed;
    const names = files.map((file) => file.name || "upload").join(", ");
    const attachmentLine = `[attachments] ${names}`;
    return trimmed ? `${trimmed}\n\n${attachmentLine}` : attachmentLine;
  }

  async function sendMessage(): Promise<void> {
    const text = messageInput.trim();
    if ((!text && pendingFiles.length === 0) || sending || !activeSessionId) return;

    sending = true;
    const filesToSend = [...pendingFiles];
    pendingFiles = [];
    messageInput = "";
    resizeComposer(composerEl);

    const userDisplay = composeUserMessageDisplay(text, filesToSend);
    messages = [...messages, { role: "user", content: userDisplay, createdAt: new Date().toISOString() }];
    await scrollMessagesToBottom(true);

    try {
      let response: Response;
      if (filesToSend.length > 0) {
        const form = new FormData();
        form.append("userId", userId);
        form.append("profileId", activeProfileId);
        form.append("conversationId", activeSessionId);
        form.append("message", text);
        for (const file of filesToSend) {
          form.append("files", file);
        }
        response = await fetch("/api/chat", { method: "POST", body: form });
      } else {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, profileId: activeProfileId, conversationId: activeSessionId, message: text })
        });
      }

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Backend request failed (${response.status})`);
      }
      const assistant = String(payload.response ?? "").trim() || "(empty response)";
      messages = [...messages, { role: "assistant", content: assistant, createdAt: new Date().toISOString() }];
      if (typeof payload.conversationId === "string" && payload.conversationId) {
        activeSessionId = payload.conversationId;
      }
      await loadSessions();
      await scrollMessagesToBottom(true);
      status = "";
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      messages = [...messages, { role: "assistant", content: `Error: ${errorText}`, createdAt: new Date().toISOString() }];
      await scrollMessagesToBottom(true);
    } finally {
      sending = false;
      composerEl?.focus();
    }
  }

  async function openSystemPromptPreview(): Promise<void> {
    if (!activeSessionId) return;
    loadingPromptPreview = true;
    showPromptPreview = true;
    promptPreviewText = "";
    promptSources = { global: [], agent: [], bot: [] };
    try {
      const response = await fetch(
        `/api/web/system-prompt?userId=${encodeURIComponent(userId)}&profileId=${encodeURIComponent(activeProfileId)}&sessionId=${encodeURIComponent(activeSessionId)}&query=${encodeURIComponent(messageInput.trim())}`
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to load system prompt preview");
      }
      promptPreviewText = String(payload.prompt ?? "");
      promptSources = payload.sources ?? { global: [], agent: [], bot: [] };
    } catch (error) {
      promptPreviewText = `Error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      loadingPromptPreview = false;
    }
  }

  async function sendQuickPrompt(text: string): Promise<void> {
    messageInput = text;
    resizeComposer(composerEl);
    await sendMessage();
  }

  function onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function onComposerInput(event: Event): void {
    resizeComposer(event.target as HTMLTextAreaElement);
  }

  function onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    pendingFiles = [...pendingFiles, ...files];
    input.value = "";
  }

  function removePendingFile(index: number): void {
    pendingFiles = pendingFiles.filter((_, i) => i !== index);
  }

  function formatRecordingTime(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const secs = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function stopRecordingTimer(): void {
    if (!recordingTimer) return;
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  function cleanupRecordingStream(): void {
    if (!recordingStream) return;
    for (const track of recordingStream.getTracks()) {
      track.stop();
    }
    recordingStream = null;
  }

  async function sendVoiceFile(file: File): Promise<void> {
    if (sending || !activeSessionId) return;

    sending = true;
    messages = [
      ...messages,
      {
        role: "user",
        content: `[voice] ${file.name}`,
        createdAt: new Date().toISOString()
      }
    ];
    await scrollMessagesToBottom(true);

    try {
      const form = new FormData();
      form.append("userId", userId);
      form.append("profileId", activeProfileId);
      form.append("conversationId", activeSessionId);
      form.append("message", "");
      form.append("files", file);

      const response = await fetch("/api/chat", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Backend request failed (${response.status})`);
      }
      const assistant = String(payload.response ?? "").trim() || "(empty response)";
      messages = [...messages, { role: "assistant", content: assistant, createdAt: new Date().toISOString() }];
      if (typeof payload.conversationId === "string" && payload.conversationId) {
        activeSessionId = payload.conversationId;
      }
      await loadSessions();
      await scrollMessagesToBottom(true);
      status = "";
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      messages = [...messages, { role: "assistant", content: `Error: ${errorText}`, createdAt: new Date().toISOString() }];
      await scrollMessagesToBottom(true);
    } finally {
      sending = false;
      composerEl?.focus();
    }
  }

  async function startVoiceRecording(): Promise<void> {
    if (preparingRecording || isRecording || sending) return;
    if (!activeSessionId) {
      status = "Please select or create a session first.";
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status = "This browser does not support microphone recording.";
      return;
    }

    preparingRecording = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      cleanupRecordingStream();
      recordingStream = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordingChunks = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          recordingChunks.push(event.data);
        }
      };
      recorder.onstop = async () => {
        stopRecordingTimer();
        isRecording = false;
        const chunks = [...recordingChunks];
        recordingChunks = [];
        const finalMime = recorder.mimeType || mimeType || "audio/webm";
        cleanupRecordingStream();
        mediaRecorder = null;
        if (chunks.length === 0) {
          status = "No voice captured.";
          return;
        }

        const blob = new Blob(chunks, { type: finalMime });
        const extension = finalMime.includes("mp4") || finalMime.includes("m4a") ? "m4a" : "webm";
        const voiceFile = new File([blob], `voice-${Date.now()}.${extension}`, { type: finalMime });
        await sendVoiceFile(voiceFile);
      };
      recorder.onerror = () => {
        status = "Voice recording failed. Please retry.";
      };

      recorder.start();
      mediaRecorder = recorder;
      isRecording = true;
      recordingSeconds = 0;
      stopRecordingTimer();
      recordingTimer = setInterval(() => {
        recordingSeconds += 1;
      }, 1000);
      status = "";
    } catch (error) {
      status = error instanceof Error ? `Microphone unavailable: ${error.message}` : "Microphone unavailable.";
      cleanupRecordingStream();
    } finally {
      preparingRecording = false;
    }
  }

  function stopVoiceRecording(): void {
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    mediaRecorder.stop();
  }

  async function toggleVoiceRecording(): Promise<void> {
    if (isRecording) {
      stopVoiceRecording();
      return;
    }
    await startVoiceRecording();
  }

  onMount(async () => {
    try {
      userId = sanitizeUserId(localStorage.getItem(LS_USER) ?? "web-anonymous");
      userOptions = readJsonFromStorage<string[]>(LS_USERS, []).map(sanitizeUserId).filter(Boolean);
      ensureUserOption(userId);
      activeProfileId = String(localStorage.getItem(LS_PROFILE) ?? "default") || "default";

      runtimeSettings = await fetchRuntimeSettings();
      applyWebProfilesFromSettings(runtimeSettings);
      modelOptions = buildModelOptions(runtimeSettings);
      activeModelKey = computeActiveModelKey(runtimeSettings);

      await loadSessions();
      await ensureActiveSession();
      await loadMessages();
      status = "";
      persistIdentity();
      await tick();
      resizeComposer(composerEl);
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  });

  onDestroy(() => {
    stopRecordingTimer();
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    cleanupRecordingStream();
  });
</script>

<main class="relative h-[100dvh] overflow-hidden bg-[#0f1419] text-slate-100">
  <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(16,185,129,0.12),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.1),transparent_40%)]"></div>

  <div class="relative flex h-full">
    {#if showMobileSidebar}
      <button
        class="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm lg:hidden"
        type="button"
        aria-label="Close sidebar"
        on:click={() => (showMobileSidebar = false)}
      ></button>
    {/if}

    <aside
      class={`absolute inset-y-0 left-0 z-30 flex w-[290px] flex-col border-r border-white/10 bg-[#101820]/95 p-3 shadow-2xl transition-transform duration-200 lg:static lg:z-0 lg:w-[310px] lg:translate-x-0 lg:bg-[#101820] ${showMobileSidebar ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div class="space-y-3 border-b border-white/10 pb-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/70">Molibot</p>
            <h2 class="text-base font-semibold text-white">Conversations</h2>
          </div>
          <a
            class="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/60 hover:text-emerald-300"
            href="/settings"
          >
            Settings
          </a>
        </div>

        <button
          class="w-full rounded-xl bg-emerald-500 px-3 py-2 text-left text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
          type="button"
          on:click={openNewChatDialog}
        >
          + New chat
        </button>

        <input
          class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
          type="text"
          bind:value={sessionSearch}
          placeholder="Search chats"
        />

        <div class="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Active Profile</p>
          <p class="truncate text-xs text-emerald-100">{activeProfileName}</p>
          <p class="truncate text-[10px] text-emerald-200/80">{activeProfileId}</p>
        </div>
      </div>

      <div class="min-h-0 flex-1 space-y-1 overflow-y-auto py-3 pr-1">
        {#if filteredSessions.length === 0}
          <div class="rounded-xl border border-dashed border-white/15 px-3 py-4 text-xs text-slate-400">
            No matching conversations.
          </div>
        {:else}
          {#each filteredSessions as s}
            <div
              class={`w-full rounded-xl border px-3 py-2.5 text-left transition ${s.id === activeSessionId
                ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100"
                : "border-transparent bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/[0.06]"}`}
            >
              {#if editingSessionId === s.id}
                <div class="space-y-2">
                  <input
                    class="w-full rounded-md border border-white/20 bg-black/20 px-2 py-1 text-sm text-white outline-none focus:border-emerald-400"
                    bind:value={editingSessionTitle}
                    on:keydown={async (event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        await saveRenameSession(s.id);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRenameSession();
                      }
                    }}
                  />
                  <div class="flex gap-2">
                    <button
                      class="rounded-md border border-emerald-400/40 px-2 py-1 text-[10px] text-emerald-200"
                      type="button"
                      on:click={async () => saveRenameSession(s.id)}
                    >
                      Save
                    </button>
                    <button
                      class="rounded-md border border-white/20 px-2 py-1 text-[10px] text-slate-300"
                      type="button"
                      on:click={cancelRenameSession}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              {:else}
                <button class="w-full text-left" type="button" on:click={() => switchSession(s.id)} on:dblclick={() => startRenameSession(s)}>
                  <p class="line-clamp-1 text-sm font-medium">{s.title || "New Session"}</p>
                  <p class="mt-1 text-[11px] text-slate-500">Profile: {activeProfileName}</p>
                  <p class="mt-1 text-[11px] text-slate-500">{formatSessionTime(s.updatedAt)}</p>
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <div class="border-t border-white/10 pt-3 text-[11px] text-slate-500">Session-only switching mode</div>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      <header class="border-b border-white/10 bg-[#0f161c]/90 px-4 py-3 backdrop-blur sm:px-6">
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10 lg:hidden"
            type="button"
            on:click={() => (showMobileSidebar = true)}
          >
            Chats
          </button>

          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Assistant Console</p>
            <h1 class="truncate text-sm font-semibold text-white sm:text-base">{sessions.find((s) => s.id === activeSessionId)?.title || "New Session"}</h1>
          </div>

          <div class="ml-auto flex items-center gap-2">
            <select
              class="max-w-[220px] rounded-lg border border-white/15 bg-[#1a2430] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-400"
              value={activeModelKey}
              disabled={changingModel || modelOptions.length === 0}
              on:change={async (e) => applyModelSelection((e.target as HTMLSelectElement).value)}
            >
              {#each modelOptions as m}
                <option value={m.key}>{m.label}</option>
              {/each}
            </select>
            <button
              class="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/[0.1]"
              type="button"
              on:click={openNewChatDialog}
            >
              New
            </button>
          </div>
        </div>
        <div class="mt-2 inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-100">
          Active Profile: {activeProfileName}
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-hidden">
        <div class="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
          {#if status}
            <div class="mb-3 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{status}</div>
          {/if}

          <div class="mb-3 flex flex-wrap gap-2">
            {#each QUICK_PROMPTS as prompt}
              <button
                class="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition hover:border-emerald-400/50 hover:text-emerald-200"
                type="button"
                on:click={() => sendQuickPrompt(prompt)}
              >
                {prompt}
              </button>
            {/each}
            <button
              class="rounded-full border border-emerald-400/40 bg-emerald-500/12 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-500/20"
              type="button"
              on:click={openSystemPromptPreview}
            >
              Preview System Prompt
            </button>
          </div>

          <div
            class="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#111a23]/70 p-4 sm:p-5"
            bind:this={messagesContainer}
          >
            {#if loadingMessages}
              <div class="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                Loading messages...
              </div>
            {:else if messages.length === 0}
              <div class="rounded-xl border border-dashed border-white/20 bg-black/10 px-5 py-8 text-center text-sm text-slate-300">
                <p class="text-base font-medium text-slate-100">Start a focused conversation</p>
                <p class="mt-2 text-xs text-slate-400">支持文字、图片和实时语音录音；Enter 发送，Shift+Enter 换行。</p>
              </div>
            {:else}
              <div class="space-y-4">
                {#each messages as m}
                  <article class={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div class={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${m.role === "user"
                      ? "border border-emerald-400/40 bg-emerald-500/12 text-emerald-50"
                      : "border border-white/10 bg-[#1a2733] text-slate-100"}`}>
                      <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {m.role === "user" ? `You (${activeProfileName})` : "Molibot"}
                      </div>
                      <div class="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  </article>
                {/each}

                {#if sending}
                  <article class="flex justify-start">
                    <div class="rounded-2xl border border-white/10 bg-[#1a2733] px-4 py-3 text-sm text-slate-300">
                      <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Molibot</div>
                      Thinking...
                    </div>
                  </article>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <footer class="border-t border-white/10 bg-[#0e151b]/95 px-4 py-4 sm:px-6">
        <div class="mx-auto w-full max-w-4xl rounded-2xl border border-white/15 bg-[#15202b] p-3">
          {#if pendingFiles.length > 0}
            <div class="mb-2 flex flex-wrap gap-2">
              {#each pendingFiles as file, index}
                <button
                  class="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-slate-200"
                  type="button"
                  on:click={() => removePendingFile(index)}
                >
                  {file.name} ×
                </button>
              {/each}
            </div>
          {/if}

          <textarea
            class="max-h-[220px] min-h-[52px] w-full resize-none rounded-xl bg-transparent px-2 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
            bind:this={composerEl}
            bind:value={messageInput}
            rows="1"
            placeholder="Ask Molibot anything..."
            on:keydown={onComposerKeydown}
            on:input={onComposerInput}
          ></textarea>

          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <label class="cursor-pointer rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-100 transition hover:bg-white/10">
                + Image
                <input class="hidden" type="file" accept="image/*" multiple on:change={onFileSelect} />
              </label>
              <button
                class={`rounded-lg px-3 py-2 text-xs font-semibold transition ${isRecording
                  ? "border border-rose-400/60 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                  : "border border-emerald-400/45 bg-emerald-500/12 text-emerald-100 hover:bg-emerald-500/22"}`}
                type="button"
                disabled={preparingRecording || sending}
                on:click={toggleVoiceRecording}
              >
                {#if preparingRecording}
                  Opening Mic...
                {:else if isRecording}
                  Stop & Send ({formatRecordingTime(recordingSeconds)})
                {:else}
                  Record Voice
                {/if}
              </button>
              <p class="text-[11px] text-slate-500">Enter 发送 · Shift+Enter 换行</p>
            </div>
            <button
              class="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
              type="button"
              disabled={sending || (!messageInput.trim() && pendingFiles.length === 0)}
              on:click={sendMessage}
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </footer>
    </section>
  </div>

  {#if showPromptPreview}
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div class="flex h-[85dvh] w-full max-w-5xl flex-col rounded-2xl border border-white/15 bg-[#101820]">
        <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 class="text-sm font-semibold text-white">System Prompt Preview ({activeProfileName})</h2>
          <button class="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200" type="button" on:click={() => (showPromptPreview = false)}>Close</button>
        </div>
        <div class="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[300px_1fr]">
          <div class="min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-[#0b1117] p-3 text-xs text-slate-300">
            <p class="mb-2 font-semibold text-slate-100">Sources</p>
            <p class="mt-2 text-slate-400">Global</p>
            {#each promptSources.global as item}
              <p class="break-all">• {item}</p>
            {/each}
            <p class="mt-3 text-slate-400">Agent</p>
            {#if promptSources.agent.length === 0}
              <p>(none)</p>
            {:else}
              {#each promptSources.agent as item}
                <p class="break-all">• {item}</p>
              {/each}
            {/if}
            <p class="mt-3 text-slate-400">Bot/Web Profile</p>
            {#if promptSources.bot.length === 0}
              <p>(none)</p>
            {:else}
              {#each promptSources.bot as item}
                <p class="break-all">• {item}</p>
              {/each}
            {/if}
          </div>
          <pre class="min-h-0 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0b1117] p-3 text-xs leading-6 text-slate-100">{loadingPromptPreview ? "Loading preview..." : promptPreviewText}</pre>
        </div>
      </div>
    </div>
  {/if}

  {#if showNewChatDialog}
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div class="w-full max-w-lg rounded-2xl border border-white/15 bg-[#101820] p-4">
        <h2 class="text-base font-semibold text-white">Start New Chat</h2>
        <p class="mt-1 text-xs text-slate-400">Only here you can choose the user identity. Once created, this chat keeps that user.</p>
        <p class="mt-1 text-xs text-emerald-200/80">Current Profile: {activeProfileName}</p>

        <label class="mt-4 grid gap-1.5 text-sm">
          <span class="text-slate-300">User ID</span>
          <input
            class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
            bind:value={newChatUserId}
            list="known-users"
            placeholder="web-anonymous"
          />
          <datalist id="known-users">
            {#each userOptions as option}
              <option value={option}></option>
            {/each}
          </datalist>
        </label>

        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200" type="button" on:click={() => (showNewChatDialog = false)}>
            Cancel
          </button>
          <button class="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-emerald-950" type="button" on:click={confirmNewChat}>
            Create Chat
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>
