// Tool settings (web search, image / video generation, TTS) — state +
// orchestration. These four settings sections share dirty-tracking, secret
// reveal state, media-task polling, and a common test harness, so they live in
// one store with four thin section components.
import {
  deleteDesktopMediaTask,
  desktopTtsAudioUrl,
  fetchDesktopMediaTaskBlob,
  loadDesktopImageGenerate,
  loadDesktopMediaTasks,
  loadDesktopTts,
  loadDesktopTtsVoices,
  loadDesktopVideoGenerate,
  loadDesktopWebSearch,
  saveDesktopImageGenerate,
  saveDesktopTts,
  saveDesktopVideoGenerate,
  saveDesktopWebSearch,
  testDesktopImageGenerateSettings,
  testDesktopTtsSettings,
  testDesktopVideoGenerateSettings,
  testDesktopWebSearchSettings
} from "../api";
import type {
  DesktopMediaGenerateSummary,
  DesktopMediaGenerateUpdateRequest,
  DesktopMediaTask,
  DesktopMediaTaskKind,
  DesktopSettingsTestResponse,
  DesktopTtsSummary,
  DesktopTtsUpdateRequest,
  DesktopWebSearchSummary,
  DesktopWebSearchUpdateRequest
} from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export type ToolSettingsSection = "webSearch" | "imageGenerate" | "videoGenerate" | "ttsGenerate";

type SearchEngineEditor = DesktopWebSearchUpdateRequest["engines"][number] & { hasApiKey: boolean; apiKey: string; clearApiKey: boolean };
export type WebSearchEditor = Omit<DesktopWebSearchUpdateRequest, "engines"> & { engines: SearchEngineEditor[] };
type MediaEngineEditor = DesktopMediaGenerateUpdateRequest["engines"][number] & { hasApiKey: boolean; apiKey: string; clearApiKey: boolean };
export type MediaEditor = Omit<DesktopMediaGenerateUpdateRequest, "engines"> & { engines: MediaEngineEditor[] };
type TtsProviderEditor = DesktopTtsUpdateRequest["providers"][number] & { hasApiKey: boolean; apiKey: string; clearApiKey: boolean };
export type TtsEditor = Omit<DesktopTtsUpdateRequest, "providers"> & { providers: TtsProviderEditor[] };

export const XIAOMI_VOICES: Array<{ id: string; label: string; locale?: string; gender?: string }> = [
  { id: "mimo_default", label: "MiMo-默认", locale: "因部署集群而异" },
  { id: "冰糖", label: "冰糖", locale: "中文", gender: "女性" },
  { id: "茉莉", label: "茉莉", locale: "中文", gender: "女性" },
  { id: "苏打", label: "苏打", locale: "中文", gender: "男性" },
  { id: "白桦", label: "白桦", locale: "中文", gender: "男性" },
  { id: "Mia", label: "Mia", locale: "英文", gender: "女性" },
  { id: "Chloe", label: "Chloe", locale: "英文", gender: "女性" },
  { id: "Milo", label: "Milo", locale: "英文", gender: "男性" },
  { id: "Dean", label: "Dean", locale: "英文", gender: "男性" }
];

const WEB_SEARCH_ENGINE_LABELS: Record<string, keyof typeof session.text> = {
  duckduckgo: "searchEngineDuckDuckGo",
  anysearch: "searchEngineAnySearch",
  brave: "searchEngineBrave",
  tavily: "searchEngineTavily",
  exa: "searchEngineExa",
  serper: "searchEngineSerper",
  baidu: "searchEngineBaidu",
  baidu_fast: "searchEngineBaiduFast",
  baidu_web: "searchEngineBaiduWeb",
  ark: "searchEngineArk",
  grok: "searchEngineGrok",
  bocha: "searchEngineBocha"
};

const IMAGE_ENGINE_LABELS: Record<string, string> = {
  agnes: "Agnes Image",
  openai: "OpenAI Images",
  "openai-chat": "OpenAI Chat Format",
  google: "Google Imagen",
  volcengine: "Volcengine (Seedream)",
  modelscope: "ModelScope"
};

const VIDEO_ENGINE_LABELS: Record<string, string> = {
  agnes: "Agnes Video",
  volcengine: "Volcengine (Doubao)"
};

export function webSearchEngineLabel(id: string, copy: typeof session.text): string {
  const key = WEB_SEARCH_ENGINE_LABELS[id];
  return key ? (copy[key] as string) : id;
}

export function mediaEngineLabel(kind: "image" | "video", id: string): string {
  const map = kind === "image" ? IMAGE_ENGINE_LABELS : VIDEO_ENGINE_LABELS;
  return map[id] ?? id;
}

export function ttsProviderLabel(id: string, copy: typeof session.text): string {
  if (id === "macos") return copy.ttsProviderMacos;
  if (id === "xiaomi") return copy.ttsProviderXiaomi;
  return id;
}

export const toolsStore = $state({
  webSearch: null as DesktopWebSearchSummary | null,
  webSearchEdit: null as WebSearchEditor | null,
  webSearchLoading: false,
  webSearchEndpoint: "",
  imageGenerate: null as DesktopMediaGenerateSummary | null,
  imageGenerateEdit: null as MediaEditor | null,
  imageGenerateLoading: false,
  imageGenerateEndpoint: "",
  imageTasks: [] as DesktopMediaTask[],
  videoGenerate: null as DesktopMediaGenerateSummary | null,
  videoGenerateEdit: null as MediaEditor | null,
  videoGenerateLoading: false,
  videoGenerateEndpoint: "",
  videoTasks: [] as DesktopMediaTask[],
  ttsGenerate: null as DesktopTtsSummary | null,
  ttsGenerateEdit: null as TtsEditor | null,
  ttsGenerateLoading: false,
  ttsGenerateEndpoint: "",
  ttsVoices: [] as Array<{ id: string; label?: string; locale?: string; gender?: string }>,
  ttsTestProvider: "macos",
  mediaTaskDetail: null as DesktopMediaTask | null,
  mediaTaskDetailUrl: null as string | null,
  mediaTaskDetailLoading: false,
  mediaTaskDetailFailed: false,
  mediaTaskBusy: "",
  dirty: new Set<ToolSettingsSection>(),
  saving: false,
  message: "",
  testBusy: false,
  testResult: null as DesktopSettingsTestResponse | null,
  testQuery: "latest AI news",
  testEngine: "auto",
  imageTestPrompt: "A calm futuristic workspace in soft morning light",
  imageTestEngine: "auto",
  imageTestSize: "1024x1024",
  videoTestPrompt: "A slow cinematic pan across a quiet coastal city at dawn",
  videoTestEngine: "auto",
  ttsTestText: "你好，这是 Molibot 的语音合成测试。",
  ttsTestAudioUrl: "",
  revealedSecrets: new Set<string>()
});

let mediaPollTimer: ReturnType<typeof setInterval> | null = null;
// Bumped on every detail open/close so a slow blob fetch for a previously
// selected task can't overwrite the currently shown preview.
let mediaDetailGen = 0;

export function secretRevealed(key: string): boolean {
  return toolsStore.revealedSecrets.has(key);
}

export function toggleRevealSecret(key: string): void {
  const next = new Set(toolsStore.revealedSecrets);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  toolsStore.revealedSecrets = next;
}

export function markToolSettingsDirty(sectionKind: ToolSettingsSection): void {
  toolsStore.dirty = new Set([...toolsStore.dirty, sectionKind]);
  toolsStore.message = "";
  toolsStore.testResult = null;
  if (sectionKind === "ttsGenerate") toolsStore.ttsTestAudioUrl = "";
}

export async function loadWebSearch(endpoint: string): Promise<void> {
  toolsStore.webSearchEndpoint = endpoint;
  toolsStore.webSearchLoading = true;
  session.error = "";
  try {
    toolsStore.webSearch = await loadDesktopWebSearch(endpoint);
    toolsStore.webSearchEdit = {
      enabled: toolsStore.webSearch.enabled,
      defaultRoute: toolsStore.webSearch.defaultRoute,
      defaultEngine: toolsStore.webSearch.defaultEngine,
      engineSelectionStrategy: toolsStore.webSearch.engineSelectionStrategy,
      maxResults: toolsStore.webSearch.maxResults,
      timeoutMs: toolsStore.webSearch.timeoutMs,
      retryTimeoutMs: toolsStore.webSearch.retryTimeoutMs,
      engines: toolsStore.webSearch.engines.map((engine) => ({ ...engine, apiKey: "", clearApiKey: false }))
    };
    toolsStore.testEngine = toolsStore.webSearch.defaultEngine;
  } catch (cause) {
    toolsStore.webSearchEndpoint = "";
    setError(cause);
  } finally {
    toolsStore.webSearchLoading = false;
  }
}

export async function loadImageGenerate(endpoint: string): Promise<void> {
  toolsStore.imageGenerateEndpoint = endpoint;
  toolsStore.imageGenerateLoading = true;
  session.error = "";
  try {
    const [summary, tasks] = await Promise.all([loadDesktopImageGenerate(endpoint), loadDesktopMediaTasks(endpoint, "image").catch(() => [])]);
    toolsStore.imageGenerate = summary;
    toolsStore.imageTasks = tasks;
    toolsStore.imageGenerateEdit = { enabled: summary.enabled, defaultEngine: summary.defaultEngine, engines: summary.engines.map((engine) => ({ ...engine, apiKey: "", clearApiKey: false })) };
    toolsStore.imageTestEngine = summary.defaultEngine;
  } catch (cause) {
    toolsStore.imageGenerateEndpoint = "";
    setError(cause);
  } finally {
    toolsStore.imageGenerateLoading = false;
  }
}

export async function loadVideoGenerate(endpoint: string): Promise<void> {
  toolsStore.videoGenerateEndpoint = endpoint;
  toolsStore.videoGenerateLoading = true;
  session.error = "";
  try {
    const [summary, tasks] = await Promise.all([loadDesktopVideoGenerate(endpoint), loadDesktopMediaTasks(endpoint, "video").catch(() => [])]);
    toolsStore.videoGenerate = summary;
    toolsStore.videoTasks = tasks;
    toolsStore.videoGenerateEdit = { enabled: summary.enabled, defaultEngine: summary.defaultEngine, engines: summary.engines.map((engine) => ({ ...engine, apiKey: "", clearApiKey: false })) };
    toolsStore.videoTestEngine = summary.defaultEngine;
  } catch (cause) {
    toolsStore.videoGenerateEndpoint = "";
    setError(cause);
  } finally {
    toolsStore.videoGenerateLoading = false;
  }
}

export async function loadTts(endpoint: string): Promise<void> {
  toolsStore.ttsGenerateEndpoint = endpoint;
  toolsStore.ttsGenerateLoading = true;
  session.error = "";
  try {
    const [summary, voices] = await Promise.all([loadDesktopTts(endpoint), loadDesktopTtsVoices(endpoint).catch(() => [])]);
    toolsStore.ttsGenerate = summary;
    toolsStore.ttsVoices = voices;
    toolsStore.ttsGenerateEdit = { enabled: summary.enabled, defaultProvider: summary.defaultProvider, providers: summary.providers.map((provider) => ({ ...provider, apiKey: "", clearApiKey: false })) };
    toolsStore.ttsTestProvider = summary.defaultProvider;
  } catch (cause) {
    toolsStore.ttsGenerateEndpoint = "";
    setError(cause);
  } finally {
    toolsStore.ttsGenerateLoading = false;
  }
}

function webSearchRequest(): DesktopWebSearchUpdateRequest | null {
  if (!toolsStore.webSearchEdit) return null;
  return { ...toolsStore.webSearchEdit, engines: toolsStore.webSearchEdit.engines.map(({ hasApiKey: _hasApiKey, ...engine }) => engine) };
}

function mediaRequest(editor: MediaEditor | null): DesktopMediaGenerateUpdateRequest | null {
  if (!editor) return null;
  return { ...editor, engines: editor.engines.map(({ hasApiKey: _hasApiKey, ...engine }) => engine) };
}

function ttsRequest(): DesktopTtsUpdateRequest | null {
  if (!toolsStore.ttsGenerateEdit) return null;
  return { ...toolsStore.ttsGenerateEdit, providers: toolsStore.ttsGenerateEdit.providers.map(({ hasApiKey: _hasApiKey, ...provider }) => provider) };
}

export async function saveToolSettings(sectionKind: ToolSettingsSection): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !toolsStore.dirty.has(sectionKind) || toolsStore.saving) return;
  toolsStore.saving = true;
  session.error = "";
  try {
    if (sectionKind === "webSearch") {
      const request = webSearchRequest();
      if (request) { toolsStore.webSearch = await saveDesktopWebSearch(endpoint, request); toolsStore.webSearchEndpoint = ""; await loadWebSearch(endpoint); }
    } else if (sectionKind === "imageGenerate") {
      const request = mediaRequest(toolsStore.imageGenerateEdit);
      if (request) { toolsStore.imageGenerate = await saveDesktopImageGenerate(endpoint, request); toolsStore.imageGenerateEndpoint = ""; await loadImageGenerate(endpoint); }
    } else if (sectionKind === "videoGenerate") {
      const request = mediaRequest(toolsStore.videoGenerateEdit);
      if (request) { toolsStore.videoGenerate = await saveDesktopVideoGenerate(endpoint, request); toolsStore.videoGenerateEndpoint = ""; await loadVideoGenerate(endpoint); }
    } else {
      const request = ttsRequest();
      if (request) { toolsStore.ttsGenerate = await saveDesktopTts(endpoint, request); toolsStore.ttsGenerateEndpoint = ""; await loadTts(endpoint); }
    }
    toolsStore.dirty = new Set([...toolsStore.dirty].filter((item) => item !== sectionKind));
    toolsStore.message = session.text.toolSettingsSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    toolsStore.saving = false;
  }
}

export async function testToolSettings(sectionKind: ToolSettingsSection): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || toolsStore.testBusy) return;
  toolsStore.testBusy = true;
  toolsStore.testResult = null;
  session.error = "";
  try {
    if (sectionKind === "webSearch") {
      const request = webSearchRequest();
      if (request) toolsStore.testResult = await testDesktopWebSearchSettings(endpoint, request, toolsStore.testQuery, toolsStore.testEngine);
    } else if (sectionKind === "imageGenerate") {
      const request = mediaRequest(toolsStore.imageGenerateEdit);
      if (request) toolsStore.testResult = await testDesktopImageGenerateSettings(endpoint, request, toolsStore.imageTestPrompt, toolsStore.imageTestEngine, toolsStore.imageTestSize);
      toolsStore.imageTasks = await loadDesktopMediaTasks(endpoint, "image").catch(() => toolsStore.imageTasks);
    } else if (sectionKind === "videoGenerate") {
      const request = mediaRequest(toolsStore.videoGenerateEdit);
      if (request) toolsStore.testResult = await testDesktopVideoGenerateSettings(endpoint, request, toolsStore.videoTestPrompt, toolsStore.videoTestEngine);
      toolsStore.videoTasks = await loadDesktopMediaTasks(endpoint, "video").catch(() => toolsStore.videoTasks);
    } else {
      const request = ttsRequest();
      if (request) {
        toolsStore.testResult = await testDesktopTtsSettings(endpoint, request, toolsStore.ttsTestText, toolsStore.ttsTestProvider);
        toolsStore.ttsTestAudioUrl = desktopTtsAudioUrl(endpoint, toolsStore.testResult);
      }
    }
  } catch (cause) {
    toolsStore.testResult = { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    toolsStore.testBusy = false;
  }
}

export async function removeMediaTask(kind: DesktopMediaTaskKind, taskId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || toolsStore.mediaTaskBusy) return;
  toolsStore.mediaTaskBusy = taskId;
  session.error = "";
  try {
    await deleteDesktopMediaTask(endpoint, kind, taskId);
    if (kind === "image") toolsStore.imageTasks = toolsStore.imageTasks.filter((task) => task.id !== taskId);
    else toolsStore.videoTasks = toolsStore.videoTasks.filter((task) => task.id !== taskId);
    if (toolsStore.mediaTaskDetail?.id === taskId) {
      revokeMediaDetailUrl();
      toolsStore.mediaTaskDetail = null;
    }
  } catch (cause) {
    setError(cause);
  } finally {
    toolsStore.mediaTaskBusy = "";
  }
}

function mediaTaskList(kind: "image" | "video"): DesktopMediaTask[] {
  return kind === "image" ? toolsStore.imageTasks : toolsStore.videoTasks;
}

function refreshMediaTaskDetail(kind: "image" | "video"): void {
  if (!toolsStore.mediaTaskDetail) return;
  const wasIncomplete = toolsStore.mediaTaskDetail.status !== "completed";
  const current = mediaTaskList(kind).find((task) => task.id === toolsStore.mediaTaskDetail!.id) ?? null;
  toolsStore.mediaTaskDetail = current;
  // If the open task just finished, load its preview without a manual reopen.
  if (current && wasIncomplete && current.status === "completed"
    && !toolsStore.mediaTaskDetailUrl && !toolsStore.mediaTaskDetailLoading) {
    loadMediaTaskDetailPreview(current);
  }
}

async function pollMediaTasks(kind: "image" | "video"): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint) return;
  try {
    const tasks = await loadDesktopMediaTasks(endpoint, kind);
    if (kind === "image") toolsStore.imageTasks = tasks;
    else toolsStore.videoTasks = tasks;
    refreshMediaTaskDetail(kind);
  } catch {
    // keep last-known list on transient errors
  }
}

export function ensureMediaPolling(kind: "image" | "video"): void {
  const list = mediaTaskList(kind);
  const hasProcessing = list.some((task) => task.status === "processing");
  if (hasProcessing && !mediaPollTimer) {
    mediaPollTimer = setInterval(() => { void pollMediaTasks(kind); }, 5000);
  } else if (!hasProcessing && mediaPollTimer) {
    clearInterval(mediaPollTimer);
    mediaPollTimer = null;
  }
}

export function openMediaTaskDetail(task: DesktopMediaTask): void {
  revokeMediaDetailUrl();
  toolsStore.mediaTaskDetail = task;
  toolsStore.mediaTaskDetailFailed = false;
  toolsStore.mediaTaskDetailLoading = false;
  loadMediaTaskDetailPreview(task);
}

// Fetch the completed result as a blob URL so it renders inside the WebView CSP
// (raw provider/result URLs are blocked and expire). No-op while processing.
function loadMediaTaskDetailPreview(task: DesktopMediaTask): void {
  const endpoint = session.endpoint;
  if (task.status !== "completed" || !endpoint) return;
  const gen = ++mediaDetailGen;
  toolsStore.mediaTaskDetailLoading = true;
  void fetchDesktopMediaTaskBlob(endpoint, task.kind, task.id)
    .then((blob) => {
      if (gen !== mediaDetailGen) return;
      toolsStore.mediaTaskDetailUrl = URL.createObjectURL(blob);
      toolsStore.mediaTaskDetailLoading = false;
    })
    .catch(() => {
      if (gen !== mediaDetailGen) return;
      toolsStore.mediaTaskDetailFailed = true;
      toolsStore.mediaTaskDetailLoading = false;
    });
}

function revokeMediaDetailUrl(): void {
  mediaDetailGen++;
  if (toolsStore.mediaTaskDetailUrl) {
    URL.revokeObjectURL(toolsStore.mediaTaskDetailUrl);
    toolsStore.mediaTaskDetailUrl = null;
  }
}

export function closeMediaTaskDetail(): void {
  revokeMediaDetailUrl();
  toolsStore.mediaTaskDetail = null;
  toolsStore.mediaTaskDetailLoading = false;
  toolsStore.mediaTaskDetailFailed = false;
}

export function onMediaTaskOverlayKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeMediaTaskDetail();
}
