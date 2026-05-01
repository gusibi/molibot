<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { marked } from "marked";
  import { initLocale, locale as localeStore, setLocale, type LocaleKey } from "$lib/ui/i18n";
  import {
    classifyFilePreview,
    isTextPreviewKind,
    type FilePreviewKind
  } from "$lib/shared/filePreview";

  interface RuntimeSettings {
    providerMode: "pi" | "custom";
    piModelProvider: string;
    piModelName: string;
    defaultThinkingLevel?: ThinkingLevel;
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
    meta?: {
      diagnostics?: string[];
      thinking?: string;
    };
  }

  interface PersistedSessionFile {
    id: string;
    original: string;
    local: string;
    mimeType?: string;
    mediaType: "image" | "audio" | "video" | "file";
    size: number;
    createdAt: string;
    source: "persisted";
    previewKind: FilePreviewKind;
  }

  interface PendingUpload {
    id: string;
    file: File;
    previewUrl: string;
  }

  interface PanelFileEntry {
    id: string;
    original: string;
    local?: string;
    mimeType?: string;
    mediaType: "image" | "audio" | "video" | "file";
    size: number;
    createdAt: string;
    source: "pending" | "persisted";
    previewKind: FilePreviewKind;
    file?: File;
    previewUrl?: string;
  }

  type ThinkingLevel = "off" | "low" | "medium" | "high";

  interface PromptSources {
    global: string[];
    agent: string[];
    bot: string[];
  }

  interface VersionInfo {
    ok: boolean;
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    checkedAt: string;
    remoteConfigured: boolean;
    remoteSource?: "release" | "package";
    remoteUrl?: string;
    repository?: string;
    ref?: string;
    error?: string;
  }

  type ThemeMode = "system" | "light" | "dark";
  const LS_THEME = "molibot-web-theme";
  const LS_PROFILE = "molibot-web-profile-id";

  const I18N: Record<
    LocaleKey,
    {
      quickPrompts: string[];
      [key: string]: string;
    }
  > = {
    "zh-CN": {
      quickPrompts: ["帮我总结今天要做的 3 件事", "把这个项目当前状态给我一版执行清单", "检查我现在模型和路由配置有没有明显风险"],
      loading: "加载中...",
      defaultWeb: "默认 Web",
      errorPrefix: "错误: ",
      closeSidebar: "关闭侧边栏",
      openSidebar: "打开侧边栏",
      conversations: "会话",
      settings: "设置",
      newChat: "+ 新建对话",
      searchChats: "搜索会话",
      activeProfile: "当前配置",
      noMatchingConversations: "没有匹配的会话",
      save: "保存",
      cancel: "取消",
      newSession: "新会话",
      profile: "配置",
      sessionOnlySwitchingMode: "仅会话切换模式",
      chats: "会话",
      assistantConsole: "助手控制台",
      focusedWorkspace: "聚焦工作台",
      newLabel: "新建",
      theme: "主题",
      language: "语言",
      system: "跟随系统",
      light: "明色",
      dark: "暗色",
      previewSystemPrompt: "预览 System Prompt",
      loadingMessages: "正在加载消息...",
      startFocusedConversation: "开始一次聚焦对话",
      multimodalHint: "支持文字、图片和实时语音录音；Enter 发送，Shift+Enter 换行。",
      you: "你",
      thinking: "思考中...",
      askAnything: "向 Molibot 提问...",
      image: "图片",
      openingMic: "打开麦克风...",
      stopAndSend: "停止并发送",
      recordVoice: "录音",
      enterShiftHint: "Enter 发送 · Shift+Enter 换行",
      sending: "发送中...",
      stopping: "停止中...",
      stop: "停止",
      send: "发送",
      systemPromptPreview: "System Prompt 预览",
      close: "关闭",
      sources: "来源",
      global: "全局",
      agent: "Agent",
      botWebProfile: "Bot/Web 配置",
      none: "(无)",
      loadingPreview: "正在加载预览...",
      startNewChat: "开始新对话",
      chooseProfileForNewChat: "为这个新对话选择 Web 配置。",
      webProfile: "Web 配置",
      createChat: "创建对话",
      sessionNameCannotBeEmpty: "会话名称不能为空。",
      failedLoadSessions: "加载会话失败",
      failedCreateSession: "创建会话失败",
      failedLoadRuntimeSettings: "加载运行时设置失败",
      failedRenameSession: "重命名会话失败",
      failedUpdateModelSelection: "更新模型选择失败",
      failedLoadSessionMessages: "加载会话消息失败",
      failedLoadSystemPromptPreview: "加载 System Prompt 预览失败",
      backendRequestFailed: "后端请求失败",
      emptyResponse: "(空响应)",
      pleaseSelectSessionFirst: "请先选择或创建会话。",
      browserNoMicSupport: "当前浏览器不支持麦克风录音。",
      noVoiceCaptured: "没有录到语音。",
      voiceRecordFailed: "录音失败，请重试。",
      micUnavailable: "麦克风不可用。",
      openSettings: "打开设置",
      currentThemeFile: "主题文件",
      thinkingMode: "思考档位",
      thinkingOff: "关闭",
      thinkingLow: "低",
      thinkingMedium: "中",
      thinkingHigh: "高",
      thinkingDetails: "思考与请求信息",
      requestTrace: "请求信息",
      thinkingProcess: "思考过程",
      noThinkingSeen: "这次没有收到思考流",
      liveAnswer: "实时输出",
      updatedAt: "更新于",
      sessionCount: "条会话",
      activeSession: "当前会话",
      profileMode: "配置模式",
      workspaceNote: "这里先专注同一个配置里的会话切换；要切到别的配置，直接新建对话。",
      quickActions: "快捷入口",
      quickActionsHint: "先从下面这些常见问题起步，后面再顺着聊深一点。",
      conversationTimeline: "对话时间线",
      emptyTimelineTitle: "开始一段真正有上下文的对话",
      emptyTimelineHint: "直接提问、上传图片，或者录一段语音都可以，助手会沿着同一条线继续。",
      attachments: "附件",
      recorderReady: "语音输入",
      stopCurrentTaskDone: "已停止当前任务。",
      stopCurrentTaskIdle: "当前没有运行中的任务。",
      profileAttached: "当前配置",
      files: "文件",
      workspace: "工作区",
      mainBranch: "MAIN",
      openFiles: "打开文件栏",
      closeFiles: "关闭文件栏",
      filesWorkspaceTitle: "当前会话文件",
      filesWorkspaceHint: "这里展示当前 Web 会话里已发送的附件，以及待发送文件。可按类型筛选，并在右侧预览常见格式。",
      filesSearch: "搜索文件名...",
      filesFilterAll: "全部类型",
      filesFilterImage: "图片",
      filesFilterAudio: "音频",
      filesFilterVideo: "视频",
      filesFilterPdf: "PDF",
      filesFilterText: "文本",
      filesFilterCode: "代码",
      filesFilterData: "结构化",
      filesFilterOffice: "Office",
      filesFilterOther: "其他",
      filesPendingGroup: "待发送",
      filesSessionGroup: "已发送到会话",
      filesRefresh: "刷新文件",
      filesPreview: "文件预览",
      filesDetails: "文件详情",
      filesEmptyTitle: "这个会话还没有附件",
      filesEmptyHint: "你可以直接上传图片、PDF、Markdown、代码、JSON、音频或其他常见文档文件。",
      filesPreviewUnavailable: "这个文件类型暂不支持内嵌预览，可直接下载查看。",
      filesPreviewFailed: "文件预览加载失败",
      filesCopyPath: "复制路径",
      filesPathCopied: "文件路径已复制。",
      filesDownload: "下载",
      filesNotSentYet: "尚未发送",
      filesType: "类型",
      filesSize: "大小",
      filesCreatedAt: "创建时间",
      filesSourcePending: "待发送",
      filesSourcePersisted: "会话内",
      filesAttach: "上传文件",
      filesLoading: "正在加载文件...",
      noFilesYet: "暂无文件",
      commandShortcut: "Cmd+K",
      filterConversations: "过滤会话...",
      all: "全部",
      thisProfile: "当前",
      pinned: "置顶",
      messageCount: "条消息",
      home: "Home",
      version: "版本",
      currentVersion: "当前版本",
      latestVersion: "最新版本",
      checkingVersion: "检查中...",
      checkVersion: "检查更新",
      updateAvailable: "发现新版本",
      upToDate: "已是最新",
      versionCheckFailed: "检查失败",
      versionRemoteMissing: "未配置 GitHub 仓库",
      updateWithManager: "请用 molibot manage 更新"
    },
    "en-US": {
      quickPrompts: [
        "Summarize the top 3 things I should do today",
        "Give me an execution checklist for this project status",
        "Check if my current model and routing config has obvious risks"
      ],
      loading: "Loading...",
      defaultWeb: "Default Web",
      errorPrefix: "Error: ",
      closeSidebar: "Close sidebar",
      openSidebar: "Open sidebar",
      conversations: "Conversations",
      settings: "Settings",
      newChat: "+ New chat",
      searchChats: "Search chats",
      activeProfile: "Active Profile",
      noMatchingConversations: "No matching conversations.",
      save: "Save",
      cancel: "Cancel",
      newSession: "New Session",
      profile: "Profile",
      sessionOnlySwitchingMode: "Session-only switching mode",
      chats: "Chats",
      assistantConsole: "Assistant Console",
      focusedWorkspace: "Focused Workspace",
      newLabel: "New",
      theme: "Theme",
      language: "Language",
      system: "System",
      light: "Light",
      dark: "Dark",
      previewSystemPrompt: "Preview System Prompt",
      loadingMessages: "Loading messages...",
      startFocusedConversation: "Start a focused conversation",
      multimodalHint: "Supports text, image, and real-time voice recording; Enter to send, Shift+Enter for newline.",
      you: "You",
      thinking: "Thinking...",
      askAnything: "Ask Molibot anything...",
      image: "Image",
      openingMic: "Opening Mic...",
      stopAndSend: "Stop & Send",
      recordVoice: "Record Voice",
      enterShiftHint: "Enter send · Shift+Enter newline",
      sending: "Sending...",
      stopping: "Stopping...",
      stop: "Stop",
      send: "Send",
      systemPromptPreview: "System Prompt Preview",
      close: "Close",
      sources: "Sources",
      global: "Global",
      agent: "Agent",
      botWebProfile: "Bot/Web Profile",
      none: "(none)",
      loadingPreview: "Loading preview...",
      startNewChat: "Start New Chat",
      chooseProfileForNewChat: "Choose the Web Profile for this new chat session.",
      webProfile: "Web Profile",
      createChat: "Create Chat",
      sessionNameCannotBeEmpty: "Session name cannot be empty.",
      failedLoadSessions: "Failed to load sessions",
      failedCreateSession: "Failed to create session",
      failedLoadRuntimeSettings: "Failed to load runtime settings",
      failedRenameSession: "Failed to rename session",
      failedUpdateModelSelection: "Failed to update model selection",
      failedLoadSessionMessages: "Failed to load session messages",
      failedLoadSystemPromptPreview: "Failed to load system prompt preview",
      backendRequestFailed: "Backend request failed",
      emptyResponse: "(empty response)",
      pleaseSelectSessionFirst: "Please select or create a session first.",
      browserNoMicSupport: "This browser does not support microphone recording.",
      noVoiceCaptured: "No voice captured.",
      voiceRecordFailed: "Voice recording failed. Please retry.",
      micUnavailable: "Microphone unavailable.",
      openSettings: "Open Settings",
      currentThemeFile: "Theme file",
      thinkingMode: "Thinking",
      thinkingOff: "Off",
      thinkingLow: "Low",
      thinkingMedium: "Medium",
      thinkingHigh: "High",
      thinkingDetails: "Thinking Details",
      requestTrace: "Request Trace",
      thinkingProcess: "Thinking Process",
      noThinkingSeen: "No thinking stream received",
      liveAnswer: "Live Output",
      updatedAt: "Updated",
      sessionCount: "sessions",
      activeSession: "Active session",
      profileMode: "Profile mode",
      workspaceNote: "Session switching stays inside one profile. Start a new chat to move to another profile.",
      quickActions: "Quick Actions",
      quickActionsHint: "Start with one of these, then keep narrowing the conversation.",
      conversationTimeline: "Conversation Timeline",
      emptyTimelineTitle: "Start a conversation with real context",
      emptyTimelineHint: "Ask directly, upload an image, or record a voice note. The assistant will keep building on the same thread.",
      attachments: "Attachments",
      recorderReady: "Voice Input",
      stopCurrentTaskDone: "Current task stopped.",
      stopCurrentTaskIdle: "No active task right now.",
      profileAttached: "Current profile",
      files: "Files",
      workspace: "Workspace",
      mainBranch: "MAIN",
      openFiles: "Open files panel",
      closeFiles: "Close files panel",
      filesWorkspaceTitle: "Current Session Files",
      filesWorkspaceHint: "Browse files already sent in this Web chat session, plus pending uploads before send. Filter by type and preview common formats inline.",
      filesSearch: "Search file names...",
      filesFilterAll: "All types",
      filesFilterImage: "Images",
      filesFilterAudio: "Audio",
      filesFilterVideo: "Video",
      filesFilterPdf: "PDF",
      filesFilterText: "Text",
      filesFilterCode: "Code",
      filesFilterData: "Data",
      filesFilterOffice: "Office",
      filesFilterOther: "Other",
      filesPendingGroup: "Pending uploads",
      filesSessionGroup: "Sent in session",
      filesRefresh: "Refresh files",
      filesPreview: "Preview",
      filesDetails: "Details",
      filesEmptyTitle: "This session has no attachments yet",
      filesEmptyHint: "Upload images, PDFs, Markdown, code, JSON, audio, or other common documents to build a file workspace here.",
      filesPreviewUnavailable: "Inline preview is not available for this file type. Download it instead.",
      filesPreviewFailed: "Failed to load file preview",
      filesCopyPath: "Copy path",
      filesPathCopied: "File path copied.",
      filesDownload: "Download",
      filesNotSentYet: "Not sent yet",
      filesType: "Type",
      filesSize: "Size",
      filesCreatedAt: "Created",
      filesSourcePending: "Pending",
      filesSourcePersisted: "In session",
      filesAttach: "Attach file",
      filesLoading: "Loading files...",
      noFilesYet: "No files yet",
      commandShortcut: "Cmd+K",
      filterConversations: "Filter conversations...",
      all: "All",
      thisProfile: "Current",
      pinned: "Pinned",
      messageCount: "messages",
      home: "Home",
      version: "Version",
      currentVersion: "Current",
      latestVersion: "Latest",
      checkingVersion: "Checking...",
      checkVersion: "Check update",
      updateAvailable: "Update available",
      upToDate: "Up to date",
      versionCheckFailed: "Check failed",
      versionRemoteMissing: "GitHub repo is not configured",
      updateWithManager: "Use molibot manage to update"
    }
  };

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
  let stopping = false;
  let sendAbortController: AbortController | null = null;
  let loadingMessages = false;
  let showMobileSidebar = false;
  let sessionSearch = "";

  let runtimeSettings: RuntimeSettings | null = null;
  let modelOptions: Array<{ key: string; label: string }> = [];
  let activeModelKey = "";
  let changingModel = false;
  let thinkingLevel: ThinkingLevel = "off";

  let pendingFiles: PendingUpload[] = [];
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
  let QUICK_PROMPTS: string[] = I18N["zh-CN"].quickPrompts;

  let showNewChatDialog = false;
  let showFilesPanel = false;
  let filePanelLoading = false;
  let filePanelError = "";
  let fileSearch = "";
  let fileTypeFilter = "all";
  let selectedFileId = "";
  let persistedFiles: PersistedSessionFile[] = [];
  let allPanelFiles: PanelFileEntry[] = [];
  let filteredPanelFiles: PanelFileEntry[] = [];
  let pendingPanelFiles: PanelFileEntry[] = [];
  let sessionPanelFiles: PanelFileEntry[] = [];
  let selectedFile: PanelFileEntry | undefined;
  let filePreviewLoading = false;
  let filePreviewError = "";
  let selectedTextPreview = "";
  let lastLoadedPreviewId = "";
  let newChatProfileId = "default";
  let themeMode: ThemeMode = "light";
  let locale: LocaleKey = "zh-CN";
  let dict = I18N[locale];
  let streamingAssistantText = "";
  let streamingThinkingText = "";
  let streamingDiagnostics: string[] = [];
  let activeSessionTitle = "";
  let versionInfo: VersionInfo | null = null;
  let versionLoading = false;
  let showVersionPanel = false;

  let messagesContainer: HTMLDivElement | null = null;
  let composerEl: HTMLTextAreaElement | null = null;

  $: dict = I18N[locale];
  $: QUICK_PROMPTS = dict.quickPrompts;
  $: activeSessionTitle = sessions.find((s) => s.id === activeSessionId)?.title || t("newSession");

  function t(key: string): string {
    return dict[key] ?? key;
  }

  function thinkingLabel(level: ThinkingLevel): string {
    switch (level) {
      case "low":
        return t("thinkingLow");
      case "medium":
        return t("thinkingMedium");
      case "high":
        return t("thinkingHigh");
      case "off":
      default:
        return t("thinkingOff");
    }
  }

  function resetStreamingState(): void {
    streamingAssistantText = "";
    streamingThinkingText = "";
    streamingDiagnostics = [];
  }

  $: filteredSessions = sessions.filter((s) => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return true;
    return s.title.toLowerCase().includes(q);
  });

  function persistIdentity(): void {
    try {
      localStorage.setItem(LS_PROFILE, activeProfileId);
    } catch {
      // ignore storage failures
    }
  }

  function formatSessionTime(iso: string): string {
    try {
      return new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function formatMessageTime(iso: string): string {
    try {
      return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function createPendingUpload(file: File): PendingUpload {
    return {
      id: `pending:${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file)
    };
  }

  function releasePendingUpload(upload: PendingUpload): void {
    URL.revokeObjectURL(upload.previewUrl);
  }

  function clearPendingUploads(): void {
    for (const upload of pendingFiles) {
      releasePendingUpload(upload);
    }
    pendingFiles = [];
  }

  function panelPreviewKindLabel(kind: FilePreviewKind): string {
    switch (kind) {
      case "image":
        return t("filesFilterImage");
      case "audio":
        return t("filesFilterAudio");
      case "video":
        return t("filesFilterVideo");
      case "pdf":
        return t("filesFilterPdf");
      case "markdown":
      case "text":
        return t("filesFilterText");
      case "code":
        return t("filesFilterCode");
      case "json":
      case "csv":
      case "yaml":
        return t("filesFilterData");
      case "office":
        return t("filesFilterOffice");
      default:
        return t("filesFilterOther");
    }
  }

  function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatFileDate(iso: string): string {
    try {
      return new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  function versionBadgeLabel(): string {
    const current = versionInfo?.currentVersion ? `v${versionInfo.currentVersion}` : "v...";
    if (versionLoading) return current;
    if (versionInfo?.updateAvailable) return `${current} ↑`;
    return current;
  }

  function versionStatusLabel(): string {
    if (versionLoading) return t("checkingVersion");
    if (!versionInfo) return t("checkVersion");
    if (!versionInfo.remoteConfigured) return t("versionRemoteMissing");
    if (!versionInfo.ok) return t("versionCheckFailed");
    return versionInfo.updateAvailable ? t("updateAvailable") : t("upToDate");
  }

  async function loadVersionInfo(): Promise<void> {
    versionLoading = true;
    try {
      const response = await fetch("/api/version");
      const payload = await response.json();
      versionInfo = {
        ok: Boolean(payload?.ok),
        currentVersion: String(payload?.currentVersion ?? "0.0.0"),
        latestVersion: payload?.latestVersion ? String(payload.latestVersion) : null,
        updateAvailable: Boolean(payload?.updateAvailable),
        checkedAt: String(payload?.checkedAt ?? new Date().toISOString()),
        remoteConfigured: Boolean(payload?.remoteConfigured),
        remoteSource: payload?.remoteSource,
        remoteUrl: payload?.remoteUrl,
        repository: payload?.repository,
        ref: payload?.ref,
        error: payload?.error ? String(payload.error) : undefined
      };
    } catch (error) {
      versionInfo = {
        ok: false,
        currentVersion: versionInfo?.currentVersion ?? "0.0.0",
        latestVersion: null,
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
        remoteConfigured: true,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      versionLoading = false;
    }
  }

  function buildPersistedFileUrl(fileId: string, download = false): string {
    const params = new URLSearchParams({
      profileId: activeProfileId,
      sessionId: activeSessionId,
      fileId
    });
    if (download) params.set("download", "1");
    return `/api/web/files?${params.toString()}`;
  }

  function previewKindMatchesFilter(kind: FilePreviewKind, filter: string): boolean {
    if (filter === "all") return true;
    if (filter === "image" || filter === "audio" || filter === "video" || filter === "pdf" || filter === "office") {
      return kind === filter;
    }
    if (filter === "text") return kind === "text" || kind === "markdown";
    if (filter === "code") return kind === "code";
    if (filter === "data") return kind === "json" || kind === "csv" || kind === "yaml";
    if (filter === "other") return kind === "binary";
    return true;
  }

  function buildPendingFileEntries(): PanelFileEntry[] {
    return pendingFiles.map((upload) => ({
      id: upload.id,
      original: upload.file.name || "upload",
      mediaType:
        upload.file.type.startsWith("image/")
          ? "image"
          : upload.file.type.startsWith("audio/")
            ? "audio"
            : upload.file.type.startsWith("video/")
              ? "video"
              : "file",
      mimeType: upload.file.type || undefined,
      size: upload.file.size,
      createdAt: new Date(upload.file.lastModified || Date.now()).toISOString(),
      source: "pending",
      previewKind: classifyFilePreview({
        name: upload.file.name,
        mimeType: upload.file.type
      }),
      file: upload.file,
      previewUrl: upload.previewUrl
    }));
  }

  $: allPanelFiles = [...buildPendingFileEntries(), ...persistedFiles];
  $: filteredPanelFiles = allPanelFiles.filter((file) => {
    const search = fileSearch.trim().toLowerCase();
    if (search && !file.original.toLowerCase().includes(search)) return false;
    return previewKindMatchesFilter(file.previewKind, fileTypeFilter);
  });
  $: pendingPanelFiles = filteredPanelFiles.filter((file) => file.source === "pending");
  $: sessionPanelFiles = filteredPanelFiles.filter((file) => file.source === "persisted");
  $: if (selectedFileId && !filteredPanelFiles.some((file) => file.id === selectedFileId)) {
    selectedFileId = "";
  }
  $: if (!selectedFileId && filteredPanelFiles.length > 0) {
    selectedFileId = filteredPanelFiles[0].id;
  }
  $: selectedFile = filteredPanelFiles.find((file) => file.id === selectedFileId);


  const allowedMarkdownTags = new Set([
    "A",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "DEL",
    "EM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "LI",
    "OL",
    "P",
    "PRE",
    "STRONG",
    "TABLE",
    "TBODY",
    "TD",
    "TH",
    "THEAD",
    "TR",
    "UL"
  ]);

  function isSafeMarkdownUrl(value: string | null): boolean {
    if (!value) return false;
    if (value.startsWith("/") || value.startsWith("#")) return true;
    try {
      const url = new URL(value);
      return ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch {
      return false;
    }
  }

  function sanitizeMarkdownHtml(html: string): string {
    if (typeof document === "undefined") {
      return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
    }

    const template = document.createElement("template");
    template.innerHTML = html;

    const walk = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }

        const element = child as HTMLElement;
        if (!allowedMarkdownTags.has(element.tagName)) {
          element.replaceWith(document.createTextNode(element.textContent ?? ""));
          continue;
        }

        const href = element.tagName === "A" ? (child as HTMLAnchorElement).getAttribute("href") : null;
        for (const attribute of Array.from(element.attributes)) {
          element.removeAttribute(attribute.name);
        }

        if (element.tagName === "A") {
          if (isSafeMarkdownUrl(href)) {
            element.setAttribute("href", href ?? "#");
            element.setAttribute("target", "_blank");
            element.setAttribute("rel", "noreferrer");
          }
        }

        walk(element);
      }
    };

    walk(template.content);
    return template.innerHTML;
  }

  function renderMarkdown(markdown: string): string {
    const html = marked.parse(markdown, {
      async: false,
      breaks: true,
      gfm: true
    });
    return sanitizeMarkdownHtml(String(html));
  }

  function resizeComposer(el: HTMLTextAreaElement | null): void {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }

  function normalizeProfileName(name: string | undefined, id: string): string {
    const next = String(name ?? "").trim();
    return next || id || t("defaultWeb");
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

    const effective = profiles.length > 0 ? profiles : [{ id: "default", name: t("defaultWeb"), enabled: true }];
    profileNameById = Object.fromEntries(effective.map((p) => [p.id, p.name]));

    if (!effective.some((p) => p.id === activeProfileId)) {
      activeProfileId = effective[0].id;
    }
    activeProfileName = normalizeProfileName(profileNameById[activeProfileId], activeProfileId);
  }

  async function scrollMessagesToBottom(force: boolean = false): Promise<void> {
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const el = messagesContainer;
    if (!el) return;
    if (force) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      return;
    }

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
  }

  async function loadSessions(): Promise<void> {
    const response = await fetch(`/api/sessions?profileId=${encodeURIComponent(activeProfileId)}`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || t("failedLoadSessions"));
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
      body: JSON.stringify({ profileId: activeProfileId })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || t("failedCreateSession"));
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
    let shouldScroll = false;
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(activeSessionId)}?profileId=${encodeURIComponent(activeProfileId)}`
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || t("failedLoadSessionMessages"));
      }
      messages = (payload.session.messages ?? [])
        .filter((m: { role?: string }) => m.role === "user" || m.role === "assistant")
        .map((m: { role: "user" | "assistant"; content: string; createdAt: string }) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt
        }));
      shouldScroll = true;
    } finally {
      loadingMessages = false;
      if (shouldScroll) await scrollMessagesToBottom(true);
    }
  }

  async function loadSessionFiles(): Promise<void> {
    if (!activeSessionId) {
      persistedFiles = [];
      filePanelError = "";
      filePreviewError = "";
      selectedTextPreview = "";
      lastLoadedPreviewId = "";
      return;
    }

    filePanelLoading = true;
    filePanelError = "";
    try {
      const response = await fetch(
        `/api/web/files?profileId=${encodeURIComponent(activeProfileId)}&sessionId=${encodeURIComponent(activeSessionId)}`
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error ?? t("backendRequestFailed")));
      }
      persistedFiles = Array.isArray(payload.files)
        ? payload.files.map((item: any) => ({
            id: String(item.id ?? ""),
            original: String(item.original ?? "file"),
            local: String(item.local ?? ""),
            mimeType: item.mimeType ? String(item.mimeType) : undefined,
            mediaType: item.mediaType === "image" || item.mediaType === "audio" || item.mediaType === "video" ? item.mediaType : "file",
            size: Number(item.size ?? 0),
            createdAt: String(item.createdAt ?? ""),
            source: "persisted" as const,
            previewKind: classifyFilePreview({
              name: String(item.original ?? ""),
              mimeType: item.mimeType ? String(item.mimeType) : undefined,
              mediaType: item.mediaType ? String(item.mediaType) : undefined
            })
          }))
        : [];
    } catch (error) {
      persistedFiles = [];
      filePanelError = error instanceof Error ? error.message : String(error);
    } finally {
      filePanelLoading = false;
    }
  }

  async function loadSelectedTextPreview(file: PanelFileEntry): Promise<void> {
    if (!isTextPreviewKind(file.previewKind)) {
      selectedTextPreview = "";
      filePreviewError = "";
      filePreviewLoading = false;
      lastLoadedPreviewId = file.id;
      return;
    }
    if (lastLoadedPreviewId === file.id) {
      return;
    }

    filePreviewLoading = true;
    filePreviewError = "";
    selectedTextPreview = "";
    const currentId = file.id;
    try {
      const text =
        file.source === "pending" && file.file
          ? await file.file.text()
          : await fetch(buildPersistedFileUrl(file.id)).then(async (response) => {
              if (!response.ok) {
                const body = await response.text();
                throw new Error(body || t("filesPreviewFailed"));
              }
              return response.text();
            });
      if (selectedFile?.id !== currentId) return;
      selectedTextPreview = text;
      lastLoadedPreviewId = currentId;
    } catch (error) {
      if (selectedFile?.id !== currentId) return;
      filePreviewError = error instanceof Error ? error.message : String(error);
      lastLoadedPreviewId = currentId;
    } finally {
      if (selectedFile?.id === currentId) {
        filePreviewLoading = false;
      }
    }
  }

  async function copySelectedFilePath(): Promise<void> {
    if (!selectedFile?.local || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(selectedFile.local);
      status = t("filesPathCopied");
    } catch (error) {
      status = error instanceof Error ? `${t("errorPrefix")}${error.message}` : `${t("errorPrefix")}${String(error)}`;
    }
  }

  function parseCsvRows(content: string, limit = 12): string[][] {
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(0, limit)
      .map((line) => line.split(",").map((cell) => cell.trim()));
  }

  function prettifyTextPreview(file: PanelFileEntry, content: string): string {
    if (file.previewKind === "json") {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  }

  $: if (selectedFile?.id) {
    void loadSelectedTextPreview(selectedFile);
  } else {
    filePreviewLoading = false;
    filePreviewError = "";
    selectedTextPreview = "";
    lastLoadedPreviewId = "";
  }

  async function switchSession(sessionId: string): Promise<void> {
    if (sessionId === activeSessionId) {
      showMobileSidebar = false;
      return;
    }
    activeSessionId = sessionId;
    showMobileSidebar = false;
    await loadMessages();
    await loadSessionFiles();
  }

  function startRenameSession(session: SessionSummary): void {
    editingSessionId = session.id;
    editingSessionTitle = session.title || t("newSession");
  }

  function cancelRenameSession(): void {
    editingSessionId = "";
    editingSessionTitle = "";
  }

  async function saveRenameSession(sessionId: string): Promise<void> {
    const nextTitle = editingSessionTitle.trim();
    if (!nextTitle) {
      status = t("sessionNameCannotBeEmpty");
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: activeProfileId, title: nextTitle })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || t("failedRenameSession"));
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
      body: JSON.stringify({ profileId: activeProfileId })
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || t("failedCreateSession"));
    }
    await loadSessions();
    await switchSession(payload.session.id);
    status = "";
  }

  async function startNewChatWithProfile(selectedProfileId: string): Promise<void> {
    const nextProfileId = String(selectedProfileId ?? "").trim();
    if (nextProfileId) {
      activeProfileId = nextProfileId;
      activeProfileName = normalizeProfileName(profileNameById[activeProfileId], activeProfileId);
    }
    persistIdentity();

    activeSessionId = "";
    messages = [];
    persistedFiles = [];
    selectedFileId = "";
    selectedTextPreview = "";
    filePanelError = "";
    await loadSessions();
    await createSession();
  }

  function openNewChatDialog(): void {
    newChatProfileId = activeProfileId;
    showNewChatDialog = true;
  }

  async function confirmNewChat(): Promise<void> {
    try {
      await startNewChatWithProfile(newChatProfileId);
      showNewChatDialog = false;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function fetchRuntimeSettings(): Promise<RuntimeSettings> {
    const response = await fetch("/api/settings");
    const payload = await response.json();
    if (!response.ok || !payload?.ok || !payload?.settings) {
      throw new Error(payload?.error || t("failedLoadRuntimeSettings"));
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
        throw new Error(data?.error || t("failedUpdateModelSelection"));
      }
      runtimeSettings = data.settings as RuntimeSettings;
      modelOptions = buildModelOptions(runtimeSettings);
      activeModelKey = computeActiveModelKey(runtimeSettings);
      thinkingLevel = runtimeSettings.defaultThinkingLevel ?? thinkingLevel;
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
    const attachmentLine = `[${t("attachments")}] ${names}`;
    return trimmed ? `${trimmed}\n\n${attachmentLine}` : attachmentLine;
  }

  async function consumeSseResponse(
    response: Response
  ): Promise<{
    assistant: string;
    conversationId?: string;
    diagnostics: string[];
    thinking: string;
  }> {
    if (!response.ok || !response.body) {
      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        throw new Error(String(payload?.error ?? `${t("backendRequestFailed")} (${response.status})`));
      } catch {
        throw new Error(text || `${t("backendRequestFailed")} (${response.status})`);
      }
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload: {
      response?: string;
      conversationId?: string;
      diagnostics?: string[];
      thinkingText?: string;
    } | null = null;

    const parseBlock = (block: string): { event: string; data: string } | null => {
      const lines = block.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) return null;
      return { event: eventName, data: dataLines.join("\n") };
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (!parsed) continue;
        const payload = JSON.parse(parsed.data);

        if (parsed.event === "token") {
          streamingAssistantText += String(payload.delta ?? "");
          await scrollMessagesToBottom(true);
          continue;
        }
        if (parsed.event === "replace") {
          streamingAssistantText = String(payload.text ?? "");
          await scrollMessagesToBottom(true);
          continue;
        }
        if (parsed.event === "thinking_config") {
          streamingDiagnostics = [
            ...streamingDiagnostics,
            [
              `thinking_requested=${String(payload.requestedThinkingLevel ?? "off")}`,
              `thinking_effective=${String(payload.effectiveThinkingLevel ?? "off")}`,
              `reasoning_supported=${String(payload.reasoningSupported ?? false)}`,
              `provider=${String(payload.provider ?? "")}`,
              `model=${String(payload.model ?? "")}`
            ].join(", ")
          ];
          continue;
        }
        if (parsed.event === "payload") {
          streamingDiagnostics = [
            ...streamingDiagnostics,
            [
              `payload_provider=${String(payload.provider ?? "")}`,
              `payload_model=${String(payload.model ?? "")}`,
              `payload_api=${String(payload.api ?? "")}`,
              String(payload.summary ?? "")
            ].join(", ")
          ];
          continue;
        }
        if (parsed.event === "thinking_delta") {
          streamingThinkingText += String(payload.delta ?? "");
          await scrollMessagesToBottom(true);
          continue;
        }
        if (parsed.event === "thread_note") {
          const text = String(payload.text ?? "").trim();
          if (text) {
            streamingDiagnostics = [...streamingDiagnostics, text];
          }
          continue;
        }
        if (parsed.event === "error") {
          throw new Error(String(payload.error ?? t("backendRequestFailed")));
        }
        if (parsed.event === "done") {
          donePayload = payload;
        }
      }

      if (done) break;
    }

    const assistant = String(donePayload?.response ?? streamingAssistantText).trim() || t("emptyResponse");
    return {
      assistant,
      conversationId: typeof donePayload?.conversationId === "string" ? donePayload.conversationId : undefined,
      diagnostics: Array.isArray(donePayload?.diagnostics)
        ? donePayload.diagnostics.map((item) => String(item))
        : streamingDiagnostics,
      thinking: String(donePayload?.thinkingText ?? streamingThinkingText ?? "")
    };
  }

  async function sendStreamingText(text: string, signal?: AbortSignal): Promise<{
    assistant: string;
    conversationId?: string;
    diagnostics: string[];
    thinking: string;
  }> {
    resetStreamingState();
    const response = await fetch("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: activeProfileId,
        conversationId: activeSessionId,
        message: text,
        thinkingLevel
      }),
      signal
    });
    return consumeSseResponse(response);
  }

  async function stopCurrentRun(): Promise<void> {
    if (!activeSessionId || stopping) return;
    stopping = true;
    try {
      if (sendAbortController) sendAbortController.abort();
      const response = await fetch("/api/stream/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfileId,
          conversationId: activeSessionId
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error ?? t("backendRequestFailed")));
      }
      status = payload.stopped ? t("stopCurrentTaskDone") : t("stopCurrentTaskIdle");
    } catch (error) {
      status = error instanceof Error ? `${t("errorPrefix")}${error.message}` : `${t("errorPrefix")}${String(error)}`;
    } finally {
      stopping = false;
      sending = false;
      sendAbortController = null;
    }
  }

  async function sendMessage(): Promise<void> {
    const text = messageInput.trim();
    if ((!text && pendingFiles.length === 0) || sending || !activeSessionId) return;

    sending = true;
    resetStreamingState();
    const filesToSend = [...pendingFiles];
    const filesPayload = filesToSend.map((item) => item.file);
    messageInput = "";
    resizeComposer(composerEl);

    const userDisplay = composeUserMessageDisplay(text, filesPayload);
    messages = [...messages, { role: "user", content: userDisplay, createdAt: new Date().toISOString() }];
    await scrollMessagesToBottom(true);

    const requestController = new AbortController();
    sendAbortController = requestController;
    try {
      if (filesPayload.length === 0 && !text.startsWith("/")) {
        const streamed = await sendStreamingText(text, requestController.signal);
        messages = [
          ...messages,
          {
            role: "assistant",
            content: streamed.assistant,
            createdAt: new Date().toISOString(),
            meta: {
              diagnostics: streamed.diagnostics,
              thinking: streamed.thinking
            }
          }
        ];
        if (typeof streamed.conversationId === "string" && streamed.conversationId) {
          activeSessionId = streamed.conversationId;
        }
        await loadSessions();
        await loadSessionFiles();
        await scrollMessagesToBottom(true);
        status = "";
        return;
      }

      let response: Response;
      if (filesPayload.length > 0) {
        const form = new FormData();
        form.append("profileId", activeProfileId);
        form.append("conversationId", activeSessionId);
        form.append("message", text);
        form.append("thinkingLevel", thinkingLevel);
        for (const file of filesPayload) {
          form.append("files", file);
        }
        response = await fetch("/api/chat", {
          method: "POST",
          body: form,
          signal: requestController.signal
        });
      } else {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: activeProfileId,
            conversationId: activeSessionId,
            message: text,
            thinkingLevel
          }),
          signal: requestController.signal
        });
      }

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `${t("backendRequestFailed")} (${response.status})`);
      }
      const assistant = String(payload.response ?? "").trim() || t("emptyResponse");
      messages = [
        ...messages,
        {
          role: "assistant",
          content: assistant,
          createdAt: new Date().toISOString(),
          meta: {
            diagnostics: Array.isArray(payload.diagnostics)
              ? payload.diagnostics.map((item: unknown) => String(item))
              : [],
            thinking: ""
          }
        }
      ];
      if (typeof payload.conversationId === "string" && payload.conversationId) {
        activeSessionId = payload.conversationId;
      }
      clearPendingUploads();
      await loadSessions();
      await loadSessionFiles();
      await scrollMessagesToBottom(true);
      status = "";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        status = t("stopCurrentTaskDone");
        return;
      }
      messageInput = text;
      resizeComposer(composerEl);
      const errorText = error instanceof Error ? error.message : String(error);
      messages = [...messages, { role: "assistant", content: `${t("errorPrefix")}${errorText}`, createdAt: new Date().toISOString() }];
      await scrollMessagesToBottom(true);
    } finally {
      sending = false;
      sendAbortController = null;
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
        `/api/web/system-prompt?profileId=${encodeURIComponent(activeProfileId)}&sessionId=${encodeURIComponent(activeSessionId)}&query=${encodeURIComponent(messageInput.trim())}`
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || t("failedLoadSystemPromptPreview"));
      }
      promptPreviewText = String(payload.prompt ?? "");
      promptSources = payload.sources ?? { global: [], agent: [], bot: [] };
    } catch (error) {
      promptPreviewText = `${t("errorPrefix")}${error instanceof Error ? error.message : String(error)}`;
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
    pendingFiles = [...pendingFiles, ...files.map(createPendingUpload)];
    showFilesPanel = true;
    input.value = "";
  }

  function removePendingFile(index: number): void {
    const target = pendingFiles[index];
    if (target) releasePendingUpload(target);
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
    resetStreamingState();
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
      form.append("profileId", activeProfileId);
      form.append("conversationId", activeSessionId);
      form.append("message", "");
      form.append("thinkingLevel", thinkingLevel);
      form.append("files", file);

      const response = await fetch("/api/chat", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `${t("backendRequestFailed")} (${response.status})`);
      }
      const assistant = String(payload.response ?? "").trim() || t("emptyResponse");
      messages = [
        ...messages,
        {
          role: "assistant",
          content: assistant,
          createdAt: new Date().toISOString(),
          meta: {
            diagnostics: Array.isArray(payload.diagnostics)
              ? payload.diagnostics.map((item: unknown) => String(item))
              : [],
            thinking: ""
          }
        }
      ];
      if (typeof payload.conversationId === "string" && payload.conversationId) {
        activeSessionId = payload.conversationId;
      }
      await loadSessions();
      await loadSessionFiles();
      await scrollMessagesToBottom(true);
      status = "";
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      messages = [...messages, { role: "assistant", content: `${t("errorPrefix")}${errorText}`, createdAt: new Date().toISOString() }];
      await scrollMessagesToBottom(true);
    } finally {
      sending = false;
      composerEl?.focus();
    }
  }

  async function startVoiceRecording(): Promise<void> {
    if (preparingRecording || isRecording || sending) return;
    if (!activeSessionId) {
      status = t("pleaseSelectSessionFirst");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status = t("browserNoMicSupport");
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
          status = t("noVoiceCaptured");
          return;
        }

        const blob = new Blob(chunks, { type: finalMime });
        const extension = finalMime.includes("mp4") || finalMime.includes("m4a") ? "m4a" : "webm";
        const voiceFile = new File([blob], `voice-${Date.now()}.${extension}`, { type: finalMime });
        await sendVoiceFile(voiceFile);
      };
      recorder.onerror = () => {
        status = t("voiceRecordFailed");
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
      status = error instanceof Error ? `${t("micUnavailable")} ${error.message}` : t("micUnavailable");
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

  function resolveShouldUseDark(mode: ThemeMode): boolean {
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyTheme(mode: ThemeMode): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", resolveShouldUseDark(mode));
    root.setAttribute("data-theme-mode", mode);
  }

  function applyLocale(nextLocale: LocaleKey): void {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("lang", nextLocale);
  }

  function onThemeModeChange(event: Event): void {
    themeMode = (event.target as HTMLSelectElement).value as ThemeMode;
    applyTheme(themeMode);
    localStorage.setItem(LS_THEME, themeMode);
  }

  function onLocaleChange(event: Event): void {
    setLocale((event.target as HTMLSelectElement).value as LocaleKey);
  }

  onMount(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (themeMode === "system") applyTheme("system");
    };
    let unsubscribeLocale: (() => void) | undefined;
    media.addEventListener("change", handleSystemThemeChange);

    void (async () => {
      try {
        const storedTheme = String(localStorage.getItem(LS_THEME) ?? "light");
        themeMode = storedTheme === "system" || storedTheme === "dark" ? storedTheme : "light";
        applyTheme(themeMode);

        initLocale();
        unsubscribeLocale = localeStore.subscribe((nextLocale) => {
          locale = nextLocale;
          applyLocale(nextLocale);
        });

        activeProfileId = String(localStorage.getItem(LS_PROFILE) ?? "default") || "default";
        void loadVersionInfo();

        runtimeSettings = await fetchRuntimeSettings();
        applyWebProfilesFromSettings(runtimeSettings);
        modelOptions = buildModelOptions(runtimeSettings);
        activeModelKey = computeActiveModelKey(runtimeSettings);
        thinkingLevel = runtimeSettings.defaultThinkingLevel ?? "off";

        await loadSessions();
        await ensureActiveSession();
        await loadMessages();
        await loadSessionFiles();
        status = "";
        persistIdentity();
        await tick();
        resizeComposer(composerEl);
      } catch (error) {
        status = error instanceof Error ? error.message : String(error);
      }
    })();

    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
      unsubscribeLocale?.();
    };
  });

  onDestroy(() => {
    stopRecordingTimer();
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    cleanupRecordingStream();
    clearPendingUploads();
  });
</script>

<main class="chat-shell relative h-[100dvh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
  <div class="flex h-full">
    {#if showMobileSidebar}
      <button
        class="absolute inset-0 z-20 bg-black/30 lg:hidden"
        type="button"
        aria-label={t("closeSidebar")}
        on:click={() => (showMobileSidebar = false)}
      ></button>
    {/if}

    <aside
      class={`chat-sidebar absolute inset-y-0 left-0 z-30 flex w-[300px] flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] transition-transform duration-200 lg:static lg:z-0 lg:w-[330px] lg:translate-x-0 ${showMobileSidebar ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div class="flex h-[56px] items-center gap-1 border-b border-[var(--sidebar-border)] px-3">
        <button class="flex h-9 w-9 items-center justify-center rounded-md text-[var(--sidebar-primary)] hover:bg-[var(--sidebar-accent)]" type="button" aria-label={t("conversations")}>
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5h14v10H8l-3 3V5Z" /></svg>
        </button>
        <a class="flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]" href="/settings" aria-label={t("settings")}>
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 8v8M8 12h8" /><path d="M5 4h14v16H5z" /></svg>
        </a>
        <button class="flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]" type="button" on:click={openSystemPromptPreview} aria-label={t("previewSystemPrompt")}>
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4 7l8 4 8-4-8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 17 8 4 8-4" /></svg>
        </button>
        <button class="flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]" type="button" aria-label={t("thinkingMode")}>
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M8 14a6 6 0 1 1 8 0c-.8.7-1 1.3-1 2H9c0-.7-.2-1.3-1-2Z" /></svg>
        </button>
        <button class="flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]" type="button" on:click={() => (showFilesPanel = !showFilesPanel)} aria-label={showFilesPanel ? t("closeFiles") : t("openFiles")}>
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h6l2 2h8v10H4V6Z" /></svg>
        </button>
      </div>

      <div class="space-y-3 border-b border-[var(--sidebar-border)] px-3 py-4">
        <button
          class="flex w-full items-center justify-between rounded-lg border border-[color-mix(in_oklab,var(--sidebar-primary)_30%,var(--sidebar-border))] bg-[color-mix(in_oklab,var(--sidebar-primary)_7%,var(--card))] px-4 py-3 text-left text-sm font-semibold text-[var(--sidebar-primary)] shadow-[var(--shadow-sm)] transition hover:bg-[color-mix(in_oklab,var(--sidebar-primary)_11%,var(--card))]"
          type="button"
          on:click={openNewChatDialog}
        >
          <span class="inline-flex items-center gap-2"><span class="text-base leading-none">+</span>{t("newChat").replace("+ ", "")}</span>
          <span class="text-[11px] font-medium text-[var(--muted-foreground)]">{t("commandShortcut")}</span>
        </button>

        <input
          class="w-full rounded-lg border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_72%,var(--sidebar))] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
          type="text"
          bind:value={sessionSearch}
          placeholder={t("filterConversations")}
        />

        <div class="flex flex-wrap gap-2 text-xs">
          <span class="rounded-full border border-[var(--sidebar-border)] bg-[var(--sidebar-accent)] px-3 py-1.5 font-semibold text-[var(--sidebar-primary)]">{t("all")}</span>
          <span class="rounded-full border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_64%,transparent)] px-3 py-1.5 text-[var(--muted-foreground)]">{t("thisProfile")}</span>
          <span class="rounded-full border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_64%,transparent)] px-3 py-1.5 text-[var(--muted-foreground)]">{activeProfileName}</span>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div class="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          <span class="text-[var(--accent-foreground)]">+</span>{t("pinned")}
        </div>
        {#if filteredSessions.length === 0}
          <div class="rounded-lg border border-dashed border-[var(--sidebar-border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
            {t("noMatchingConversations")}
          </div>
        {:else}
          {#each filteredSessions as s}
            <div
              class={`group w-full rounded-lg border px-2.5 py-2.5 text-left transition ${s.id === activeSessionId
                ? "border-[color-mix(in_oklab,var(--sidebar-primary)_28%,var(--sidebar-border))] bg-[color-mix(in_oklab,var(--sidebar-primary)_12%,var(--sidebar-accent))]"
                : "border-transparent hover:border-[var(--sidebar-border)] hover:bg-[var(--sidebar-accent)]"}`}
            >
              {#if editingSessionId === s.id}
                <div class="space-y-2">
                  <input
                    class="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm outline-none focus:border-[var(--ring)]"
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
                      class="rounded-md border border-[var(--primary)] px-2 py-1 text-[10px] text-[var(--primary)]"
                      type="button"
                      on:click={async () => saveRenameSession(s.id)}
                    >
                      {t("save")}
                    </button>
                    <button
                      class="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)]"
                      type="button"
                      on:click={cancelRenameSession}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              {:else}
                <button class="w-full text-left" type="button" on:click={() => switchSession(s.id)} on:dblclick={() => startRenameSession(s)}>
                  <div class="flex items-center gap-2">
                    <span class={`text-sm ${s.id === activeSessionId ? "text-[var(--sidebar-primary)]" : "text-[var(--muted-foreground)]"}`}>+</span>
                    <p class="line-clamp-1 text-sm font-medium">{s.title || t("newSession")}</p>
                  </div>
                  <p class="mt-1 pl-5 text-[11px] text-[var(--muted-foreground)]">{formatSessionTime(s.updatedAt)}</p>
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <div class="border-t border-[var(--sidebar-border)] p-3">
        <div class="rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_74%,var(--sidebar))] p-3 shadow-[var(--shadow-sm)]">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--sidebar-border)] bg-[var(--accent)] text-sm font-bold text-[var(--accent-foreground)]">M</div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">Molibot WebUI</p>
              <p class="truncate text-[11px] text-[var(--muted-foreground)]">{activeProfileName}</p>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <select
              class="min-w-0 rounded-lg border border-[var(--sidebar-border)] bg-[var(--card)] px-2 py-1.5 text-xs outline-none"
              bind:value={themeMode}
              on:change={onThemeModeChange}
              aria-label={t("theme")}
            >
              <option value="system">{t("system")}</option>
              <option value="light">{t("light")}</option>
              <option value="dark">{t("dark")}</option>
            </select>
            <select
              class="min-w-0 rounded-lg border border-[var(--sidebar-border)] bg-[var(--card)] px-2 py-1.5 text-xs outline-none"
              bind:value={locale}
              on:change={onLocaleChange}
              aria-label={t("language")}
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
        </div>
      </div>
    </aside>

    <section class="chat-main-pane flex min-w-0 flex-1 flex-col bg-[color-mix(in_oklab,var(--background)_92%,var(--card))]">
      <header class="chat-topbar h-auto border-b border-[var(--border)] bg-[var(--background)] px-4 py-4 sm:px-7">
        <div class="flex items-center gap-3">
          <button
            class="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-xs transition hover:bg-[var(--muted)] lg:hidden"
            type="button"
            on:click={() => (showMobileSidebar = true)}
            aria-label={t("openSidebar")}
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>

          <div class="min-w-0 flex-1">
            <h1 class="truncate text-lg font-semibold sm:text-xl">{activeSessionTitle}</h1>
            <p class="mt-1 text-sm text-[var(--muted-foreground)]">{messages.length} {t("messageCount")}</p>
          </div>

          <div class="ml-auto flex items-center gap-2">
            <div class="relative">
              <button
                class={`inline-flex min-w-[6.75rem] items-center justify-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold leading-none shadow-[var(--shadow-sm)] transition hover:bg-[var(--muted)] ${
                  versionInfo?.updateAvailable
                    ? "border-[color-mix(in_oklab,var(--accent)_70%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_18%,var(--card))] text-[var(--accent-foreground)]"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
                }`}
                type="button"
                on:click={() => (showVersionPanel = !showVersionPanel)}
                aria-label={t("version")}
              >
                <span class={`h-2.5 w-2.5 shrink-0 rounded-full ${versionInfo?.updateAvailable ? "bg-[var(--accent)]" : "bg-[var(--muted-foreground)]"}`}></span>
                <span class="font-mono tabular-nums">{versionBadgeLabel()}</span>
              </button>
              {#if showVersionPanel}
                <div class="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm shadow-[var(--shadow-md)]">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{t("version")}</p>
                      <p class="mt-1 font-semibold text-[var(--foreground)]">{versionStatusLabel()}</p>
                    </div>
                    <button
                      class="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]"
                      type="button"
                      on:click={loadVersionInfo}
                      disabled={versionLoading}
                    >
                      {versionLoading ? t("checkingVersion") : t("checkVersion")}
                    </button>
                  </div>
                  <dl class="mt-4 space-y-2 text-xs">
                    <div class="flex justify-between gap-4">
                      <dt class="text-[var(--muted-foreground)]">{t("currentVersion")}</dt>
                      <dd class="font-mono text-[var(--foreground)]">v{versionInfo?.currentVersion ?? "..."}</dd>
                    </div>
                    <div class="flex justify-between gap-4">
                      <dt class="text-[var(--muted-foreground)]">{t("latestVersion")}</dt>
                      <dd class="font-mono text-[var(--foreground)]">{versionInfo?.latestVersion ? `v${versionInfo.latestVersion}` : "-"}</dd>
                    </div>
                    {#if versionInfo?.repository}
                      <div class="flex justify-between gap-4">
                        <dt class="text-[var(--muted-foreground)]">GitHub</dt>
                        <dd class="max-w-40 truncate text-[var(--foreground)]">{versionInfo.repository}</dd>
                      </div>
                    {/if}
                  </dl>
                  {#if versionInfo?.updateAvailable}
                    <p class="mt-3 rounded-md border border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-3 py-2 text-xs text-[var(--foreground)]">
                      {t("updateWithManager")}
                    </p>
                  {:else if versionInfo?.error}
                    <p class="mt-3 text-xs text-[var(--muted-foreground)]">{versionInfo.error}</p>
                  {/if}
                </div>
              {/if}
            </div>
            <button
              class="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-semibold text-[var(--primary)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--muted)]"
              type="button"
              on:click={() => (showFilesPanel = !showFilesPanel)}
              aria-label={showFilesPanel ? t("closeFiles") : t("openFiles")}
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h6l2 2h8v10H4V6Z" /></svg>
              {t("files")} {allPanelFiles.length > 0 ? `(${allPanelFiles.length})` : ""}
            </button>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-hidden bg-[var(--background)]">
        <div class="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-4 sm:px-7">
          {#if status}
            <div class="chat-status-banner mb-3 rounded-lg border border-[color-mix(in_oklab,var(--destructive)_55%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] px-4 py-3 text-xs text-[var(--foreground)] shadow-[var(--shadow-sm)]">{status}</div>
          {/if}

          <div
            class="min-h-0 flex-1 overflow-y-auto px-1 py-2 sm:px-2"
            bind:this={messagesContainer}
          >
            {#if loadingMessages}
              <div class="chat-empty-card rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
                {t("loadingMessages")}
              </div>
            {:else if messages.length === 0}
              <div class="mx-auto mt-16 max-w-2xl text-center text-sm text-[var(--muted-foreground)]">
                <p class="text-xl font-semibold text-[var(--foreground)]">{t("emptyTimelineTitle")}</p>
                <p class="mt-2 leading-6">{t("emptyTimelineHint")}</p>
                <div class="mt-6 flex flex-wrap justify-center gap-2">
                  {#each QUICK_PROMPTS as prompt}
                    <button
                      class="chat-file-chip rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-[var(--shadow-sm)] transition hover:bg-[var(--muted)]"
                      type="button"
                      on:click={() => sendQuickPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="space-y-7 pb-4">
                {#each messages as m}
                  <article class="flex gap-3">
                    <div class={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${m.role === "user"
                      ? "border-[color-mix(in_oklab,var(--primary)_28%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_12%,var(--card))] text-[var(--primary)]"
                      : "border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-[var(--accent)] text-[var(--accent-foreground)]"}`}>
                      {m.role === "user" ? "Y" : "M"}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="mb-2 flex items-baseline gap-3">
                        <div class={`text-sm font-semibold ${m.role === "user" ? "text-[var(--primary)]" : "text-[var(--accent-foreground)]"}`}>
                          {m.role === "user" ? t("you") : "Molibot"}
                        </div>
                        <div class="text-xs text-[var(--muted-foreground)]">{formatMessageTime(m.createdAt)}</div>
                      </div>
                      {#if m.role === "assistant" && ((m.meta?.diagnostics?.length ?? 0) > 0 || m.meta?.thinking)}
                        <details class="chat-thinking-panel mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-xs leading-6 text-[var(--muted-foreground)]">
                          <summary class="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground)]">
                            {t("thinkingDetails")}
                          </summary>
                          <div class="mt-3">
                            {#if (m.meta?.diagnostics?.length ?? 0) > 0}
                              <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em]">{t("requestTrace")}</div>
                              {#each m.meta?.diagnostics ?? [] as line}
                                <div class="break-words">{line}</div>
                              {/each}
                            {/if}
                            <div class={`${(m.meta?.diagnostics?.length ?? 0) > 0 ? "mt-3" : ""} text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground)]`}>
                              {t("thinkingProcess")}
                            </div>
                            <div class="mt-2 whitespace-pre-wrap break-words">
                              {m.meta?.thinking || t("noThinkingSeen")}
                            </div>
                          </div>
                        </details>
                      {/if}
                      {#if m.role === "assistant"}
                        <div class="markdown-body max-w-3xl break-words text-[15px] leading-8">
                          {@html renderMarkdown(m.content)}
                        </div>
                      {:else}
                        <div class="max-w-3xl whitespace-pre-wrap break-words text-[15px] leading-8">{m.content}</div>
                      {/if}
                    </div>
                  </article>
                {/each}

                {#if sending}
                  <article class="flex gap-3">
                    <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-[var(--accent)] text-xs font-bold text-[var(--accent-foreground)]">M</div>
                    <div class="min-w-0 flex-1 text-sm text-[var(--muted-foreground)]">
                      <div class="mb-2 flex items-baseline gap-3">
                        <div class="text-sm font-semibold text-[var(--accent-foreground)]">Molibot</div>
                        <div class="text-xs text-[var(--muted-foreground)]">{t("liveAnswer")}</div>
                      </div>
                      {#if streamingDiagnostics.length > 0 || streamingThinkingText}
                        <details class="chat-thinking-panel mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-xs leading-6" open>
                          <summary class="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground)]">
                            {t("thinkingDetails")}
                          </summary>
                          <div class="mt-3">
                            {#if streamingDiagnostics.length > 0}
                              <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground)]">
                                {t("requestTrace")}
                              </div>
                              {#each streamingDiagnostics as line}
                                <div class="break-words">{line}</div>
                              {/each}
                            {/if}
                            <div class={`${streamingDiagnostics.length > 0 ? "mt-3" : ""} text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--foreground)]`}>
                              {t("thinkingProcess")}
                            </div>
                            <div class="mt-2 whitespace-pre-wrap break-words">
                              {streamingThinkingText || t("noThinkingSeen")}
                            </div>
                          </div>
                        </details>
                      {/if}
                      <div class="markdown-body max-w-3xl break-words text-[15px] leading-8">
                        {@html renderMarkdown(streamingAssistantText || t("thinking"))}
                      </div>
                    </div>
                  </article>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <footer class="border-t border-[var(--border)] bg-[var(--background)] px-4 py-4 sm:px-7">
        <div class="chat-composer-shell mx-auto w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow)]">
          {#if pendingFiles.length > 0}
            <div class="mb-3 flex flex-wrap gap-2">
              {#each pendingFiles as upload, index}
                <div class="chat-file-chip flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--secondary)] px-3 py-1 text-xs shadow-[var(--shadow-sm)]">
                  <button
                    class="flex min-w-0 items-center gap-2 text-left"
                    type="button"
                    on:click={() => {
                      showFilesPanel = true;
                      selectedFileId = upload.id;
                    }}
                  >
                    <span class="truncate max-w-[180px]">{upload.file.name}</span>
                    <span class="text-[10px] text-[var(--muted-foreground)]">{formatFileSize(upload.file.size)}</span>
                    <span class="text-[10px] text-[var(--muted-foreground)]">{panelPreviewKindLabel(classifyFilePreview({ name: upload.file.name, mimeType: upload.file.type }))}</span>
                  </button>
                  <button
                    class="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted-foreground)]"
                    type="button"
                    aria-label={t("cancel")}
                    on:click={() => removePendingFile(index)}
                  >
                    ×
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          <textarea
            class="max-h-[220px] min-h-[54px] w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-3 text-[15px] leading-7 outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--border)]"
            bind:this={composerEl}
            bind:value={messageInput}
            rows="1"
            placeholder={t("askAnything")}
            on:keydown={onComposerKeydown}
            on:input={onComposerInput}
          ></textarea>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <label class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted-foreground)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--muted)]" aria-label={t("filesAttach")}>
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14" /></svg>
                <input class="hidden" type="file" multiple on:change={onFileSelect} />
              </label>
              <button
                class={`flex h-9 w-9 items-center justify-center rounded-full transition ${isRecording
                  ? "border border-[var(--destructive)] bg-[var(--card)] text-[var(--destructive)] shadow-[var(--shadow-sm)] hover:bg-[var(--muted)]"
                  : "border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)] hover:bg-[var(--muted)]"}`}
                type="button"
                disabled={preparingRecording || sending}
                on:click={toggleVoiceRecording}
                aria-label={t("recordVoice")}
              >
                {#if preparingRecording}
                  ...
                {:else if isRecording}
                  {formatRecordingTime(recordingSeconds)}
                {:else}
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v8" /><path d="M8 8v4a4 4 0 0 0 8 0V8" /><path d="M5 12a7 7 0 0 0 14 0" /><path d="M12 19v3" /></svg>
                {/if}
              </button>
              <span class="hidden h-5 w-px bg-[var(--border)] sm:inline-block"></span>
              <span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-[var(--muted-foreground)]">
                <svg class="h-4 w-4 text-[var(--primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4 22a8 8 0 0 1 16 0" /></svg>
                {activeProfileName}
              </span>
              <span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-[var(--muted-foreground)]">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h6l2 2h8v10H4V6Z" /></svg>
                {t("home")}
              </span>
              <select
                class="max-w-[240px] rounded-full border border-transparent bg-transparent px-2 py-1 text-xs font-semibold text-[var(--muted-foreground)] outline-none hover:bg-[var(--muted)] focus:border-[var(--ring)]"
                value={activeModelKey}
                disabled={changingModel || modelOptions.length === 0}
                on:change={async (e) => applyModelSelection((e.target as HTMLSelectElement).value)}
              >
                {#each modelOptions as m}
                  <option value={m.key}>{m.label}</option>
                {/each}
              </select>
              <select
                class="rounded-full border border-transparent bg-transparent px-2 py-1 text-xs font-semibold text-[var(--muted-foreground)] outline-none hover:bg-[var(--muted)] focus:border-[var(--ring)]"
                bind:value={thinkingLevel}
                aria-label={t("thinkingMode")}
              >
                <option value="off">{t("thinkingMode")}: {t("thinkingOff")}</option>
                <option value="low">{t("thinkingMode")}: {t("thinkingLow")}</option>
                <option value="medium">{t("thinkingMode")}: {t("thinkingMedium")}</option>
                <option value="high">{t("thinkingMode")}: {t("thinkingHigh")}</option>
              </select>
            </div>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={stopping || !activeSessionId}
              on:click={stopCurrentRun}
              aria-label={t("stop")}
            >
              {#if stopping}
                ...
              {:else}
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
              {/if}
            </button>
            <button
              class="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={sending || (!messageInput.trim() && pendingFiles.length === 0)}
              on:click={sendMessage}
              aria-label={t("send")}
            >
              {#if sending}
                ...
              {:else}
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
              {/if}
            </button>
          </div>
        </div>
      </footer>
    </section>

    {#if showFilesPanel}
      <aside class="chat-files-pane absolute inset-y-0 right-0 z-30 flex w-[min(460px,100vw)] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--sidebar)] shadow-[var(--shadow-lg)] xl:static xl:z-0 xl:w-[460px] xl:shadow-none">
        <div class="flex h-[56px] items-center gap-3 border-b border-[var(--sidebar-border)] px-4">
          <p class="flex-1 text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted-foreground)]">{t("workspace")}</p>
          <span class="rounded-md bg-[var(--muted)] px-2 py-1 text-[10px] font-bold text-[var(--muted-foreground)]">
            {filteredPanelFiles.length}/{allPanelFiles.length}
          </span>
          <button class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--sidebar-accent)]" type="button" on:click={() => (showFilesPanel = false)} aria-label={t("closeFiles")}>
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div class="rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_74%,transparent)] p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">{t("filesWorkspaceTitle")}</p>
                <p class="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">{t("filesWorkspaceHint")}</p>
              </div>
              <button
                class="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                type="button"
                on:click={loadSessionFiles}
                disabled={filePanelLoading || !activeSessionId}
              >
                {t("filesRefresh")}
              </button>
            </div>
            <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                class="rounded-lg border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_72%,var(--sidebar))] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
                bind:value={fileSearch}
                placeholder={t("filesSearch")}
              />
              <select
                class="rounded-lg border border-[var(--sidebar-border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                bind:value={fileTypeFilter}
              >
                <option value="all">{t("filesFilterAll")}</option>
                <option value="image">{t("filesFilterImage")}</option>
                <option value="audio">{t("filesFilterAudio")}</option>
                <option value="video">{t("filesFilterVideo")}</option>
                <option value="pdf">{t("filesFilterPdf")}</option>
                <option value="text">{t("filesFilterText")}</option>
                <option value="code">{t("filesFilterCode")}</option>
                <option value="data">{t("filesFilterData")}</option>
                <option value="office">{t("filesFilterOffice")}</option>
                <option value="other">{t("filesFilterOther")}</option>
              </select>
            </div>
          </div>

          {#if filePanelError}
            <div class="rounded-xl border border-[color-mix(in_oklab,var(--destructive)_36%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))] px-4 py-3 text-sm text-[var(--destructive)]">
              {filePanelError}
            </div>
          {/if}

          <div class="grid min-h-0 flex-1 gap-4 xl:grid-rows-[minmax(220px,0.95fr)_minmax(260px,1.05fr)]">
            <section class="min-h-0 rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_68%,transparent)] p-3">
              <div class="mb-3 flex items-center justify-between gap-3">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">{t("filesWorkspaceTitle")}</p>
                {#if filePanelLoading}
                  <span class="text-[11px] text-[var(--muted-foreground)]">{t("filesLoading")}</span>
                {/if}
              </div>

              {#if filePanelLoading && allPanelFiles.length === 0}
                <div class="rounded-lg border border-dashed border-[var(--sidebar-border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  {t("filesLoading")}
                </div>
              {:else if filteredPanelFiles.length === 0}
                <div class="rounded-lg border border-dashed border-[var(--sidebar-border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  <p class="font-semibold text-[var(--foreground)]">{t("filesEmptyTitle")}</p>
                  <p class="mt-2 leading-6">{t("filesEmptyHint")}</p>
                </div>
              {:else}
                <div class="space-y-4 overflow-y-auto pr-1">
                  {#if pendingPanelFiles.length > 0}
                    <div class="space-y-2">
                      <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{t("filesPendingGroup")}</p>
                      {#each pendingPanelFiles as file}
                        <button
                          class={`w-full rounded-xl border px-3 py-3 text-left transition ${selectedFile?.id === file.id
                            ? "border-[color-mix(in_oklab,var(--primary)_34%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))]"
                            : "border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_82%,transparent)] hover:border-[color-mix(in_oklab,var(--primary)_24%,var(--border))] hover:bg-[color-mix(in_oklab,var(--muted)_44%,var(--card))]"}`}
                          type="button"
                          on:click={() => (selectedFileId = file.id)}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <p class="truncate text-sm font-semibold text-[var(--foreground)]">{file.original}</p>
                              <p class="mt-1 text-xs text-[var(--muted-foreground)]">{panelPreviewKindLabel(file.previewKind)} · {formatFileSize(file.size)}</p>
                            </div>
                            <span class="rounded-full border border-[var(--sidebar-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                              {t("filesSourcePending")}
                            </span>
                          </div>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if sessionPanelFiles.length > 0}
                    <div class="space-y-2">
                      <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{t("filesSessionGroup")}</p>
                      {#each sessionPanelFiles as file}
                        <button
                          class={`w-full rounded-xl border px-3 py-3 text-left transition ${selectedFile?.id === file.id
                            ? "border-[color-mix(in_oklab,var(--primary)_34%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))]"
                            : "border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_82%,transparent)] hover:border-[color-mix(in_oklab,var(--primary)_24%,var(--border))] hover:bg-[color-mix(in_oklab,var(--muted)_44%,var(--card))]"}`}
                          type="button"
                          on:click={() => (selectedFileId = file.id)}
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <p class="truncate text-sm font-semibold text-[var(--foreground)]">{file.original}</p>
                              <p class="mt-1 text-xs text-[var(--muted-foreground)]">{panelPreviewKindLabel(file.previewKind)} · {formatFileSize(file.size)}</p>
                            </div>
                            <span class="rounded-full border border-[var(--sidebar-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                              {formatFileDate(file.createdAt)}
                            </span>
                          </div>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </section>

            <section class="min-h-0 rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_68%,transparent)] p-3">
              <div class="mb-3 flex items-center justify-between gap-3">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">{t("filesPreview")}</p>
                {#if selectedFile}
                  <div class="flex items-center gap-2">
                    {#if selectedFile.source === "persisted"}
                      <a
                        class="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                        href={buildPersistedFileUrl(selectedFile.id, true)}
                      >
                        {t("filesDownload")}
                      </a>
                    {:else if selectedFile.previewUrl}
                      <a
                        class="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                        href={selectedFile.previewUrl}
                        download={selectedFile.original}
                      >
                        {t("filesDownload")}
                      </a>
                    {/if}
                    {#if selectedFile.local}
                      <button
                        class="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                        type="button"
                        on:click={copySelectedFilePath}
                      >
                        {t("filesCopyPath")}
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>

              {#if !selectedFile}
                <div class="rounded-lg border border-dashed border-[var(--sidebar-border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
                  {t("filesEmptyHint")}
                </div>
              {:else}
                <div class="grid min-h-0 gap-3">
                  <div class="rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_82%,transparent)] px-3 py-3">
                    <p class="text-sm font-semibold text-[var(--foreground)]">{selectedFile.original}</p>
                    <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span class="rounded-full border border-[var(--sidebar-border)] px-2 py-0.5">{panelPreviewKindLabel(selectedFile.previewKind)}</span>
                      <span class="rounded-full border border-[var(--sidebar-border)] px-2 py-0.5">{formatFileSize(selectedFile.size)}</span>
                      <span class="rounded-full border border-[var(--sidebar-border)] px-2 py-0.5">{selectedFile.source === "pending" ? t("filesSourcePending") : t("filesSourcePersisted")}</span>
                    </div>
                  </div>

                  <div class="min-h-[200px] rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_82%,transparent)] p-3">
                    {#if selectedFile.previewKind === "image"}
                      <img
                        class="max-h-[360px] w-full rounded-lg object-contain"
                        src={selectedFile.source === "pending" ? selectedFile.previewUrl : buildPersistedFileUrl(selectedFile.id)}
                        alt={selectedFile.original}
                      />
                    {:else if selectedFile.previewKind === "audio"}
                      <audio class="w-full" controls src={selectedFile.source === "pending" ? selectedFile.previewUrl : buildPersistedFileUrl(selectedFile.id)}></audio>
                    {:else if selectedFile.previewKind === "video"}
                      <!-- svelte-ignore a11y_media_has_caption -->
                      <video class="max-h-[320px] w-full rounded-lg bg-black/20" controls src={selectedFile.source === "pending" ? selectedFile.previewUrl : buildPersistedFileUrl(selectedFile.id)}></video>
                    {:else if selectedFile.previewKind === "pdf"}
                      <iframe
                        class="h-[360px] w-full rounded-lg border border-[var(--sidebar-border)] bg-white"
                        src={selectedFile.source === "pending" ? selectedFile.previewUrl : buildPersistedFileUrl(selectedFile.id)}
                        title={selectedFile.original}
                      ></iframe>
                    {:else if isTextPreviewKind(selectedFile.previewKind)}
                      {#if filePreviewLoading}
                        <div class="rounded-lg border border-dashed border-[var(--sidebar-border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
                          {t("filesLoading")}
                        </div>
                      {:else if filePreviewError}
                        <div class="rounded-lg border border-[color-mix(in_oklab,var(--destructive)_36%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))] px-3 py-4 text-xs text-[var(--destructive)]">
                          {t("filesPreviewFailed")}: {filePreviewError}
                        </div>
                      {:else if selectedFile.previewKind === "markdown"}
                        <div class="markdown-body max-h-[360px] overflow-y-auto break-words text-sm leading-7">
                          {@html renderMarkdown(selectedTextPreview)}
                        </div>
                      {:else if selectedFile.previewKind === "csv"}
                        {@const rows = parseCsvRows(selectedTextPreview)}
                        <div class="max-h-[360px] overflow-auto rounded-lg border border-[var(--sidebar-border)]">
                          <table class="min-w-full text-left text-xs">
                            <tbody>
                              {#each rows as row}
                                <tr>
                                  {#each row as cell}
                                    <td class="border-b border-[var(--sidebar-border)] px-2 py-1.5 text-[var(--foreground)]">{cell}</td>
                                  {/each}
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                      {:else}
                        <pre class="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] p-3 text-xs leading-6 text-[var(--foreground)]">{prettifyTextPreview(selectedFile, selectedTextPreview)}</pre>
                      {/if}
                    {:else}
                      <div class="rounded-lg border border-dashed border-[var(--sidebar-border)] px-3 py-4 text-xs text-[var(--muted-foreground)]">
                        {t("filesPreviewUnavailable")}
                      </div>
                    {/if}
                  </div>

                  <div class="rounded-xl border border-[var(--sidebar-border)] bg-[color-mix(in_oklab,var(--card)_82%,transparent)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
                    <p class="font-semibold text-[var(--foreground)]">{t("filesDetails")}</p>
                    <div class="mt-3 space-y-2">
                      <div><span class="text-[var(--foreground)]">{t("filesType")}:</span> {selectedFile.mimeType || panelPreviewKindLabel(selectedFile.previewKind)}</div>
                      <div><span class="text-[var(--foreground)]">{t("filesSize")}:</span> {formatFileSize(selectedFile.size)}</div>
                      <div><span class="text-[var(--foreground)]">{t("filesCreatedAt")}:</span> {selectedFile.source === "pending" ? t("filesNotSentYet") : formatFileDate(selectedFile.createdAt)}</div>
                      <div><span class="text-[var(--foreground)]">{t("attachments")}:</span> {selectedFile.source === "pending" ? t("filesSourcePending") : t("filesSourcePersisted")}</div>
                      {#if selectedFile.local}
                        <div class="break-all"><span class="text-[var(--foreground)]">Path:</span> {selectedFile.local}</div>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            </section>
          </div>
        </div>
      </aside>
    {/if}
  </div>

  {#if showPromptPreview}
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div class="chat-modal-card flex h-[85dvh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div class="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 class="text-sm font-semibold">{t("systemPromptPreview")} ({activeProfileName})</h2>
          <button class="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs" type="button" on:click={() => (showPromptPreview = false)}>{t("close")}</button>
        </div>
        <div class="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[300px_1fr]">
          <div class="min-h-0 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 text-xs">
            <p class="mb-2 font-semibold">{t("sources")}</p>
            <p class="mt-2 text-[var(--muted-foreground)]">{t("global")}</p>
            {#each promptSources.global as item}
              <p class="break-all">• {item}</p>
            {/each}
            <p class="mt-3 text-[var(--muted-foreground)]">{t("agent")}</p>
            {#if promptSources.agent.length === 0}
              <p>{t("none")}</p>
            {:else}
              {#each promptSources.agent as item}
                <p class="break-all">• {item}</p>
              {/each}
            {/if}
            <p class="mt-3 text-[var(--muted-foreground)]">{t("botWebProfile")}</p>
            {#if promptSources.bot.length === 0}
              <p>{t("none")}</p>
            {:else}
              {#each promptSources.bot as item}
                <p class="break-all">• {item}</p>
              {/each}
            {/if}
          </div>
          <pre class="min-h-0 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 text-xs leading-6">{loadingPromptPreview ? t("loadingPreview") : promptPreviewText}</pre>
        </div>
      </div>
    </div>
  {/if}

  {#if showNewChatDialog}
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div class="chat-modal-card w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 class="text-base font-semibold">{t("startNewChat")}</h2>
        <p class="mt-1 text-xs text-[var(--muted-foreground)]">{t("chooseProfileForNewChat")}</p>

        <label class="mt-4 grid gap-1.5 text-sm">
          <span class="text-[var(--muted-foreground)]">{t("webProfile")}</span>
          <select
            class="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
            bind:value={newChatProfileId}
          >
            {#each Object.entries(profileNameById) as [profileId, profileName]}
              <option value={profileId}>{profileName} ({profileId})</option>
            {/each}
          </select>
        </label>

        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs" type="button" on:click={() => (showNewChatDialog = false)}>
            {t("cancel")}
          </button>
          <button class="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)]" type="button" on:click={confirmNewChat}>
            {t("createChat")}
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(.markdown-body > :first-child) {
    margin-top: 0;
  }

  :global(.markdown-body > :last-child) {
    margin-bottom: 0;
  }

  :global(.markdown-body p) {
    margin: 0.7rem 0;
  }

  :global(.markdown-body h1),
  :global(.markdown-body h2),
  :global(.markdown-body h3),
  :global(.markdown-body h4),
  :global(.markdown-body h5),
  :global(.markdown-body h6) {
    margin: 1.15rem 0 0.55rem;
    color: var(--foreground);
    font-weight: 700;
    line-height: 1.35;
  }

  :global(.markdown-body h1) {
    font-size: 1.35rem;
  }

  :global(.markdown-body h2) {
    font-size: 1.18rem;
  }

  :global(.markdown-body h3) {
    font-size: 1.05rem;
  }

  :global(.markdown-body ul),
  :global(.markdown-body ol) {
    margin: 0.75rem 0;
    padding-left: 1.35rem;
  }

  :global(.markdown-body ul) {
    list-style: disc;
  }

  :global(.markdown-body ol) {
    list-style: decimal;
  }

  :global(.markdown-body li + li) {
    margin-top: 0.25rem;
  }

  :global(.markdown-body blockquote) {
    margin: 0.9rem 0;
    border-left: 4px solid var(--border);
    padding-left: 1rem;
    color: var(--muted-foreground);
  }

  :global(.markdown-body a) {
    color: var(--primary);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }

  :global(.markdown-body code) {
    border-radius: 0.38rem;
    background: var(--muted);
    padding: 0.12rem 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  :global(.markdown-body pre) {
    margin: 0.95rem 0;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--muted);
    padding: 0.85rem;
  }

  :global(.markdown-body pre code) {
    display: block;
    background: transparent;
    padding: 0;
    white-space: pre;
  }

  :global(.markdown-body table) {
    margin: 0.95rem 0;
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    font-size: 0.94em;
  }

  :global(.markdown-body th),
  :global(.markdown-body td) {
    border: 1px solid var(--border);
    padding: 0.45rem 0.65rem;
    text-align: left;
    vertical-align: top;
  }

  :global(.markdown-body th) {
    background: var(--muted);
    color: var(--foreground);
    font-weight: 700;
  }

  :global(.markdown-body hr) {
    margin: 1.1rem 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
</style>
