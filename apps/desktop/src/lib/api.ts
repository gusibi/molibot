import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  DesktopAgentsResponse,
  DesktopAgentActivityResponse,
  DesktopAgentActivityItem,
  DesktopActiveRunActionResponse,
  DesktopActiveRunItem,
  DesktopActiveRunsResponse,
  DesktopAgentsSummary,
  DesktopAgentItem,
  DesktopAgentSaveRequest,
  DesktopMcpResponse,
  DesktopMcpSummary,
  DesktopMcpSaveRequest,
  DesktopOpenConnectorResponse,
  DesktopOpenConnectorSummary,
  DesktopOpenConnectorSaveRequest,
  DesktopOpenConnectorTokenResponse,
  DesktopChannelsResponse,
  DesktopChannelsSummary,
  DesktopChannelInstance,
  DesktopChannelSaveRequest,
  DesktopChannelTestRequest,
  DesktopChannelTestResponse,
  DesktopConversationActivity,
  DesktopConversationPlan,
  DesktopConversationBotGroup,
  DesktopConversationChannel,
  DesktopConversationItem,
  DesktopConversationsGroupsResponse,
  DesktopConversationsResponse,
  DesktopExternalSession,
  DesktopExternalSessionsResponse,
  DesktopExternalSessionsSummary,
  DesktopExternalTranscript,
  DesktopExternalTranscriptResponse,
  DesktopRuntimeEnvResponse,
  DesktopRuntimeEnvSummary,
  DesktopMemoryResponse,
  DesktopMemorySummary,
  DesktopMemoryActionRequest,
  DesktopMemoryActionResponse,
  DesktopMemoryRejectionsResponse,
  DesktopMemoryFeedbackValue,
  DesktopMemoryTraceResponse,
  DesktopPluginsResponse,
  DesktopPluginsSummary,
  DesktopPluginsUpdateRequest,
  DesktopMiniAppItem,
  DesktopMiniAppBuiltinItem,
  DesktopMiniAppBuiltinInstallRequest,
  DesktopMiniAppBuiltinInstallResponse,
  DesktopMiniAppsResponse,
  DesktopMiniAppToggleRequest,
  DesktopMiniAppUninstallRequest,
  DesktopMiniAppUpdateRequest,
  DesktopMiniAppUpdateResponse,
  DesktopMiniAppInstallRequest,
  DesktopMiniAppInstallResponse,
  DesktopMiniAppInvokeRequest,
  DesktopMiniAppInvokeResponse,
  DesktopMiniAppAttachRequest,
  DesktopMiniAppAttachResponse,
  DesktopMiniAppBadgeClearRequest,
  DesktopMiniAppAiSettings,
  DesktopMiniAppAiSettingsResponse,
  DailyMaterialsBackfillResponse,
  DailyMaterialsBackfillStatus,
  DesktopProfileFilesResponse,
  DesktopWebSearchResponse,
  DesktopWebSearchSummary,
  DesktopWebSearchUpdateRequest,
  DesktopMediaGenerateUpdateRequest,
  DesktopTtsUpdateRequest,
  DesktopSettingsTestResponse,
  DesktopMediaTask,
  DesktopMediaTaskKind,
  DesktopMediaTasksResponse,
  DesktopImageGenerateResponse,
  DesktopImageRecognitionResponse,
  DesktopImageRecognitionSummary,
  DesktopImageRecognitionUpdateRequest,
  DesktopVideoGenerateResponse,
  DesktopMediaGenerateSummary,
  DesktopTtsResponse,
  DesktopTtsSummary,
  DesktopSkillsResponse,
  DesktopSkillsSummary,
  DesktopSkillsUpdateRequest,
  DesktopComposerSuggestion,
  DesktopApprovalDecision,
  DesktopApprovalOption,
  DesktopApprovalPrompt,
  DesktopApprovalResult,
  DesktopBootstrapResponse,
  DesktopFileMediaType,
  DesktopHostBashResponse,
  DesktopHostBashSummary,
  DesktopHostBashToggleResponse,
  DesktopModelState,
  DesktopModelRoutingResponse,
  DesktopModelRoutingSettings,
  DesktopModelRoutingUpdateRequest,
  DesktopSessionModelResponse,
  DesktopProfileSummary,
  DesktopProvidersResponse,
  DesktopProvidersSummary,
  DesktopProviderSubmitResponse,
  DesktopProviderGlobalsRequest,
  DesktopProviderCreateRequest,
  DesktopProviderItem,
  DesktopProviderModel,
  DesktopProviderModelTag,
  DesktopProviderModelsResponse,
  DesktopProviderMutationResponse,
  DesktopProviderTestResponse,
  DesktopProviderUpdateRequest,
  DesktopProviderAuthAnswerRequest,
  DesktopProviderAuthLogoutResponse,
  DesktopProviderAuthOverviewResponse,
  DesktopProviderAuthSession,
  DesktopProviderAuthSessionResponse,
  DesktopProviderAuthVerifyResponse,
  DesktopRunHistoryItem,
  DesktopRunHistoryResponse,
  DesktopSandboxResponse,
  DesktopSandboxSummary,
  DesktopSandboxUpdateRequest,
  DesktopSessionDetail,
  DesktopSessionFile,
  DesktopSessionFilesResponse,
  DesktopSessionRun,
  DesktopSessionRunsResponse,
  DesktopSessionSummary,
  DesktopTaskResponse,
  DesktopTaskSummary,
  DesktopTaskActionRequest,
  DesktopTaskActionResponse,
  DesktopDurableExecutionActionRequest,
  DesktopDurableExecutionActionResponse,
  DesktopDurableExecutionEvidenceRead,
  DesktopDurableExecutionEvidenceReadResponse,
  DesktopDurableExecutionInspection,
  DesktopDurableExecutionInspectionResponse,
  DesktopDurableExecutionItem,
  DesktopDurableExecutionResponse,
  DesktopThinkingLevel,
  DesktopTraceFactType,
  DesktopTraceRange,
  DesktopTraceResponse,
  DesktopTraceSummary,
  DesktopUsageRange,
  DesktopUsageResponse,
  DesktopUsageSummary,
  DesktopWebProfile,
  DesktopWebProfilePatch,
  DesktopWebProfileSaveRequest,
  DesktopWebProfilesResponse
} from "@molibot/desktop-contract";

type SseHandler = (event: string, data: Record<string, unknown>) => void | Promise<void>;

function serviceUrl(endpoint: string, route: string): string {
  return `${endpoint.replace(/\/$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
}

function fetchFromDesktop(input: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

async function requestJson<T>(endpoint: string, route: string, init?: RequestInit): Promise<T> {
  const response = await fetchFromDesktop(serviceUrl(endpoint, route), init);
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new Error(text || `Request failed (${response.status})`);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload.error ?? `Request failed (${response.status})`));
  }
  return payload as T;
}

export type DesktopD2Theme = "light" | "dark";

export async function renderDesktopD2(
  endpoint: string,
  source: string,
  theme: DesktopD2Theme,
  signal?: AbortSignal
): Promise<string> {
  const payload = await requestJson<{ ok: true; svg: string }>(endpoint, "/api/desktop/d2/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, theme }),
    signal
  });
  return payload.svg;
}

export async function loadDesktopBootstrap(endpoint: string): Promise<DesktopProfileSummary[]> {
  const payload = await requestJson<DesktopBootstrapResponse>(endpoint, "/api/desktop/bootstrap");
  return payload.profiles;
}

export interface DesktopProject {
  id: string;
  name: string;
  rootPath: string;
  instructions?: string;
  modelKey?: string;
  thinkingLevel?: DesktopThinkingLevel;
  sandboxEnabled?: boolean;
  toolProgress?: "off" | "new" | "all" | "verbose";
  showReasoning?: "off" | "on" | "stream" | "new";
  runLogNotice?: boolean;
  customCommands?: DesktopProjectCustomCommand[];
  createdAt: string;
  updatedAt: string;
}

export interface DesktopProjectCustomCommand {
  name: string;
  content: string;
  description?: string;
}

export interface DesktopProjectSession {
  conversationId: string;
  title: string;
  updatedAt: string;
  origin: string;
}

export interface DesktopProjectSessionCreation {
  session: DesktopProjectSession;
  reused: boolean;
}

export interface DesktopProjectTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  sizeBytes?: number;
}

export interface DesktopProjectTreePage {
  path: string;
  entries: DesktopProjectTreeEntry[];
  truncated: boolean;
  nextCursor?: string;
}

export type DesktopProjectFilePreview =
  | {
      status: "text";
      path: string;
      content: string;
      sizeBytes: number;
      byteOffset: number;
      byteLength: number;
      truncated: boolean;
    }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number };

export interface DesktopProjectGitEntry {
  path: string;
  previousPath?: string;
  previousOutsideProject?: boolean;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export type DesktopProjectGitStatus =
  | { status: "ok"; entries: DesktopProjectGitEntry[]; truncated: boolean }
  | { status: "unavailable"; reason: string };

export type DesktopProjectGitDiff =
  | { status: "diff"; path: string; content: string; truncated: boolean }
  | { status: "untracked"; path: string; preview: DesktopProjectFilePreview }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number }
  | { status: "unavailable"; reason: string };

export interface DesktopProjectSearchNameHit {
  path: string;
  name: string;
  sizeBytes: number;
  score: number;
}

export interface DesktopProjectSearchContentLine {
  line: number;
  text: string;
  start: number;
  end: number;
}

export interface DesktopProjectSearchContentHit {
  path: string;
  name: string;
  lines: DesktopProjectSearchContentLine[];
  truncated: boolean;
}

export type DesktopProjectSearchResult =
  | { mode: "name"; query: string; hits: DesktopProjectSearchNameHit[]; scanned: number; truncated: boolean }
  | { mode: "content"; query: string; hits: DesktopProjectSearchContentHit[]; scanned: number; truncated: boolean };

export interface DesktopProjectChangeBatch {
  paths: string[];
  overflow: boolean;
}

export interface DesktopProjectMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  attachments?: Array<{ original: string; local: string; mediaType: "image" | "audio" | "video" | "file"; mimeType?: string; size?: number }>;
  activities?: DesktopConversationActivity[];
}

export async function loadDesktopProjects(endpoint: string): Promise<DesktopProject[]> {
  return (await requestJson<{ ok: true; projects: DesktopProject[] }>(endpoint, "/api/settings/projects")).projects;
}

export async function createDesktopProject(endpoint: string, input: { name: string; rootPath?: string; createDirectory?: boolean; instructions?: string }): Promise<DesktopProject> {
  return (await requestJson<{ ok: true; project: DesktopProject }>(endpoint, "/api/settings/projects", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  })).project;
}

export async function patchDesktopProject(endpoint: string, id: string, patch: { name?: string; rootPath?: string; instructions?: string; modelKey?: string | null; thinkingLevel?: DesktopThinkingLevel | null; sandboxEnabled?: boolean | null; toolProgress?: DesktopProject["toolProgress"] | null; showReasoning?: DesktopProject["showReasoning"] | null; runLogNotice?: boolean | null; customCommands?: DesktopProjectCustomCommand[] | null }): Promise<DesktopProject> {
  return (await requestJson<{ ok: true; project: DesktopProject }>(endpoint, `/api/settings/projects/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch)
  })).project;
}

export async function deleteDesktopProject(endpoint: string, id: string, removeSessions = false): Promise<void> {
  await requestJson(endpoint, `/api/settings/projects/${encodeURIComponent(id)}?removeSessions=${String(removeSessions)}`, { method: "DELETE" });
}

export async function loadDesktopProjectSessions(endpoint: string, id: string): Promise<DesktopProjectSession[]> {
  return (await requestJson<{ ok: true; sessions: DesktopProjectSession[] }>(endpoint, `/api/settings/projects/${encodeURIComponent(id)}/sessions`)).sessions;
}

export async function createDesktopProjectSession(endpoint: string, id: string): Promise<DesktopProjectSessionCreation> {
  const payload = await requestJson<{ ok: true; session: DesktopProjectSession; reused: boolean }>(endpoint, `/api/settings/projects/${encodeURIComponent(id)}/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  });
  return { session: payload.session, reused: payload.reused };
}

export async function loadDesktopProjectSession(endpoint: string, projectId: string, conversationId: string): Promise<DesktopProjectMessage[]> {
  return (await requestJson<{ ok: true; messages: DesktopProjectMessage[] }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(conversationId)}`)).messages;
}

export async function renameDesktopProjectSession(endpoint: string, projectId: string, conversationId: string, title: string): Promise<DesktopProjectSession> {
  const payload = await requestJson<{ ok: true; conversation: { id: string; title: string; updatedAt: string; origin?: string } }>(
    endpoint,
    `/api/settings/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(conversationId)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }
  );
  const conv = payload.conversation;
  return { conversationId: conv.id, title: conv.title, updatedAt: conv.updatedAt, origin: conv.origin ?? "" };
}

export async function deleteDesktopProjectSession(endpoint: string, projectId: string, conversationId: string): Promise<void> {
  await requestJson(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
}

export async function loadDesktopProjectTree(endpoint: string, projectId: string, treePath = "", cursor?: string): Promise<DesktopProjectTreePage> {
  const query = new URLSearchParams({ path: treePath });
  if (cursor) query.set("cursor", cursor);
  return (await requestJson<{ ok: true; page: DesktopProjectTreePage }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/tree?${query}`)).page;
}

export async function loadDesktopProjectFile(
  endpoint: string,
  projectId: string,
  filePath: string,
  options: { offset?: number } = {}
): Promise<DesktopProjectFilePreview> {
  const query = new URLSearchParams({ path: filePath });
  if (options.offset) query.set("offset", String(options.offset));
  return (await requestJson<{ ok: true; preview: DesktopProjectFilePreview }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/file?${query}`)).preview;
}

/** Streams a Project file's raw bytes; used for media, PDF and rendered SVG. */
export function desktopProjectRawFileUrl(endpoint: string, projectId: string, filePath: string): string {
  const query = new URLSearchParams({ path: filePath, raw: "true" });
  return serviceUrl(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/file?${query}`);
}

/** Asks the local service to show a Project file in Finder, or open it with its default app. */
export async function revealDesktopProjectFile(
  endpoint: string,
  projectId: string,
  filePath: string,
  mode: "reveal" | "open"
): Promise<void> {
  await requestJson(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, mode })
  });
}

/**
 * Session-scope peer of `revealDesktopProjectFile`: shows a chat attachment in
 * Finder, or opens it with its default app. `filePath` is workspace-relative -
 * the service resolves the absolute path behind its own root check and never
 * returns it.
 */
export async function revealDesktopSessionFile(
  endpoint: string,
  input: { profileId: string; sessionId: string; projectId?: string; path: string },
  mode: "reveal" | "open"
): Promise<void> {
  await requestJson(endpoint, "/api/web/files/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: input.profileId,
      sessionId: input.sessionId,
      projectId: input.projectId ?? "",
      path: input.path,
      mode
    })
  });
}

export async function loadDesktopProjectGitStatus(endpoint: string, projectId: string): Promise<DesktopProjectGitStatus> {
  return (await requestJson<{ ok: true; result: DesktopProjectGitStatus }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/status`)).result;
}

export async function loadDesktopProjectGitDiff(endpoint: string, projectId: string, filePath: string): Promise<DesktopProjectGitDiff> {
  const query = new URLSearchParams({ path: filePath });
  return (await requestJson<{ ok: true; result: DesktopProjectGitDiff }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/diff?${query}`)).result;
}

export async function searchDesktopProjectFiles(
  endpoint: string,
  projectId: string,
  input: { query: string; mode?: "name" | "content"; limit?: number; caseSensitive?: boolean },
  signal?: AbortSignal
): Promise<DesktopProjectSearchResult> {
  const query = new URLSearchParams({ q: input.query, mode: input.mode ?? "name" });
  if (input.limit) query.set("limit", String(input.limit));
  if (input.caseSensitive) query.set("caseSensitive", "true");
  const payload = await requestJson<{ ok: true; result: DesktopProjectSearchResult }>(
    endpoint,
    `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/search?${query}`,
    signal ? { signal } : undefined
  );
  return payload.result;
}

/**
 * Opens the Project file-change stream. Resolves once the stream ends; abort the
 * signal to unsubscribe. Callers treat `onUnavailable` as "fall back to the
 * manual refresh button" rather than as an error.
 */
export async function watchDesktopProjectFiles(
  endpoint: string,
  projectId: string,
  handlers: {
    onReady?: () => void;
    onChange: (batch: DesktopProjectChangeBatch) => void;
    onUnavailable?: (reason: string) => void;
  },
  signal: AbortSignal
): Promise<void> {
  const response = await fetchFromDesktop(
    serviceUrl(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/watch`),
    { signal }
  );
  if (!response.ok) throw new Error(`Watch failed (${response.status})`);
  await consumeDesktopSse(response, (event, data) => {
    if (event === "ready") handlers.onReady?.();
    else if (event === "change") handlers.onChange(data as unknown as DesktopProjectChangeBatch);
    else if (event === "unavailable") handlers.onUnavailable?.(String((data as { reason?: string })?.reason ?? ""));
  });
}

export type DesktopModelRoute = "text" | "vision" | "stt" | "tts" | "subagent";

export async function loadDesktopModels(
  endpoint: string,
  route: DesktopModelRoute = "text"
): Promise<DesktopModelState> {
  const query = new URLSearchParams({ route });
  const payload = await requestJson<{ ok: true; model: DesktopModelState }>(
    endpoint,
    `/api/desktop/models?${query.toString()}`
  );
  return payload.model;
}

export async function switchDesktopModel(
  endpoint: string,
  selector: string,
  route: DesktopModelRoute = "text"
): Promise<DesktopModelState> {
  const payload = await requestJson<{ ok: true; model: DesktopModelState }>(
    endpoint,
    "/api/desktop/models",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selector, route })
    }
  );
  return payload.model;
}

/** Reads a session's persisted per-session text-model override (empty = follow global). */
export async function loadDesktopSessionModel(endpoint: string, conversationId: string): Promise<string> {
  const payload = await requestJson<DesktopSessionModelResponse>(
    endpoint,
    `/api/desktop/session-model?conversationId=${encodeURIComponent(conversationId)}`
  );
  return payload.modelKey;
}

/** Persists a session's per-session text-model override (empty string clears it). */
export async function saveDesktopSessionModel(
  endpoint: string,
  conversationId: string,
  modelKey: string
): Promise<string> {
  const payload = await requestJson<DesktopSessionModelResponse>(endpoint, "/api/desktop/session-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, modelKey })
  });
  return payload.modelKey;
}

export interface DesktopContractPluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  source: { kind: "builtin" | "directory" | "npm" | "git"; label?: string };
  status: "active" | "disabled" | "error" | "incompatible";
  enabled: boolean;
  error?: string;
  hasSettings: boolean;
  settingsMode?: "schema" | "custom";
  iconUri?: string;
  capabilities: string[];
}

export type DesktopCorePluginId = "memory" | "daily-materials";

export interface DesktopCorePluginItem {
  id: DesktopCorePluginId;
  name: string;
  version: "built-in";
  description: string;
  source: { kind: "builtin" };
  enabled: boolean;
  settingsHref: string;
}

export interface DesktopMemoryPluginDetail {
  id: "memory";
  values: {
    enabled: boolean;
    backend: string;
    reflectionTime: string;
    reflectionNotifications: boolean;
  };
  backends: Array<{ value: string; label: string }>;
}

export interface DesktopDailyMaterialsPluginDetail {
  id: "daily-materials";
  values: {
    enabled: boolean;
    time: string;
    projectId: string;
    dir: string;
    promptPath: string;
    notifications: boolean;
    scanTokenBudget: number;
    scanModelKey: string;
  };
  projects: Array<{ value: string; label: string }>;
  models: Array<{ value: string; label: string }>;
}

export type DesktopCorePluginDetail = DesktopMemoryPluginDetail | DesktopDailyMaterialsPluginDetail;

export async function loadDesktopCorePlugins(endpoint: string): Promise<DesktopCorePluginItem[]> {
  const payload = await requestJson<{ ok: boolean; items: DesktopCorePluginItem[] }>(
    endpoint,
    "/api/settings/plugins/core"
  );
  return payload.items ?? [];
}

export async function loadDesktopCorePluginDetail(
  endpoint: string,
  pluginId: DesktopCorePluginId
): Promise<DesktopCorePluginDetail> {
  const path = `/api/settings/plugins/core/${encodeURIComponent(pluginId)}`;
  if (pluginId === "memory") {
    const payload = await requestJson<Omit<DesktopMemoryPluginDetail, "id"> & { ok: boolean }>(endpoint, path);
    return { id: "memory", values: payload.values, backends: payload.backends };
  }
  const payload = await requestJson<Omit<DesktopDailyMaterialsPluginDetail, "id"> & { ok: boolean }>(endpoint, path);
  return { id: "daily-materials", values: payload.values, projects: payload.projects, models: payload.models };
}

/**
 * Fixed-origin URL for a custom plugin's settings document in the Tauri app.
 * The native protocol forwards only this plugin's UI mount to the managed
 * loopback service, so Desktop never needs a wildcard localhost frame source.
 */
export function desktopPluginSettingsFrameUrl(pluginId: string, uiEntry: string): string {
  const cleanEntry = uiEntry.replace(/^ui\//, "");
  return `molibot-plugin://${pluginId}/${cleanEntry}`;
}

export async function setDesktopCorePluginEnabled(
  endpoint: string,
  pluginId: DesktopCorePluginId,
  enabled: boolean
): Promise<boolean> {
  const payload = await requestJson<{ ok: boolean; enabled: boolean }>(
    endpoint,
    `/api/settings/plugins/core/${encodeURIComponent(pluginId)}/enable`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    }
  );
  return payload.enabled;
}

export async function saveDesktopCorePluginSettings(
  endpoint: string,
  pluginId: DesktopCorePluginId,
  values: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payload = await requestJson<{ ok: boolean; values: Record<string, unknown> }>(
    endpoint,
    `/api/settings/plugins/core/${encodeURIComponent(pluginId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    }
  );
  return payload.values;
}

export interface DesktopContractPluginDetail {
  item: DesktopContractPluginItem;
  manifest?: any;
  schema?: Record<string, any>;
  presentation?: Array<{
    key: string;
    label: { zh: string; en: string };
    description?: { zh: string; en: string };
    secret?: boolean;
    placeholder?: string;
  }>;
  settingsValues?: Record<string, any>;
  secretsPresence?: Record<string, { present: boolean }>;
  retainedState: {
    hasConfig: boolean;
    hasData: boolean;
    hasCache: boolean;
  };
}

export async function loadDesktopContractPlugins(endpoint: string): Promise<DesktopContractPluginItem[]> {
  const payload = await requestJson<{ ok: boolean; items: DesktopContractPluginItem[] }>(
    endpoint,
    "/api/settings/plugins/contract"
  );
  return payload.items ?? [];
}

export async function loadDesktopContractPluginDetail(
  endpoint: string,
  pluginId: string
): Promise<DesktopContractPluginDetail | null> {
  const payload = await requestJson<{ ok: boolean; detail?: DesktopContractPluginDetail }>(
    endpoint,
    `/api/settings/plugins/contract/${encodeURIComponent(pluginId)}`
  );
  return payload.detail ?? null;
}

export async function setDesktopContractPluginEnabled(
  endpoint: string,
  pluginId: string,
  enabled: boolean
): Promise<boolean> {
  const payload = await requestJson<{ ok: boolean; enabled: boolean }>(
    endpoint,
    `/api/settings/plugins/contract/${encodeURIComponent(pluginId)}/enable`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    }
  );
  return payload.ok;
}

export async function saveDesktopContractPluginSettings(
  endpoint: string,
  pluginId: string,
  patch: { values?: Record<string, any>; secrets?: { replace?: Record<string, string>; clear?: string[] } }
): Promise<boolean> {
  const payload = await requestJson<{ ok: boolean }>(
    endpoint,
    `/api/settings/plugins/contract/${encodeURIComponent(pluginId)}/settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }
  );
  return payload.ok;
}

export async function invokeDesktopContractPluginAction(
  endpoint: string,
  pluginId: string,
  action: string,
  input?: unknown
): Promise<unknown> {
  const payload = await requestJson<{ ok: boolean; result?: unknown; error?: string }>(
    endpoint,
    `/api/settings/plugins/contract/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    }
  );
  if (!payload.ok) throw new Error(payload.error || "Plugin action failed");
  return payload.result;
}

export async function performDesktopContractPluginLifecycle(
  endpoint: string,
  pluginId: string,
  action: "uninstall" | "clear-cache" | "delete-config" | "delete-data"
): Promise<boolean> {
  const payload = await requestJson<{ ok: boolean }>(
    endpoint,
    `/api/settings/plugins/contract/${encodeURIComponent(pluginId)}/lifecycle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    }
  );
  return payload.ok;
}

export async function loadDesktopSessionPermission(
  endpoint: string,
  profileId: string,
  conversationId: string
): Promise<"plan" | "manual" | "accept_edits" | "auto"> {
  const query = new URLSearchParams({ profileId, conversationId });
  return (await requestJson<{ ok: true; mode: "plan" | "manual" | "accept_edits" | "auto" }>(endpoint, `/api/desktop/session-permission?${query}`)).mode;
}

export async function saveDesktopSessionPermission(
  endpoint: string,
  profileId: string,
  conversationId: string,
  mode: "plan" | "manual" | "accept_edits" | "auto"
): Promise<typeof mode> {
  return (await requestJson<{ ok: true; mode: typeof mode }>(endpoint, "/api/desktop/session-permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, conversationId, mode })
  })).mode;
}

export async function resolveDesktopPlan(
  endpoint: string,
  input: {
    profileId: string;
    conversationId: string;
    planId: string;
    decision: "accept" | "reject" | "modify";
    mode?: "manual" | "accept_edits";
    title?: string;
    summary?: string;
    steps?: string[];
  }
): Promise<{ plan: DesktopConversationPlan; mode: "plan" | "manual" | "accept_edits" }> {
  return requestJson(endpoint, "/api/desktop/session-permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function loadDesktopModelRouting(endpoint: string): Promise<DesktopModelRoutingSettings> {
  const payload = await requestJson<DesktopModelRoutingResponse>(endpoint, "/api/desktop/model-routing");
  return payload.routing;
}

export async function saveDesktopModelRouting(
  endpoint: string,
  routing: DesktopModelRoutingUpdateRequest
): Promise<DesktopModelRoutingSettings> {
  const payload = await requestJson<DesktopModelRoutingResponse>(endpoint, "/api/desktop/model-routing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routing)
  });
  return payload.routing;
}

export async function loadDesktopWebProfiles(endpoint: string): Promise<DesktopWebProfile[]> {
  const payload = await requestJson<DesktopWebProfilesResponse>(endpoint, "/api/desktop/profiles");
  return payload.profiles;
}

export async function patchDesktopWebProfile(
  endpoint: string,
  profileId: string,
  patch: DesktopWebProfilePatch
): Promise<DesktopWebProfile> {
  const payload = await requestJson<{ ok: true; profile: DesktopWebProfile }>(
    endpoint,
    "/api/desktop/profiles",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: profileId, ...patch })
    }
  );
  return payload.profile;
}

export async function saveDesktopWebProfile(
  endpoint: string,
  profile: DesktopWebProfileSaveRequest
): Promise<DesktopWebProfile> {
  const payload = await requestJson<{ ok: true; profile: DesktopWebProfile }>(endpoint, "/api/desktop/profiles", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  });
  return payload.profile;
}

export async function deleteDesktopWebProfile(endpoint: string, profileId: string): Promise<void> {
  await requestJson<{ ok: true }>(endpoint, `/api/desktop/profiles?id=${encodeURIComponent(profileId)}`, { method: "DELETE" });
}

export interface InferredModelMatchResponse {
  ok: boolean;
  matched: boolean;
  matchedId?: string;
  alias?: string;
  tags?: DesktopProviderModelTag[];
  supportedRoles?: string[];
  contextWindow?: number;
  maxTokens?: number;
  thinking?: {
    supported: boolean;
    format?: "thought_tag" | "reasoning_content" | "standard";
    options?: Array<{ type: string; values?: string[] }>;
  };
  reasoning?: boolean;
  toolCall?: boolean;
  vision?: boolean;
  audioInput?: boolean;
  stt?: boolean;
  tts?: boolean;
}

export async function matchModelCapabilities(
  endpoint: string,
  modelId: string
): Promise<InferredModelMatchResponse> {
  return requestJson<InferredModelMatchResponse>(
    endpoint,
    `/api/desktop/models/match?query=${encodeURIComponent(modelId)}`
  );
}


export async function loadDesktopProfileFiles(endpoint: string, profileId: string): Promise<Record<string, string>> {
  const query = new URLSearchParams({ profileId });
  const payload = await requestJson<DesktopProfileFilesResponse>(endpoint, `/api/desktop/profile-files?${query.toString()}`);
  return payload.files;
}

export async function saveDesktopProfileFiles(
  endpoint: string,
  profileId: string,
  files: Record<string, string>
): Promise<Record<string, string>> {
  const payload = await requestJson<DesktopProfileFilesResponse>(endpoint, "/api/desktop/profile-files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, files })
  });
  return payload.files;
}

/** True when at least one Web Profile is enabled — the precondition for Chat. */
export function hasEnabledWebProfile(profiles: DesktopWebProfile[]): boolean {
  return profiles.some((profile) => profile.enabled);
}

/** Normalizes a profile name, falling back to the id when blank. */
export function sanitizeWebProfileName(name: string, fallbackId: string): string {
  const trimmed = String(name ?? "").trim();
  return trimmed || fallbackId;
}

export interface DesktopUsageQuery {
  range: DesktopUsageRange;
  modelId: string;
  botId: string;
  channel: string;
  page: number;
  pageSize: number;
}

export async function loadDesktopUsage(endpoint: string, query: DesktopUsageQuery): Promise<DesktopUsageSummary> {
  const params = new URLSearchParams({
    range: query.range,
    modelId: query.modelId,
    botId: query.botId,
    channel: query.channel,
    page: String(Math.max(1, query.page)),
    pageSize: String(Math.max(10, Math.min(100, query.pageSize)))
  });
  const payload = await requestJson<DesktopUsageResponse>(endpoint, `/api/desktop/usage?${params.toString()}`);
  return payload.summary;
}

/** Formats a token count with thousands separators (e.g. 1234567 → "1,234,567"). */
export function formatTokenCount(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return n.toLocaleString("en-US");
}

/** Formats a millisecond duration as a compact "1m 23s" / "12s" / "<1s" string. */
export function formatDurationMs(valueMs: number): string {
  const ms = Number.isFinite(valueMs) ? Math.max(0, Math.round(valueMs)) : 0;
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** Formats long-running Trace durations without leaking unbounded raw minutes. */
export function formatLongDurationMs(valueMs: number, locale: "zh-CN" | "en"): string {
  const ms = Number.isFinite(valueMs) ? Math.max(0, Math.round(valueMs)) : 0;
  if (ms < 1000) return locale === "zh-CN" ? "少于 1 秒" : "<1s";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor(totalSeconds % 86_400 / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  const parts = locale === "zh-CN"
    ? [[days, " 天"], [hours, " 小时"], [minutes, " 分钟"], [seconds, " 秒"]] as const
    : [[days, "d"], [hours, "h"], [minutes, "m"], [seconds, "s"]] as const;
  const first = parts.findIndex(([value]) => value > 0);
  return parts.slice(first < 0 ? parts.length - 1 : first, Math.min(parts.length, (first < 0 ? parts.length - 1 : first) + 3))
    .filter(([value], index) => value > 0 || index === 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}

export async function loadDesktopRunHistory(endpoint: string, limit = 200): Promise<DesktopRunHistoryItem[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const payload = await requestJson<DesktopRunHistoryResponse>(
    endpoint,
    `/api/desktop/run-history?${query.toString()}`
  );
  return payload.items;
}

export interface DesktopTraceQuery {
  range: DesktopTraceRange;
  factType: DesktopTraceFactType;
  botId: string;
  channel: string;
  chatId: string;
  sessionId: string;
  runId: string;
  sourceLimit: number;
  page: number;
  pageSize: number;
}

export async function loadDesktopTrace(endpoint: string, query: DesktopTraceQuery): Promise<DesktopTraceSummary> {
  const params = new URLSearchParams({
    range: query.range,
    factType: query.factType,
    botId: query.botId,
    channel: query.channel,
    chatId: query.chatId,
    sessionId: query.sessionId,
    runId: query.runId,
    sourceLimit: String(Math.max(1000, Math.min(10000, query.sourceLimit))),
    page: String(Math.max(1, query.page)),
    pageSize: String(Math.max(10, Math.min(100, query.pageSize)))
  });
  const payload = await requestJson<DesktopTraceResponse>(endpoint, `/api/desktop/trace?${params.toString()}`);
  return payload.summary;
}

export async function loadDesktopSandbox(endpoint: string): Promise<DesktopSandboxSummary> {
  const payload = await requestJson<DesktopSandboxResponse>(endpoint, "/api/desktop/sandbox");
  return payload.sandbox;
}

export async function saveDesktopSandbox(endpoint: string, input: DesktopSandboxUpdateRequest): Promise<DesktopSandboxSummary> {
  const payload = await requestJson<DesktopSandboxResponse>(endpoint, "/api/desktop/sandbox", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return payload.sandbox;
}

export type DesktopSandboxPreset = "full" | "standard" | "readonly" | "locked";

const SANDBOX_DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"];
const SANDBOX_DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];
const SANDBOX_BUILD_DOMAINS = [
  "npmjs.org", "*.npmjs.org", "registry.npmjs.org", "registry.yarnpkg.com",
  "pypi.org", "*.pypi.org", "github.com", "*.github.com", "api.github.com", "raw.githubusercontent.com"
];

const DESKTOP_SANDBOX_PRESETS: Record<DesktopSandboxPreset, DesktopSandboxUpdateRequest> = {
  full: {
    enabled: true,
    initFailureMode: "block",
    envFilePath: ".env",
    env: { inheritMode: "minimal", allow: [], deny: [] },
    network: { allowedDomains: ["*"], deniedDomains: [] },
    filesystem: { denyRead: SANDBOX_DEFAULT_DENY_READ, allowWrite: [".", "/tmp", "scratch"], denyWrite: SANDBOX_DEFAULT_DENY_WRITE }
  },
  standard: {
    enabled: true,
    initFailureMode: "block",
    envFilePath: ".env",
    env: { inheritMode: "allowlist", allow: [], deny: [] },
    network: { allowedDomains: SANDBOX_BUILD_DOMAINS, deniedDomains: [] },
    filesystem: { denyRead: SANDBOX_DEFAULT_DENY_READ, allowWrite: [".", "/tmp", "scratch"], denyWrite: SANDBOX_DEFAULT_DENY_WRITE }
  },
  readonly: {
    enabled: true,
    initFailureMode: "block",
    envFilePath: ".env",
    env: { inheritMode: "minimal", allow: [], deny: [] },
    network: { allowedDomains: ["*"], deniedDomains: [] },
    filesystem: { denyRead: SANDBOX_DEFAULT_DENY_READ, allowWrite: ["/tmp", "scratch"], denyWrite: SANDBOX_DEFAULT_DENY_WRITE }
  },
  locked: {
    enabled: true,
    initFailureMode: "block",
    envFilePath: ".env",
    env: { inheritMode: "minimal", allow: [], deny: [] },
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: SANDBOX_DEFAULT_DENY_READ, allowWrite: ["/tmp"], denyWrite: SANDBOX_DEFAULT_DENY_WRITE }
  }
};

export function parseDesktopSandboxList(input: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of input.split(/\r?\n|,/)) {
    const value = row.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function applyDesktopSandboxPreset(name: DesktopSandboxPreset): DesktopSandboxUpdateRequest {
  const preset = DESKTOP_SANDBOX_PRESETS[name];
  return {
    ...preset,
    env: { ...preset.env, allow: [...(preset.env?.allow ?? [])], deny: [...(preset.env?.deny ?? [])] },
    network: { allowedDomains: [...(preset.network?.allowedDomains ?? [])], deniedDomains: [...(preset.network?.deniedDomains ?? [])] },
    filesystem: {
      denyRead: [...(preset.filesystem?.denyRead ?? [])],
      allowWrite: [...(preset.filesystem?.allowWrite ?? [])],
      denyWrite: [...(preset.filesystem?.denyWrite ?? [])]
    }
  };
}

function sandboxListsMatch(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function detectDesktopSandboxPreset(input: DesktopSandboxUpdateRequest): DesktopSandboxPreset | "custom" {
  if (input.enabled !== true) return "custom";
  for (const name of ["full", "standard", "readonly", "locked"] as const) {
    const preset = DESKTOP_SANDBOX_PRESETS[name];
    if (
      input.initFailureMode === preset.initFailureMode &&
      input.env?.inheritMode === preset.env?.inheritMode &&
      sandboxListsMatch(input.env?.allow, preset.env?.allow) &&
      sandboxListsMatch(input.env?.deny, preset.env?.deny) &&
      sandboxListsMatch(input.network?.allowedDomains, preset.network?.allowedDomains) &&
      sandboxListsMatch(input.network?.deniedDomains, preset.network?.deniedDomains) &&
      sandboxListsMatch(input.filesystem?.denyRead, preset.filesystem?.denyRead) &&
      sandboxListsMatch(input.filesystem?.allowWrite, preset.filesystem?.allowWrite) &&
      sandboxListsMatch(input.filesystem?.denyWrite, preset.filesystem?.denyWrite)
    ) return name;
  }
  return "custom";
}

export interface DesktopHostBashPermissions {
  envAllowlist: string[];
  filesystem: string;
  network: string;
}

export interface DesktopHostBashPendingRecord {
  id: string;
  toolId: string;
  category?: "bash" | "mcp" | "file_write" | "miniapp";
  displayName: string;
  command: string;
  reason: string;
  channel?: string;
  chatId?: string;
  scopeId: string;
  sessionId?: string;
  approvalMode: "persistent" | "ephemeral" | "session" | "all";
  status: string;
  permissions: DesktopHostBashPermissions;
  requestedAt: string;
  resolvedAt?: string;
  executedAt?: string;
  errorText?: string;
}

export interface DesktopHostBashWhitelistEntry {
  id: string;
  toolId: string;
  category?: "bash" | "mcp" | "file_write" | "miniapp";
  displayName: string;
  command: string;
  reason: string;
  channel?: string;
  chatId?: string;
  scopeId: string;
  permissions: DesktopHostBashPermissions;
  approvedAt: string;
  approvedFromRecordId: string;
  enabled: boolean;
}

export interface DesktopHostBashSettingsData {
  pending: DesktopHostBashPendingRecord[];
  whitelist: DesktopHostBashWhitelistEntry[];
  history: DesktopHostBashPendingRecord[];
  counts: {
    pending: number;
    whitelist: number;
    whitelistEnabled: number;
    history: number;
  };
}

export async function loadDesktopHostBash(endpoint: string): Promise<DesktopHostBashSummary> {
  const payload = await requestJson<DesktopHostBashResponse>(endpoint, "/api/desktop/host-bash");
  return payload.summary;
}

export async function loadDesktopHostBashSettings(
  endpoint: string,
  params?: { category?: string; status?: string; mode?: string; query?: string }
): Promise<DesktopHostBashSettingsData> {
  const search = new URLSearchParams();
  if (params?.category && params.category !== "all") search.set("category", params.category);
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.mode && params.mode !== "all") search.set("mode", params.mode);
  if (params?.query?.trim()) search.set("query", params.query.trim());
  const queryStr = search.toString() ? `?${search.toString()}` : "";
  const payload = await requestJson<{ ok: boolean } & DesktopHostBashSettingsData>(
    endpoint,
    `/api/desktop/host-bash${queryStr}`
  );
  return {
    pending: Array.isArray(payload.pending) ? payload.pending : [],
    whitelist: Array.isArray(payload.whitelist) ? payload.whitelist : [],
    history: Array.isArray(payload.history) ? payload.history : [],
    counts: payload.counts ?? {
      pending: payload.pending?.length ?? 0,
      whitelist: payload.whitelist?.length ?? 0,
      whitelistEnabled: payload.whitelist?.filter((i) => i.enabled).length ?? 0,
      history: payload.history?.length ?? 0
    }
  };
}

export async function toggleDesktopHostBashWhitelist(
  endpoint: string,
  id: string,
  enabled: boolean
): Promise<DesktopHostBashSummary> {
  await requestJson<DesktopHostBashToggleResponse>(endpoint, "/api/desktop/host-bash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle_whitelist", id, enabled })
  });
  return loadDesktopHostBash(endpoint);
}

export const toggleDesktopHostBashWhitelistItem = toggleDesktopHostBashWhitelist;

export async function deleteDesktopHostBashWhitelistItem(
  endpoint: string,
  id: string
): Promise<void> {
  await requestJson(endpoint, "/api/desktop/host-bash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete_whitelist", id })
  });
}

export async function deleteDesktopHostBashHistoryRecord(
  endpoint: string,
  id: string
): Promise<void> {
  await requestJson(endpoint, "/api/desktop/host-bash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete_history", id })
  });
}

export async function loadDesktopTasks(endpoint: string): Promise<DesktopTaskSummary> {
  const payload = await requestJson<DesktopTaskResponse>(endpoint, "/api/desktop/tasks");
  const items = payload.summary.items
    .filter((item) => item.type === "periodic" || item.type === "one-shot")
    .map((item) => ({
      ...item,
      category: item.category === "system" ? "system" as const : item.category === "project" ? "project" as const : "user" as const,
      systemKind: (item.systemKind === "memory-reflection" || item.systemKind === "daily-materials" ? item.systemKind : "") as DesktopTaskSummary["items"][number]["systemKind"],
      enabled: item.enabled !== false,
      reminderUnread: item.type === "one-shot" && item.reminderUnread === true,
      executions: Array.isArray(item.executions) ? item.executions : [],
      executionCount: Number(item.executionCount ?? item.executions?.length ?? 0)
    }));
  const counts: DesktopTaskSummary["counts"] = {
    total: items.length,
    byType: { "one-shot": 0, periodic: 0, immediate: 0 },
    byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 },
    byScope: { workspace: 0, chatScratch: 0 },
    byChannel: {},
    unreadOneShot: 0,
    executions: payload.summary.counts.executions ?? { total: 0, completed: 0, failed: 0 }
  };
  for (const item of items) {
    counts.byType[item.type] += 1;
    counts.byStatus[item.status] += 1;
    item.scope === "workspace" ? counts.byScope.workspace += 1 : counts.byScope.chatScratch += 1;
    counts.byChannel[item.channel] = (counts.byChannel[item.channel] ?? 0) + 1;
    if (item.type === "one-shot" && item.category === "user" && item.reminderUnread) counts.unreadOneShot += 1;
  }
  return { items, counts, targets: Array.isArray(payload.summary.targets) ? payload.summary.targets : [] };
}

export async function loadDesktopTaskUnreadCount(endpoint: string): Promise<number> {
  const payload = await requestJson<DesktopTaskResponse>(endpoint, "/api/desktop/tasks?view=badge");
  if (Number.isFinite(payload.summary.counts.unreadOneShot)) return payload.summary.counts.unreadOneShot;
  return payload.summary.items.filter((item) => item.type === "one-shot" && item.category !== "system" && item.reminderUnread === true).length;
}

export async function runDesktopTaskAction(endpoint: string, input: DesktopTaskActionRequest): Promise<DesktopTaskActionResponse> {
  return requestJson<DesktopTaskActionResponse>(endpoint, "/api/desktop/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export async function loadDesktopDurableExecutions(endpoint: string): Promise<DesktopDurableExecutionItem[]> {
  const payload = await requestJson<DesktopDurableExecutionResponse>(endpoint, "/api/desktop/durable-executions");
  return payload.items;
}

export async function loadDesktopDurableExecution(endpoint: string, executionId: string): Promise<DesktopDurableExecutionInspection> {
  const route = "/api/desktop/durable-executions?id=" + encodeURIComponent(executionId);
  const payload = await requestJson<DesktopDurableExecutionInspectionResponse>(endpoint, route);
  return payload.item;
}

export async function loadDesktopDurableEvidence(endpoint: string, executionId: string, evidenceId: string): Promise<DesktopDurableExecutionEvidenceRead> {
  const route = "/api/desktop/durable-executions?id=" + encodeURIComponent(executionId) + "&evidenceId=" + encodeURIComponent(evidenceId);
  const payload = await requestJson<DesktopDurableExecutionEvidenceReadResponse>(endpoint, route);
  return payload.evidence;
}

export async function runDesktopDurableExecutionAction(
  endpoint: string,
  input: DesktopDurableExecutionActionRequest
): Promise<DesktopDurableExecutionActionResponse> {
  return requestJson<DesktopDurableExecutionActionResponse>(endpoint, "/api/desktop/durable-executions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function loadDesktopTaskHistory(endpoint: string, id: string, page: number, pageSize = 10) {
  const payload = await runDesktopTaskAction(endpoint, { action: "history", id, page, pageSize });
  if (!payload.history) throw new Error("Execution history not found");
  return payload.history;
}

export async function loadDesktopTaskSession(
  endpoint: string,
  id: string,
  executionId: string
): Promise<NonNullable<DesktopTaskActionResponse["session"]>> {
  const payload = await runDesktopTaskAction(endpoint, { action: "session", id, executionId });
  if (!payload.session) throw new Error("Session not found");
  return normalizeDesktopTaskSession(payload.session);
}

function desktopTaskContentText(content: unknown): string {
  if (typeof content === "string") {
    const value = content.trim();
    if (!value || (value[0] !== "[" && value[0] !== "{")) return value;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isDesktopAgentContent(parsed)) return desktopTaskContentText(parsed);
    } catch {
      // Preserve ordinary text and malformed JSON verbatim.
    }
    return value;
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map((block) => {
    if (!block || typeof block !== "object") return "";
    const item = block as { type?: unknown; text?: unknown };
    return item.type === "text" && typeof item.text === "string" ? item.text.trim() : "";
  }).filter(Boolean).join("\n").trim();
}

function isDesktopAgentContent(value: unknown): boolean {
  const blocks = Array.isArray(value) ? value : [value];
  const knownTypes = new Set(["text", "thinking", "toolCall", "toolResult", "image"]);
  return blocks.length > 0 && blocks.every((block) => Boolean(block) && typeof block === "object" && knownTypes.has(String((block as { type?: unknown }).type ?? "")));
}

export function normalizeDesktopTaskSession(session: {
  taskId: string;
  sessionId: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
}): NonNullable<DesktopTaskActionResponse["session"]> {
  return {
    ...session,
    messages: session.messages.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const content = desktopTaskContentText(message.content);
      return content ? [{ role: message.role, content, createdAt: message.createdAt ?? "" }] : [];
    })
  };
}

export async function loadDesktopProviders(endpoint: string): Promise<DesktopProvidersSummary> {
  const payload = await requestJson<DesktopProvidersResponse>(endpoint, "/api/desktop/providers");
  return payload.summary;
}

export async function loadDesktopProviderAuth(endpoint: string): Promise<DesktopProviderAuthOverviewResponse["providers"]> {
  const payload = await requestJson<DesktopProviderAuthOverviewResponse>(endpoint, "/api/desktop/provider-auth");
  return payload.providers;
}

export async function startDesktopProviderAuth(endpoint: string, providerId: string): Promise<DesktopProviderAuthSession> {
  const payload = await requestJson<DesktopProviderAuthSessionResponse>(endpoint, "/api/desktop/provider-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId })
  });
  return payload.session;
}

export async function loadDesktopProviderAuthSession(endpoint: string, sessionId: string): Promise<DesktopProviderAuthSession> {
  const payload = await requestJson<DesktopProviderAuthSessionResponse>(
    endpoint,
    `/api/desktop/provider-auth/sessions/${encodeURIComponent(sessionId)}`
  );
  return payload.session;
}

export async function answerDesktopProviderAuth(
  endpoint: string,
  sessionId: string,
  answer: DesktopProviderAuthAnswerRequest
): Promise<DesktopProviderAuthSession> {
  const payload = await requestJson<DesktopProviderAuthSessionResponse>(
    endpoint,
    `/api/desktop/provider-auth/sessions/${encodeURIComponent(sessionId)}/answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer)
    }
  );
  return payload.session;
}

export async function cancelDesktopProviderAuth(endpoint: string, sessionId: string): Promise<DesktopProviderAuthSession> {
  const payload = await requestJson<DesktopProviderAuthSessionResponse>(
    endpoint,
    `/api/desktop/provider-auth/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
  return payload.session;
}

export async function verifyDesktopProviderAuth(
  endpoint: string,
  providerId: string,
  model?: string
): Promise<DesktopProviderAuthVerifyResponse["result"]> {
  const payload = await requestJson<DesktopProviderAuthVerifyResponse>(
    endpoint,
    "/api/desktop/provider-auth/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, model })
    }
  );
  return payload.result;
}

export async function logoutDesktopProviderAuth(endpoint: string, providerId: string): Promise<boolean> {
  const payload = await requestJson<DesktopProviderAuthLogoutResponse>(
    endpoint,
    `/api/desktop/provider-auth/credentials/${encodeURIComponent(providerId)}`,
    { method: "DELETE" }
  );
  return payload.removed;
}

export interface DesktopAgentTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  /** The version this build ships. */
  version: string;
  installed: boolean;
  /** The installed copy's version; empty when it predates version tracking. */
  installedVersion: string;
  updateAvailable: boolean;
  /** True when the installed copy no longer matches the files Molibot wrote. */
  modified: boolean;
}

export interface DesktopAgentTemplateInstallResult {
  templateId: string;
  agentId: string;
}

export interface DesktopAgentTemplateUpdateResult {
  templateId: string;
  agentId: string;
  from: string;
  to: string;
  /** Set when the installed copy had diverged and was preserved at this path. */
  backupDir?: string;
}

export async function loadDesktopAgentTemplates(endpoint: string): Promise<DesktopAgentTemplateSummary[]> {
  const payload = await requestJson<{ ok: true; templates: DesktopAgentTemplateSummary[] }>(endpoint, "/api/desktop/agent-templates");
  return payload.templates;
}

export async function installDesktopAgentTemplate(endpoint: string, templateId: string): Promise<DesktopAgentTemplateInstallResult> {
  const payload = await requestJson<{ ok: true; templateId: string; agentId: string }>(endpoint, "/api/desktop/agent-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, action: "install" })
  });
  return { templateId: payload.templateId, agentId: payload.agentId };
}

/** Re-applies the shipped files of an installed built-in Agent over the owner's copy. */
export async function updateDesktopAgentTemplate(endpoint: string, templateId: string): Promise<DesktopAgentTemplateUpdateResult> {
  const payload = await requestJson<{ ok: true; templateId: string; agentId: string; from: string; to: string; backupDir?: string }>(endpoint, "/api/desktop/agent-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, action: "update" })
  });
  return { templateId: payload.templateId, agentId: payload.agentId, from: payload.from, to: payload.to, backupDir: payload.backupDir };
}

export async function loadDesktopAgents(endpoint: string): Promise<DesktopAgentsSummary> {
  const payload = await requestJson<DesktopAgentsResponse>(endpoint, "/api/desktop/agents");
  return payload.summary;
}

export async function loadDesktopAgentActivity(endpoint: string): Promise<DesktopAgentActivityItem[]> {
  const payload = await requestJson<DesktopAgentActivityResponse>(endpoint, "/api/desktop/agent-activity");
  return payload.items;
}

export async function loadDesktopActiveRuns(endpoint: string): Promise<DesktopActiveRunItem[]> {
  const payload = await requestJson<DesktopActiveRunsResponse>(endpoint, "/api/desktop/active-runs");
  return payload.items;
}

export async function stopDesktopActiveRun(endpoint: string, runId: string): Promise<DesktopActiveRunActionResponse["result"]> {
  const payload = await requestJson<DesktopActiveRunActionResponse>(endpoint, "/api/desktop/active-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
  return payload.result;
}

export async function saveDesktopAgent(endpoint: string, agent: DesktopAgentSaveRequest): Promise<DesktopAgentsSummary> {
  const payload = await requestJson<DesktopAgentsResponse>(endpoint, "/api/desktop/agents", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent)
  });
  return payload.summary;
}

export async function deleteDesktopAgent(endpoint: string, agentId: string): Promise<DesktopAgentsSummary> {
  const payload = await requestJson<DesktopAgentsResponse>(endpoint, `/api/desktop/agents?id=${encodeURIComponent(agentId)}`, { method: "DELETE" });
  return payload.summary;
}

export async function loadDesktopAgentFiles(endpoint: string, agentId: string): Promise<Record<string, string>> {
  const query = new URLSearchParams({ scope: "agent", agentId });
  const payload = await requestJson<DesktopProfileFilesResponse>(endpoint, `/api/desktop/profile-files?${query.toString()}`);
  return payload.files;
}

export async function saveDesktopAgentFiles(endpoint: string, agentId: string, files: Record<string, string>): Promise<Record<string, string>> {
  const payload = await requestJson<DesktopProfileFilesResponse>(endpoint, "/api/desktop/profile-files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "agent", agentId, files })
  });
  return payload.files;
}

export async function loadDesktopMcp(endpoint: string): Promise<DesktopMcpSummary> {
  const payload = await requestJson<DesktopMcpResponse>(endpoint, "/api/desktop/mcp");
  return payload.summary;
}

export async function saveDesktopMcp(endpoint: string, input: DesktopMcpSaveRequest): Promise<DesktopMcpSummary> {
  const payload = await requestJson<DesktopMcpResponse>(endpoint, "/api/desktop/mcp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return payload.summary;
}

export async function deleteDesktopMcp(endpoint: string, id: string): Promise<DesktopMcpSummary> {
  const payload = await requestJson<DesktopMcpResponse>(endpoint, `/api/desktop/mcp?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  return payload.summary;
}

export async function toggleDesktopMcp(endpoint: string, id: string, enabled: boolean): Promise<DesktopMcpSummary> {
  const payload = await requestJson<DesktopMcpResponse>(endpoint, "/api/desktop/mcp", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, enabled })
  });
  return payload.summary;
}

export async function reconnectDesktopMcp(endpoint: string, id: string): Promise<DesktopMcpSummary> {
  const payload = await requestJson<DesktopMcpResponse>(endpoint, "/api/desktop/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action: "reconnect" })
  });
  return payload.summary;
}

export async function reconnectAllDesktopMcp(endpoint: string): Promise<DesktopMcpSummary> {
  const payload = await requestJson<DesktopMcpResponse>(endpoint, "/api/desktop/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reconnectAll" })
  });
  return payload.summary;
}

export async function loadDesktopOpenConnector(endpoint: string): Promise<DesktopOpenConnectorSummary> {
  const payload = await requestJson<DesktopOpenConnectorResponse>(endpoint, "/api/desktop/open-connector");
  return payload.summary;
}

export async function refreshDesktopOpenConnector(endpoint: string): Promise<DesktopOpenConnectorSummary> {
  const payload = await requestJson<DesktopOpenConnectorResponse>(endpoint, "/api/desktop/open-connector", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "refresh-catalog" })
  });
  return payload.summary;
}

export async function saveDesktopOpenConnector(endpoint: string, input: DesktopOpenConnectorSaveRequest): Promise<DesktopOpenConnectorSummary> {
  const payload = await requestJson<DesktopOpenConnectorResponse>(endpoint, "/api/desktop/open-connector", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return payload.summary;
}

export async function revealDesktopOpenConnectorToken(endpoint: string): Promise<string> {
  const payload = await requestJson<DesktopOpenConnectorTokenResponse>(endpoint, "/api/desktop/open-connector", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reveal-token" })
  });
  if (!payload.ok) throw new Error(payload.error || "Failed to reveal OpenConnector Runtime Token");
  return payload.runtimeToken ?? "";
}

export async function loadDesktopSkills(endpoint: string): Promise<DesktopSkillsSummary> {
  const payload = await requestJson<DesktopSkillsResponse>(endpoint, "/api/desktop/skills");
  return payload.summary;
}

export async function loadDesktopComposerSuggestions(endpoint: string, projectId = ""): Promise<DesktopComposerSuggestion[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}&profileId=personal` : "";
  const payload = await requestJson<{ ok: true; suggestions: DesktopComposerSuggestion[] }>(endpoint, `/api/desktop/composer-suggestions${query}`);
  return payload.suggestions;
}

export async function updateDesktopSkills(endpoint: string, input: DesktopSkillsUpdateRequest): Promise<DesktopSkillsSummary> {
  const payload = await requestJson<DesktopSkillsResponse>(endpoint, "/api/desktop/skills", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return payload.summary;
}

export async function loadDesktopMemory(endpoint: string): Promise<DesktopMemorySummary> {
  const payload = await requestJson<DesktopMemoryResponse>(endpoint, "/api/desktop/memory");
  return payload.summary;
}

export async function runDesktopMemoryAction(endpoint: string, input: DesktopMemoryActionRequest): Promise<DesktopMemoryActionResponse> {
  return requestJson<DesktopMemoryActionResponse>(endpoint, "/api/desktop/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export async function loadDesktopMemoryRejections(endpoint: string): Promise<DesktopMemoryRejectionsResponse> {
  return requestJson<DesktopMemoryRejectionsResponse>(endpoint, "/api/desktop/memory?view=rejections");
}

export async function loadDesktopChannels(endpoint: string): Promise<DesktopChannelsSummary> {
  const payload = await requestJson<DesktopChannelsResponse>(endpoint, "/api/desktop/channels");
  return payload.summary;
}

export async function saveDesktopChannel(endpoint: string, channel: DesktopChannelSaveRequest): Promise<DesktopChannelsSummary> {
  const payload = await requestJson<DesktopChannelsResponse>(endpoint, "/api/desktop/channels", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(channel)
  });
  return payload.summary;
}

export async function deleteDesktopChannel(endpoint: string, channel: string, instanceId: string): Promise<DesktopChannelsSummary> {
  const query = new URLSearchParams({ channel, id: instanceId });
  const payload = await requestJson<DesktopChannelsResponse>(endpoint, `/api/desktop/channels?${query.toString()}`, { method: "DELETE" });
  return payload.summary;
}

export async function testDesktopChannel(endpoint: string, request: DesktopChannelTestRequest): Promise<DesktopChannelTestResponse> {
  return requestJson<DesktopChannelTestResponse>(endpoint, "/api/desktop/channel-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function loadDesktopBotFiles(endpoint: string, channel: string, botId: string): Promise<Record<string, string>> {
  const query = new URLSearchParams({ scope: "bot", channel, profileId: botId });
  const payload = await requestJson<DesktopProfileFilesResponse>(endpoint, `/api/desktop/profile-files?${query.toString()}`);
  return payload.files;
}

export async function saveDesktopBotFiles(endpoint: string, channel: string, botId: string, files: Record<string, string>): Promise<Record<string, string>> {
  const payload = await requestJson<DesktopProfileFilesResponse>(endpoint, "/api/desktop/profile-files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "bot", channel, profileId: botId, files })
  });
  return payload.files;
}

export async function loadDesktopPlugins(endpoint: string): Promise<DesktopPluginsSummary> {
  const payload = await requestJson<DesktopPluginsResponse>(endpoint, "/api/desktop/plugins");
  return payload.summary;
}

export async function saveDesktopPlugins(endpoint: string, input: DesktopPluginsUpdateRequest): Promise<DesktopPluginsSummary> {
  const payload = await requestJson<DesktopPluginsResponse>(endpoint, "/api/desktop/plugins", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return payload.summary;
}

/**
 * The installed catalog and the built-in catalog always travel together.
 *
 * They are two views of one state: installing, updating or uninstalling changes
 * both, so returning only one is how a list ends up showing what was true
 * before the click.
 */
export interface DesktopMiniAppCatalogs {
  items: DesktopMiniAppItem[];
  builtin: DesktopMiniAppBuiltinItem[];
}

function miniAppCatalogs(payload: {
  items: DesktopMiniAppItem[];
  builtin?: DesktopMiniAppBuiltinItem[];
}): DesktopMiniAppCatalogs {
  // `builtin` is tolerated as absent so a desktop build talking to an older
  // service degrades to "no built-ins on offer" instead of throwing.
  return { items: payload.items, builtin: payload.builtin ?? [] };
}

export async function loadDesktopMiniApps(endpoint: string): Promise<DesktopMiniAppCatalogs> {
  return miniAppCatalogs(
    await requestJson<DesktopMiniAppsResponse>(endpoint, "/api/desktop/miniapps")
  );
}

/**
 * Installs (or reinstalls) a built-in from the copy this Molibot build ships.
 *
 * No source to choose and nothing to confirm: the code shipped inside the app
 * the owner is already running, and the app's data directory is never touched.
 */
export async function installDesktopBuiltinMiniApp(
  endpoint: string,
  appId: string
): Promise<DesktopMiniAppBuiltinInstallResponse> {
  return requestJson<DesktopMiniAppBuiltinInstallResponse>(endpoint, "/api/desktop/miniapps/builtin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId } satisfies DesktopMiniAppBuiltinInstallRequest)
  });
}

export async function invokeDesktopMiniAppAction(
  endpoint: string,
  input: DesktopMiniAppInvokeRequest
): Promise<DesktopMiniAppInvokeResponse> {
  return requestJson<DesktopMiniAppInvokeResponse>(endpoint, "/api/desktop/miniapps/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

/**
 * Fetches a file out of a Mini App's data directory and rebuilds it as a `File`
 * for the composer (bridge v2 `composer.attach`).
 *
 * The WebView never learns where the file really lives: it sends the
 * app-relative locator its own iframe supplied and receives bytes.
 */
export async function fetchDesktopMiniAppAttachment(
  endpoint: string,
  input: DesktopMiniAppAttachRequest,
  mimeType: string
): Promise<File> {
  const result = await requestJson<DesktopMiniAppAttachResponse>(endpoint, "/api/desktop/miniapps/attach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes.buffer as ArrayBuffer], result.name, { type: mimeType });
}

export type DesktopMiniAppAudioRequest =
  | {
      action: "chunk";
      appId: string;
      meetingId: string;
      trackId: string;
      seq: number;
      startMs: number;
      endMs: number;
      mimeType: string;
      audioBase64: string;
    }
  | {
      action: "finish";
      appId: string;
      meetingId: string;
      trackId: string;
      expectedLastSeq: number;
      endMs: number;
      captureError: string;
    };

export async function postDesktopMiniAppAudio(endpoint: string, input: DesktopMiniAppAudioRequest): Promise<void> {
  await requestJson(endpoint, "/api/desktop/miniapps/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

/** Clears an app's sidebar badge and returns the refreshed catalogs. */
export async function clearDesktopMiniAppBadge(
  endpoint: string,
  appId: string
): Promise<DesktopMiniAppCatalogs> {
  const result = await requestJson<{ items: DesktopMiniAppItem[]; builtin: DesktopMiniAppBuiltinItem[] }>(
    endpoint,
    "/api/desktop/miniapps/badge",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId } satisfies DesktopMiniAppBadgeClearRequest)
    }
  );
  return { items: result.items, builtin: result.builtin };
}

export async function loadDesktopMiniAppAi(endpoint: string): Promise<DesktopMiniAppAiSettingsResponse> {
  return requestJson<DesktopMiniAppAiSettingsResponse>(endpoint, "/api/desktop/miniapps/ai");
}

export async function saveDesktopMiniAppAiSettings(
  endpoint: string,
  settings: DesktopMiniAppAiSettings
): Promise<DesktopMiniAppAiSettings> {
  return (await requestJson<DesktopMiniAppAiSettingsResponse>(endpoint, "/api/desktop/miniapps/ai", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  })).settings;
}

/**
 * Toggling one app is its own request, not part of the Plugins editor's PUT:
 * a switch must not also commit whatever else is unsaved on that page.
 */
export async function setDesktopMiniAppEnabled(
  endpoint: string,
  appId: string,
  enabled: boolean
): Promise<DesktopMiniAppCatalogs> {
  return miniAppCatalogs(
    await requestJson<DesktopMiniAppsResponse>(endpoint, "/api/desktop/miniapps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, enabled } satisfies DesktopMiniAppToggleRequest)
    })
  );
}

export async function uninstallDesktopMiniApp(
  endpoint: string,
  appId: string,
  deleteData: boolean
): Promise<DesktopMiniAppCatalogs> {
  return miniAppCatalogs(
    await requestJson<DesktopMiniAppsResponse>(endpoint, "/api/desktop/miniapps", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, deleteData } satisfies DesktopMiniAppUninstallRequest)
    })
  );
}

/**
 * Reinstalls a built-in Mini App from the copy this Molibot build ships.
 *
 * Code only: the app's stored data survives the update untouched, which is why
 * this is offered as a one-click button rather than an uninstall/reinstall.
 */
export async function updateDesktopMiniApp(
  endpoint: string,
  appId: string
): Promise<DesktopMiniAppUpdateResponse> {
  return requestJson<DesktopMiniAppUpdateResponse>(endpoint, "/api/desktop/miniapps/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId } satisfies DesktopMiniAppUpdateRequest)
  });
}

/**
 * Installs a Mini App from a local directory, a local ZIP, or a GitHub repo.
 *
 * Success means the new runtime is already active in the current service.
 */
export async function installDesktopMiniApp(
  endpoint: string,
  request: DesktopMiniAppInstallRequest
): Promise<DesktopMiniAppInstallResponse> {
  return requestJson<DesktopMiniAppInstallResponse>(endpoint, "/api/desktop/miniapps/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

/**
 * The iframe URL for a Mini App panel.
 *
 * Deliberately NOT a loopback URL: the service port is decided at runtime while
 * the WebView CSP is fixed at build time, so the panel loads from the fixed
 * `molibot-miniapp://` origin and the Tauri transport forwards it to the real
 * port. `locale` and `theme` are non-sensitive display hints the app reads at
 * startup.
 */
export function miniAppPanelUrl(
  appId: string,
  locale: string,
  theme: "light" | "dark",
  deepLinkPath = ""
): string {
  const params = new URLSearchParams({ locale, theme });
  // A deep link's path is an App-defined locator. It rides along as a query
  // hint exactly like locale/theme so the App reads it at startup, and it is
  // never joined into the URL's path — the transport's traversal rules apply to
  // asset paths, and this value is not one.
  if (deepLinkPath) params.set("path", deepLinkPath);
  return `molibot-miniapp://${appId}/index.html?${params.toString()}`;
}

/**
 * The iframe URL for an Artifact Panel HTML preview.
 *
 * Same pattern as `miniAppPanelUrl`: a fixed `molibot-artifact://` origin the
 * build-time CSP can name, forwarded to the runtime service port by the Tauri
 * transport. The scope + token identify the root - a Project id, or a Session's
 * opaque token from `sessionArtifactToken` - and the path is relative to that
 * root. Each path segment is encoded so spaces and CJK characters survive the
 * URL without becoming traversal; the transport's `is_safe_path` still rejects
 * any `..` segment outright.
 */
export function artifactPreviewUrl(
  scope: "project" | "session",
  token: string,
  path: string,
  locale: string,
  theme: "light" | "dark"
): string {
  const params = new URLSearchParams({ locale, theme });
  const cleanPath = String(path ?? "")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `molibot-artifact://artifact/${scope}/${token}/${cleanPath}?${params.toString()}`;
}

/**
 * The opaque token identifying a Session root for `artifactPreviewUrl`.
 *
 * Re-exported from the shared codec the service decodes with, so the two can
 * never drift - a drift here 404s every Session HTML preview and silently falls
 * back to the pathless blob.
 */
export { encodeSessionArtifactToken as sessionArtifactToken } from "@molibot/shared/artifactToken";

export async function startDailyMaterialsBackfill(endpoint: string): Promise<DailyMaterialsBackfillStatus> {
  const payload = await requestJson<DailyMaterialsBackfillResponse>(endpoint, "/api/desktop/plugins/daily-materials-backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
  return payload.status;
}

export async function loadDailyMaterialsBackfillStatus(endpoint: string): Promise<DailyMaterialsBackfillStatus> {
  const payload = await requestJson<DailyMaterialsBackfillResponse>(endpoint, "/api/desktop/plugins/daily-materials-backfill");
  return payload.status;
}

export async function loadDesktopWebSearch(endpoint: string): Promise<DesktopWebSearchSummary> {
  const payload = await requestJson<DesktopWebSearchResponse>(endpoint, "/api/desktop/web-search");
  return payload.summary;
}

export async function saveDesktopWebSearch(endpoint: string, input: DesktopWebSearchUpdateRequest): Promise<DesktopWebSearchSummary> {
  const payload = await requestJson<DesktopWebSearchResponse>(endpoint, "/api/desktop/web-search", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
  return payload.summary;
}

export async function loadDesktopImageGenerate(endpoint: string): Promise<DesktopMediaGenerateSummary> {
  const payload = await requestJson<DesktopImageGenerateResponse>(endpoint, "/api/desktop/image-generate");
  return payload.summary;
}

export async function saveDesktopImageGenerate(endpoint: string, input: DesktopMediaGenerateUpdateRequest): Promise<DesktopMediaGenerateSummary> {
  const payload = await requestJson<DesktopImageGenerateResponse>(endpoint, "/api/desktop/image-generate", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
  return payload.summary;
}

export async function loadDesktopImageRecognition(endpoint: string): Promise<DesktopImageRecognitionSummary> {
  const payload = await requestJson<DesktopImageRecognitionResponse>(endpoint, "/api/desktop/image-recognition", {
    signal: AbortSignal.timeout(5_000)
  });
  return payload.summary;
}

export async function saveDesktopImageRecognition(
  endpoint: string,
  input: DesktopImageRecognitionUpdateRequest
): Promise<DesktopImageRecognitionSummary> {
  const payload = await requestJson<DesktopImageRecognitionResponse>(endpoint, "/api/desktop/image-recognition", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return payload.summary;
}

export async function testDesktopImageRecognitionSettings(
  endpoint: string,
  input: DesktopImageRecognitionUpdateRequest,
  image: File,
  prompt: string,
  engineId: string
): Promise<DesktopSettingsTestResponse> {
  const value = {
    enabled: input.enabled,
    defaultEngine: input.defaultEngine,
    engineOrder: input.engines.map((engine) => engine.id),
    engines: Object.fromEntries(input.engines.map(({ id, ...engine }) => [id, engine]))
  };
  const form = new FormData();
  form.set("value", JSON.stringify(value));
  form.set("image", image);
  form.set("prompt", prompt);
  form.set("engineId", engineId);
  return requestJson<DesktopSettingsTestResponse>(endpoint, "/api/settings/image-recognition/test", {
    method: "POST",
    body: form
  });
}

export async function loadDesktopVideoGenerate(endpoint: string): Promise<DesktopMediaGenerateSummary> {
  const payload = await requestJson<DesktopVideoGenerateResponse>(endpoint, "/api/desktop/video-generate");
  return payload.summary;
}

export async function saveDesktopVideoGenerate(endpoint: string, input: DesktopMediaGenerateUpdateRequest): Promise<DesktopMediaGenerateSummary> {
  const payload = await requestJson<DesktopVideoGenerateResponse>(endpoint, "/api/desktop/video-generate", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
  return payload.summary;
}

export async function loadDesktopTts(endpoint: string): Promise<DesktopTtsSummary> {
  const payload = await requestJson<DesktopTtsResponse>(endpoint, "/api/desktop/tts-generate");
  return payload.summary;
}

export async function saveDesktopTts(endpoint: string, input: DesktopTtsUpdateRequest): Promise<DesktopTtsSummary> {
  const payload = await requestJson<DesktopTtsResponse>(endpoint, "/api/desktop/tts-generate", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
  return payload.summary;
}

function keyedConfig<T extends { id: string }>(items: T[]): Record<string, Omit<T, "id">> {
  return Object.fromEntries(items.map(({ id, ...item }) => {
    const draft = { ...item } as Omit<T, "id"> & { apiKey?: string; clearApiKey?: boolean };
    if (!draft.clearApiKey && !draft.apiKey?.trim()) delete draft.apiKey;
    return [id, draft];
  }));
}

export async function testDesktopWebSearchSettings(endpoint: string, input: DesktopWebSearchUpdateRequest, query: string, engine: string): Promise<DesktopSettingsTestResponse> {
  return requestJson<DesktopSettingsTestResponse>(endpoint, "/api/settings/web-search/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, engine, webSearch: { ...input, engines: keyedConfig(input.engines) } })
  });
}

export async function testDesktopImageGenerateSettings(endpoint: string, input: DesktopMediaGenerateUpdateRequest, prompt: string, engine: string, size?: string): Promise<DesktopSettingsTestResponse> {
  return requestJson<DesktopSettingsTestResponse>(endpoint, "/api/settings/image-generate/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, engine, size, imageGenerate: { ...input, engines: keyedConfig(input.engines) } })
  });
}

export async function testDesktopVideoGenerateSettings(endpoint: string, input: DesktopMediaGenerateUpdateRequest, prompt: string, engine: string): Promise<DesktopSettingsTestResponse> {
  return requestJson<DesktopSettingsTestResponse>(endpoint, "/api/settings/video-generate/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, engine, videoGenerate: { ...input, engines: keyedConfig(input.engines) } })
  });
}

export async function testDesktopTtsSettings(endpoint: string, input: DesktopTtsUpdateRequest, text: string, provider: string): Promise<DesktopSettingsTestResponse> {
  const providers = keyedConfig(input.providers);
  const selected = providers[provider];
  return requestJson<DesktopSettingsTestResponse>(endpoint, "/api/settings/tts-generate/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, provider, voice: selected?.voice, model: selected?.model, format: selected?.format, ttsGenerate: { ...input, providers } })
  });
}

export async function loadDesktopTtsVoices(endpoint: string): Promise<Array<{ id: string; label?: string; locale?: string; gender?: string }>> {
  const payload = await requestJson<{ ok: true; voices: Array<{ id: string; label?: string; locale?: string; gender?: string }> }>(endpoint, "/api/settings/tts-generate/voices?provider=macos");
  return payload.voices;
}

export function desktopTtsAudioUrl(endpoint: string, response: DesktopSettingsTestResponse): string {
  const result = response.result && typeof response.result === "object" ? response.result as Record<string, unknown> : {};
  const details = result.details && typeof result.details === "object" ? result.details as Record<string, unknown> : {};
  const filePath = String(details.filePath ?? details.path ?? "").replaceAll("\\", "/");
  const marker = "/test-audio/";
  const markerIndex = filePath.lastIndexOf(marker);
  const relative = markerIndex >= 0 ? filePath.slice(markerIndex + marker.length) : "";
  if (!relative || relative.includes("..")) return "";
  return `${endpoint.replace(/\/+$/, "")}/api/settings/tts-generate/audio?file=${encodeURIComponent(`test-audio/${relative}`)}`;
}

export async function loadDesktopMediaTasks(endpoint: string, kind: DesktopMediaTaskKind): Promise<DesktopMediaTask[]> {
  const payload = await requestJson<DesktopMediaTasksResponse>(endpoint, `/api/desktop/media-tasks?kind=${kind}`);
  return payload.tasks;
}

export async function deleteDesktopMediaTask(endpoint: string, kind: DesktopMediaTaskKind, taskId: string): Promise<void> {
  const query = new URLSearchParams({ kind, taskId });
  await requestJson<{ ok: true }>(endpoint, `/api/desktop/media-tasks?${query.toString()}`, { method: "DELETE" });
}

export async function loadDesktopExternalSessions(
  endpoint: string
): Promise<DesktopExternalSessionsSummary> {
  const payload = await requestJson<DesktopExternalSessionsResponse>(
    endpoint,
    "/api/desktop/external-sessions"
  );
  return payload.summary;
}

export async function loadDesktopExternalTranscript(
  endpoint: string,
  sessionId: string
): Promise<DesktopExternalTranscript> {
  const payload = await requestJson<DesktopExternalTranscriptResponse>(
    endpoint,
    `/api/desktop/external-sessions/${encodeURIComponent(sessionId)}`
  );
  return payload.transcript;
}

export async function loadDesktopRuntimeEnv(endpoint: string): Promise<DesktopRuntimeEnvSummary> {
  const payload = await requestJson<DesktopRuntimeEnvResponse>(endpoint, "/api/desktop/runtime-env");
  return payload.summary;
}

/**
 * Returns the dependencies a user still needs to install (plan §10 install
 * page surfaces these prominently). Pure derivation for testability.
 */
export function missingRuntimeDependencies(
  summary: DesktopRuntimeEnvSummary
): DesktopRuntimeEnvSummary["dependencies"] {
  return summary.dependencies.filter((d) => d.status !== "installed");
}

/** A structured runtime/service diagnostics summary for the §9.2 step 5 step. */
export interface OnboardingDiagnostics {
  serviceReady: boolean;
  depsInstalled: number;
  depsTotal: number;
  /** Display names of the optional dependencies still missing. */
  missingDependencyNames: string[];
}

/**
 * Projects the credential-safe runtime-env summary plus the live service-ready
 * flag into the §9.2 step 5 ("展示运行环境诊断") onboarding diagnostics view.
 * Pure for testability. Missing optional dependencies never block onboarding —
 * the step is informational and routes to Settings → Runtime environment.
 */
export function summarizeOnboardingDiagnostics(
  runtimeEnv: DesktopRuntimeEnvSummary | null,
  serviceReady: boolean
): OnboardingDiagnostics {
  if (!runtimeEnv) {
    return { serviceReady, depsInstalled: 0, depsTotal: 0, missingDependencyNames: [] };
  }
  return {
    serviceReady,
    depsInstalled: runtimeEnv.counts.installed,
    depsTotal: runtimeEnv.counts.total,
    missingDependencyNames: missingRuntimeDependencies(runtimeEnv).map((d) => d.name)
  };
}

/**
 * The ordered §9.2 guided-setup steps. The Desktop onboarding flow walks a
 * fresh/broken-config user through these; `usable` configs skip straight to Chat.
 */
export const ONBOARDING_STEPS = [
  "provider",
  "agent",
  "personalization",
  "channels",
  "launch",
  "diagnostics"
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * A provider draft collected in the guided-setup form. The Desktop is
 * credential-blind: `apiKeyPresent` is a boolean, never the key itself — the
 * actual key is submitted only through a later desktop-token-gated route.
 */
export interface ProviderDraft {
  name: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string;
  model: string;
  apiKeyPresent: boolean;
}

export interface ProviderDraftValidation {
  valid: boolean;
  errors: { field: keyof ProviderDraft; message: string }[];
}

/**
 * Validates a guided-setup provider draft client-side (plan §9.2 step 1).
 * Checks structure only — it does not contact the provider or handle the key.
 * `baseUrl` must look like an http(s) URL; `apiKeyPresent` must be true (a key
 * has been entered) but the key value never lives in this object.
 */
export function validateProviderDraft(draft: ProviderDraft): ProviderDraftValidation {
  const errors: ProviderDraftValidation["errors"] = [];
  if (!draft.name.trim()) {
    errors.push({ field: "name", message: "Name is required" });
  }
  if (draft.protocol !== "openai-compatible" && draft.protocol !== "anthropic") {
    errors.push({ field: "protocol", message: "Unsupported protocol" });
  }
  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl) {
    errors.push({ field: "baseUrl", message: "Base URL is required" });
  } else if (!/^https?:\/\//i.test(baseUrl)) {
    errors.push({ field: "baseUrl", message: "Base URL must start with http:// or https://" });
  }
  if (!draft.model.trim()) {
    errors.push({ field: "model", message: "Model is required" });
  }
  if (!draft.apiKeyPresent) {
    errors.push({ field: "apiKeyPresent", message: "API key is required" });
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Returns the next step in the §9.2 order, or null at the end. Pure for
 * testability — the UI uses this to advance the guided flow.
 */
export function advanceOnboardingStep(current: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(current);
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[index + 1];
}

/** A single channel row shown in the onboarding "connect channels" step. */
export interface OnboardingChannelRow {
  channel: string;
  enabled: number;
  total: number;
}

export interface OnboardingChannelsView {
  rows: OnboardingChannelRow[];
  /** Total enabled instances across all external channels. */
  connectedCount: number;
}

/**
 * Projects the credential-safe channels summary into the read-only rows shown in
 * the §9.2 step 3 ("可选连接渠道") onboarding step. Pure for testability; the
 * onboarding step only displays configured/enabled counts and routes the user to
 * Settings to actually connect — it never edits channel config or shows secrets.
 */
export function summarizeOnboardingChannels(
  summary: DesktopChannelsSummary | null
): OnboardingChannelsView {
  if (!summary) return { rows: [], connectedCount: 0 };
  const rows = summary.groups.map((group) => ({
    channel: group.channel,
    enabled: group.enabled,
    total: group.total
  }));
  return { rows, connectedCount: summary.counts.enabledInstances };
}

/** Starts a broken config at the missing prerequisite instead of replaying completed setup. */
export function resolveOnboardingStartStep(readiness: DesktopReadiness): OnboardingStep {
  return resolveOnboardingRepairTarget(readiness) === "profile" ? "agent" : "provider";
}

export type OnboardingRepairTarget = "model" | "profile";

/** Records which prerequisite made an otherwise configured install enter repair mode. */
export function resolveOnboardingRepairTarget(
  readiness: DesktopReadiness
): OnboardingRepairTarget | null {
  if (!readiness.hasModel && readiness.hasProfile) return "model";
  if (readiness.hasModel && !readiness.hasProfile) return "profile";
  return null;
}

export interface OnboardingAgentSelection {
  profileId: string;
  agentId: string;
  canConfirm: boolean;
}

/** Chooses a stable initial Profile/Agent pair for onboarding step 2. */
export function resolveOnboardingAgentSelection(
  profiles: DesktopWebProfile[],
  agents: DesktopAgentItem[],
  preferredProfileId: string
): OnboardingAgentSelection {
  const profile = profiles.find((item) => item.id === preferredProfileId)
    ?? profiles.find((item) => item.enabled)
    ?? profiles[0];
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const linkedAgent = enabledAgents.find((agent) => agent.id === profile?.agentId);
  const agent = linkedAgent ?? enabledAgents[0];
  const profileId = profile?.id ?? "";
  const agentId = agent?.id ?? "";
  return { profileId, agentId, canConfirm: Boolean(profileId && agentId) };
}

/**
 * A structured migration/health-check summary for an existing-but-usable config
 * (plan §9.1 "已存在可用 Provider/模型：显示一次迁移和健康检查摘要"). Pure
 * derivation from the readiness summary — no new endpoint needed.
 */
export interface OnboardingHealthCheck {
  ready: boolean;
  modelStatus: "ready" | "missing";
  modelLabel: string;
  profileStatus: "ready" | "missing";
  profileCount: number;
  /** Short, display-ready lines summarizing the detected state. */
  lines: string[];
}

/**
 * Builds the §9.1 health-check summary shown to an existing usable config.
 * The summary names what was detected (model + profile) so the user sees a
 * one-time migration/health confirmation before entering Chat.
 */
export function buildOnboardingHealthCheck(
  readiness: DesktopReadiness,
  labels: { modelReady: string; modelMissing: string; profileReady: (count: number) => string; profileMissing: string }
): OnboardingHealthCheck {
  const modelStatus: OnboardingHealthCheck["modelStatus"] = readiness.hasModel ? "ready" : "missing";
  const profileStatus: OnboardingHealthCheck["profileStatus"] = readiness.hasProfile ? "ready" : "missing";
  const lines: string[] = [];
  lines.push(`${labels.modelReady}: ${readiness.modelLabel || labels.modelMissing}`);
  lines.push(readiness.hasProfile ? labels.profileReady(readiness.profileCount) : labels.profileMissing);
  return {
    ready: readiness.hasModel && readiness.hasProfile,
    modelStatus,
    modelLabel: readiness.modelLabel,
    profileStatus,
    profileCount: readiness.profileCount,
    lines
  };
}

/**
 * Groups transcript messages by role for read-only rendering. Pure derivation
 * for testability — the external transcript has no input or write affordances.
 */
export function groupExternalTranscriptByRole(
  messages: DesktopExternalTranscript["messages"]
): { userCount: number; assistantCount: number } {
  let userCount = 0;
  let assistantCount = 0;
  for (const message of messages) {
    if (message.role === "user") userCount += 1;
    else assistantCount += 1;
  }
  return { userCount, assistantCount };
}

export type ExternalChatTypeLabel = "private" | "group" | "channel";

/**
 * A flat, view-ready external-session row derived from the grouped summary.
 * Read-only aggregation only — no transcript content and no write affordances.
 */
export interface DesktopExternalSessionView {
  id: string;
  channel: string;
  title: string;
  senderName: string;
  chatType: ExternalChatTypeLabel;
  updatedAt: string;
  threadTitle?: string;
  botInstanceId?: string;
  botInstanceName?: string;
}

/**
 * Flattens the grouped external-sessions summary into a single ordered list,
 * preserving the server's known-channel grouping order and within-group
 * newest-first order. Pure derivation for testability.
 */
export function groupExternalSessionsForView(
  summary: DesktopExternalSessionsSummary
): DesktopExternalSessionView[] {
  const rows: DesktopExternalSessionView[] = [];
  for (const group of summary.groups) {
    for (const session of [...group.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      rows.push({
        id: session.id,
        channel: group.channel,
        title: session.title,
        senderName: session.senderName,
        chatType: session.chatType,
        updatedAt: session.updatedAt,
        threadTitle: session.threadTitle,
        botInstanceId: session.botInstanceId,
        botInstanceName: session.botInstanceName
      });
    }
  }
  return rows;
}

/**
 * Builds a compact one-line preview for an external-session row. Returns an
 * empty string when there is nothing meaningful to show.
 */
export function formatExternalSessionPreview(session: DesktopExternalSessionView): string {
  const parts: string[] = [];
  if (session.botInstanceName) parts.push(session.botInstanceName);
  if (session.threadTitle) parts.push(session.threadTitle);
  if (session.senderName) parts.push(session.senderName);
  return parts.join(" · ");
}

/** External channels surfaced in the chat rail, in display order (web is local). */
export const EXTERNAL_CHANNEL_ORDER = ["telegram", "feishu", "qq", "weixin"] as const;

/** Sentinel instance id for external sessions whose Bot id can't be recovered. */
export const UNKNOWN_BOT_INSTANCE = "__unknown__";

/** One Bot entry under a channel in the chat rail (column 1). */
export interface ChannelNavBot {
  /** Selection key, unique across the rail: `<channel>:<instanceId>`. */
  key: string;
  channel: string;
  /** Configured instance id, or "" for the unknown/legacy bucket. */
  instanceId: string;
  /** Display name; "" when unknown (callers substitute a localized fallback). */
  name: string;
  /** Number of read-only external sessions belonging to this Bot. */
  count: number;
  /** True when the Bot exists in channel settings (may have zero sessions). */
  configured: boolean;
}

/** One external channel group in the chat rail, with its Bot instances. */
export interface ChannelNavGroup {
  channel: string;
  bots: ChannelNavBot[];
  total: number;
}

/**
 * Builds the external-channel side of the chat rail: each known channel lists
 * its Bot instances (column 1 → expand → bots). Bots come from channel settings
 * so every configured Bot appears even with zero sessions (per design), in
 * config order; any Bot id seen in sessions but not configured is appended as an
 * unconfigured entry, and sessions whose Bot id can't be recovered fall into a
 * single unknown bucket. Channels with neither configured Bots nor sessions are
 * omitted. Pure derivation for testability.
 */
export function buildExternalChannelNav(
  channelSummary: DesktopChannelsSummary | null,
  externalSummary: DesktopExternalSessionsSummary | null
): ChannelNavGroup[] {
  const countsByChannel = new Map<string, Map<string, number>>();
  if (externalSummary) {
    for (const group of externalSummary.groups) {
      const perInstance = countsByChannel.get(group.channel) ?? new Map<string, number>();
      for (const session of group.sessions) {
        const id = session.botInstanceId?.trim() || UNKNOWN_BOT_INSTANCE;
        perInstance.set(id, (perInstance.get(id) ?? 0) + 1);
      }
      countsByChannel.set(group.channel, perInstance);
    }
  }
  const configuredByChannel = new Map<string, DesktopChannelInstance[]>();
  if (channelSummary) {
    for (const group of channelSummary.groups) configuredByChannel.set(group.channel, group.instances);
  }

  const groups: ChannelNavGroup[] = [];
  for (const channel of EXTERNAL_CHANNEL_ORDER) {
    const instances = configuredByChannel.get(channel) ?? [];
    const perInstance = countsByChannel.get(channel) ?? new Map<string, number>();
    const seen = new Set<string>();
    const bots: ChannelNavBot[] = [];
    for (const instance of instances) {
      seen.add(instance.id);
      bots.push({
        key: `${channel}:${instance.id}`,
        channel,
        instanceId: instance.id,
        name: instance.name || instance.id,
        count: perInstance.get(instance.id) ?? 0,
        configured: true
      });
    }
    for (const [instanceId, count] of perInstance) {
      if (instanceId === UNKNOWN_BOT_INSTANCE) {
        bots.push({ key: `${channel}:${UNKNOWN_BOT_INSTANCE}`, channel, instanceId: "", name: "", count, configured: false });
        continue;
      }
      if (seen.has(instanceId)) continue;
      bots.push({ key: `${channel}:${instanceId}`, channel, instanceId, name: instanceId, count, configured: false });
    }
    if (bots.length === 0) continue;
    groups.push({ channel, bots, total: bots.reduce((sum, bot) => sum + bot.count, 0) });
  }
  return groups;
}

/**
 * Selects the external sessions belonging to one Bot (column 2 of the rail).
 * Matches on channel plus recovered Bot instance id; an empty `instanceId`
 * selects the unknown/legacy bucket. Input order (newest-first) is preserved.
 */
export function externalSessionsForBot(
  views: DesktopExternalSessionView[],
  channel: string,
  instanceId: string
): DesktopExternalSessionView[] {
  return views
    .filter((view) => view.channel === channel && (view.botInstanceId?.trim() || "") === instanceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listDesktopConversations(
  endpoint: string,
  params: {
    channel: DesktopConversationChannel;
    limit?: number;
    cursor?: string | null;
    query?: string;
    botId?: string;
  }
): Promise<DesktopConversationsResponse> {
  const search = new URLSearchParams({ channel: params.channel });
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.query) search.set("query", params.query);
  if (params.botId) search.set("botId", params.botId);
  return requestJson<DesktopConversationsResponse>(
    endpoint,
    `/api/desktop/conversations?${search.toString()}`
  );
}

export async function renameDesktopConversation(
  endpoint: string,
  sessionId: string,
  title: string
): Promise<string> {
  const payload = await requestJson<{ ok: true; title: string }>(
    endpoint,
    "/api/desktop/conversations",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, title }) }
  );
  return payload.title;
}

export async function deleteDesktopConversation(endpoint: string, sessionId: string): Promise<void> {
  await requestJson(
    endpoint,
    `/api/desktop/conversations?sessionId=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

/**
 * Edit-and-resend: truncate a session's transcript at `fromMessageId`,
 * dropping that message and everything after it so the caller can append a
 * fresh, edited user message and re-run the turn. Used by both main chat and
 * project chat; branching off a message without rewriting history is a
 * separate action - see `forkDesktopSession` below.
 *
 * Errors carry a `status` field so callers can distinguish a structurally
 * valid request that referenced a stale message id (HTTP 422) from a missing
 * session (404) or a running session (409) - the client reloads the session
 * and asks the user to retry on 422.
 */
export async function truncateDesktopMessages(
  endpoint: string,
  profileId: string,
  sessionId: string,
  fromMessageId: string
): Promise<{ removed: number }> {
  const search = new URLSearchParams({ fromMessageId });
  const response = await fetchFromDesktop(
    serviceUrl(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/messages?${search.toString()}`),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId })
    }
  );
  let payload: { ok?: boolean; removed?: number; error?: string } = {};
  try {
    payload = response.status === 204 ? {} : await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.ok === false) {
    const message = String(payload.error ?? `Request failed (${response.status})`);
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return { removed: payload.removed ?? 0 };
}

/** Creates (or reuses) a visible child Session whose transcript ends just
 * before `fromMessageId`. The request id makes an ambiguous client retry
 * idempotent, so it cannot create duplicate sibling Sessions. */
export async function forkDesktopSession(
  endpoint: string,
  profileId: string,
  sessionId: string,
  fromMessageId: string,
  requestId: string
): Promise<DesktopSessionSummary & { reused: boolean }> {
  const payload = await requestJson<{
    ok: true;
    reused: boolean;
    session: DesktopSessionSummary;
  }>(
    endpoint,
    `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, fromMessageId, requestId })
    }
  );
  return { ...payload.session, reused: payload.reused };
}

export async function listDesktopConversationGroups(
  endpoint: string,
  params: { channel: DesktopConversationChannel; query?: string }
): Promise<DesktopConversationsGroupsResponse> {
  const search = new URLSearchParams({ channel: params.channel });
  if (params.query) search.set("query", params.query);
  return requestJson<DesktopConversationsGroupsResponse>(
    endpoint,
    `/api/desktop/conversations/groups?${search.toString()}`
  );
}

export async function listDesktopSessionRuns(endpoint: string): Promise<DesktopSessionRunsResponse> {
  return requestJson<DesktopSessionRunsResponse>(endpoint, "/api/desktop/session-runs");
}

export async function listDesktopSessions(
  endpoint: string,
  profileId: string
): Promise<DesktopSessionSummary[]> {
  const query = new URLSearchParams({ profileId });
  const payload = await requestJson<{ ok: true; sessions: DesktopSessionSummary[] }>(
    endpoint,
    `/api/sessions?${query.toString()}`
  );
  return [...payload.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createDesktopSession(
  endpoint: string,
  profileId: string
): Promise<DesktopSessionSummary & { reused: boolean }> {
  const payload = await requestJson<{ ok: true; session: DesktopSessionSummary; reused: boolean }>(
    endpoint,
    "/api/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId })
    }
  );
  return { ...payload.session, reused: payload.reused };
}

export async function loadDesktopSession(
  endpoint: string,
  profileId: string,
  sessionId: string
): Promise<DesktopSessionDetail> {
  const query = new URLSearchParams({ profileId });
  const payload = await requestJson<{ ok: true; session: DesktopSessionDetail }>(
    endpoint,
    `/api/sessions/${encodeURIComponent(sessionId)}?${query.toString()}`
  );
  return payload.session;
}

export async function loadDesktopMemoryTrace(
  endpoint: string,
  traceId: string
): Promise<DesktopMemoryTraceResponse["trace"]> {
  const payload = await requestJson<DesktopMemoryTraceResponse>(
    endpoint,
    `/api/desktop/memory-trace/${encodeURIComponent(traceId)}`
  );
  return payload.trace;
}

export async function submitDesktopMemoryTraceFeedback(
  endpoint: string,
  traceId: string,
  memoryId: string,
  value: DesktopMemoryFeedbackValue,
  idempotencyKey: string = crypto.randomUUID()
): Promise<void> {
  await requestJson(
    endpoint,
    `/api/desktop/memory-trace/${encodeURIComponent(traceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoryId, value, idempotencyKey })
    }
  );
}

export async function renameDesktopSession(
  endpoint: string,
  profileId: string,
  sessionId: string,
  title: string
): Promise<DesktopSessionSummary> {
  const payload = await requestJson<{ ok: true; session: DesktopSessionSummary }>(
    endpoint,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, title })
    }
  );
  return payload.session;
}

export async function deleteDesktopSession(
  endpoint: string,
  profileId: string,
  sessionId: string
): Promise<void> {
  await requestJson(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId })
  });
}

export type DesktopFileFilter = "all" | DesktopFileMediaType;

export async function listDesktopSessionFiles(
  endpoint: string,
  profileId: string,
  sessionId: string,
  projectId?: string
): Promise<DesktopSessionFile[]> {
  const query = new URLSearchParams({ profileId, sessionId });
  if (projectId) query.set("projectId", projectId);
  const payload = await requestJson<DesktopSessionFilesResponse>(
    endpoint,
    `/api/web/files?${query.toString()}`
  );
  return payload.files;
}

export function desktopFileContentUrl(
  endpoint: string,
  profileId: string,
  sessionId: string,
  fileId: string,
  download = false,
  projectId?: string
): string {
  const query = new URLSearchParams({ profileId, sessionId, fileId });
  if (download) query.set("download", "1");
  if (projectId) query.set("projectId", projectId);
  return serviceUrl(endpoint, `/api/web/files?${query.toString()}`);
}

// Read the body stream manually rather than `response.blob()`. Under the
// Tauri plugin-http transport `response.blob()` can truncate silently on
// larger responses (1MB+ images stopped rendering). Concatenating chunks
// ourselves surfaces any mid-stream error as a thrown exception instead.
async function responseToBlob(response: Response): Promise<Blob> {
  const body = response.body;
  if (!body) {
    return await response.blob();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const mime = response.headers.get("content-type") || undefined;
  return new Blob([merged], { type: mime });
}

export async function fetchDesktopFileBlob(
  endpoint: string,
  profileId: string,
  sessionId: string,
  fileId: string,
  download = false,
  projectId?: string
): Promise<Blob> {
  const response = await fetchFromDesktop(
    desktopFileContentUrl(endpoint, profileId, sessionId, fileId, download, projectId)
  );
  if (!response.ok) {
    throw new Error(`Failed to load file (${response.status})`);
  }
  return await responseToBlob(response);
}

/**
 * Fetches a Project file's raw bytes as a Blob for the Artifact Panel's download
 * action. Goes through the Tauri HTTP transport (not `fetch`) so the WebView CSP
 * `connect-src` does not need to name the runtime service port.
 */
export async function fetchDesktopProjectRawBlob(
  endpoint: string,
  projectId: string,
  path: string
): Promise<Blob> {
  const response = await fetchFromDesktop(desktopProjectRawFileUrl(endpoint, projectId, path));
  if (!response.ok) {
    throw new Error(`Failed to load file (${response.status})`);
  }
  return await responseToBlob(response);
}

// Fetch a completed media task's result (image/video) from the local service
// as a blob. The saved-on-disk file is served by taskId; loading via blob URL
// keeps rendering inside the WebView CSP (raw provider URLs are blocked and
// often expire). Mirrors how the web settings page serves the same file.
export async function fetchDesktopMediaTaskBlob(
  endpoint: string,
  kind: DesktopMediaTaskKind,
  taskId: string
): Promise<Blob> {
  const route = kind === "image"
    ? `/api/settings/image-generate/image?taskId=${encodeURIComponent(taskId)}`
    : `/api/settings/video-generate/video?taskId=${encodeURIComponent(taskId)}`;
  const response = await fetchFromDesktop(serviceUrl(endpoint, route));
  if (!response.ok) {
    throw new Error(`Failed to load media (${response.status})`);
  }
  return await responseToBlob(response);
}

export function filterDesktopFiles(
  files: DesktopSessionFile[],
  filter: DesktopFileFilter
): DesktopSessionFile[] {
  if (filter === "all") return files;
  return files.filter((file) => file.mediaType === filter);
}

export type DesktopAppearance = "system" | "light" | "dark";
export type DesktopThemeFamily = "macos" | "rose-pine" | "catppuccin" | "midnight";

const DESKTOP_APPEARANCES: readonly DesktopAppearance[] = ["system", "light", "dark"];
const DESKTOP_THEME_FAMILIES: readonly DesktopThemeFamily[] = ["macos", "rose-pine", "catppuccin", "midnight"];

/** Validates the independent brightness preference, defaulting to OS-following. */
export function normalizeAppearance(value: unknown): DesktopAppearance {
  const candidate = String(value ?? "").trim();
  return (DESKTOP_APPEARANCES as readonly string[]).includes(candidate)
    ? (candidate as DesktopAppearance)
    : "system";
}

/** Validates the independent palette family preference, defaulting to macOS. */
export function normalizeThemeFamily(value: unknown): DesktopThemeFamily {
  const candidate = String(value ?? "").trim();
  return (DESKTOP_THEME_FAMILIES as readonly string[]).includes(candidate)
    ? (candidate as DesktopThemeFamily)
    : "macos";
}

export interface DesktopDiagnostics {
  appVersion: string | null;
  serviceVersion: string | null;
  ownership: "managed" | "external" | null;
  endpoint: string | null;
  state: string;
}

/**
 * Formats a sanitized, copyable diagnostics summary. Only non-secret runtime
 * facts (version, ownership, loopback endpoint, connection state) are included —
 * never provider credentials or tokens (plan §11.3).
 */
export function buildDiagnosticsSummary(info: DesktopDiagnostics): string {
  return [
    "Molibot Desktop diagnostics",
    `app version: ${info.appVersion ?? "unknown"}`,
    `service version: ${info.serviceVersion ?? "unknown"}`,
    `ownership: ${info.ownership ?? "unknown"}`,
    `endpoint: ${info.endpoint ?? "n/a"}`,
    `state: ${info.state}`
  ].join("\n");
}

export interface DesktopReadiness {
  hasModel: boolean;
  modelLabel: string;
  profileCount: number;
  hasProfile: boolean;
}

export function shouldShowServiceReconnect(serviceReady: boolean): boolean {
  return !serviceReady;
}

/**
 * Derives a credential-safe readiness summary from the desktop bootstrap and the
 * text-model state — the signal a first-launch triage uses to decide whether the
 * existing `~/.molibot` config is usable or needs setup/repair.
 */
export function summarizeDesktopReadiness(
  profiles: DesktopProfileSummary[],
  textModel: DesktopModelState | null
): DesktopReadiness {
  const hasModel = !!textModel && textModel.currentKey.trim().length > 0 && textModel.options.length > 0;
  const current = textModel?.options.find((option) => option.key === textModel.currentKey);
  return {
    hasModel,
    modelLabel: current?.label ?? textModel?.currentKey ?? "",
    profileCount: profiles.length,
    hasProfile: profiles.length > 0
  };
}

export type FirstLaunchClassification = "new" | "usable" | "broken";

/**
 * Classifies the first-launch triage (plan §9.1) from a readiness summary:
 * - "new": no model and no profile → full onboarding
 * - "usable": both a model and a profile → health-check summary, then Chat
 * - "broken": config exists (a profile or a model) but not both → lightweight
 *   repair guide that does not overwrite the existing config
 */
export function classifyFirstLaunch(readiness: DesktopReadiness): FirstLaunchClassification {
  if (readiness.hasModel && readiness.hasProfile) return "usable";
  if (!readiness.hasModel && !readiness.hasProfile) return "new";
  return "broken";
}

export function filterSessionsByTitle<T extends { title: string }>(
  sessions: T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => session.title.toLowerCase().includes(needle));
}

export function addToFollowUpQueue(queue: string[], text: string): string[] {
  const trimmed = text.trim();
  return trimmed ? [...queue, trimmed] : queue;
}

/** Splits a follow-up queue into the next message to send and the remaining queue. */
export function nextFollowUp(queue: string[]): { next: string | null; rest: string[] } {
  if (queue.length === 0) return { next: null, rest: [] };
  const [next, ...rest] = queue;
  return { next, rest };
}

export type DesktopActivityEntry = DesktopConversationActivity;

function extractDiagnosticField(diagnostic: string, prefix: string): string {
  const rest = diagnostic.slice(prefix.length + 1);
  const comma = rest.indexOf(",");
  return (comma >= 0 ? rest.slice(0, comma) : rest).trim();
}

/**
 * Maps a runtime SSE event into a human-facing run-progress entry, or null when
 * the event is not a tool/subagent/thread-note step worth showing in the timeline.
 */
export function parseDesktopActivity(
  event: string,
  data: Record<string, unknown>
): DesktopActivityEntry | null {
  const structured = data.activity;
  if (structured && typeof structured === "object") {
    const item = structured as Record<string, unknown>;
    const kind = String(item.kind ?? "");
    const state = String(item.state ?? "");
    const key = String(item.key ?? "").trim();
    const label = String(item.label ?? "").trim();
    if (["tool", "subagent", "note"].includes(kind) && ["running", "success", "error", "info"].includes(state) && key && label) {
      const summary = String(item.summary ?? "").trim();
      return { kind: kind as DesktopActivityEntry["kind"], state: state as DesktopActivityEntry["state"], key, label, ...(summary ? { summary } : {}) };
    }
  }
  if (event === "thread_note") {
    const text = String(data.text ?? "").trim();
    return text ? { kind: "note", key: `note-${text}`, label: text, state: "info" } : null;
  }
  if (event !== "runner_event") return null;
  const diagnostic = String(data.diagnostic ?? "").trim();
  if (!diagnostic) return null;
  if (diagnostic.startsWith("tool_start=")) {
    const label = extractDiagnosticField(diagnostic, "tool_start");
    return { kind: "tool", key: `legacy-${label}`, label, state: "running" };
  }
  if (diagnostic.startsWith("tool_end=")) {
    const isError = /(^|,\s*)status=error/.test(diagnostic);
    return {
      kind: "tool",
      label: extractDiagnosticField(diagnostic, "tool_end"),
      key: `legacy-${extractDiagnosticField(diagnostic, "tool_end")}`,
      state: isError ? "error" : "success"
    };
  }
  if (diagnostic.startsWith("subagent")) {
    return { kind: "subagent", key: `subagent-${diagnostic}`, label: diagnostic, state: "info" };
  }
  return null;
}

export function reduceDesktopActivities(entries: DesktopActivityEntry[], next: DesktopActivityEntry): DesktopActivityEntry[] {
  const index = entries.findIndex((entry) => entry.key === next.key);
  return index < 0 ? [...entries, next] : entries.map((entry, position) => position === index ? next : entry);
}

function parseSseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const parsed = JSON.parse(dataLines.join("\n")) as unknown;
  const data = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return { event, data };
}

export async function streamDesktopChat(
  endpoint: string,
  input: {
    profileId: string;
    sessionId: string;
    message: string;
    thinkingLevel: DesktopThinkingLevel;
    projectId?: string;
    modelKey?: string;
    files?: File[];
    resumePlanId?: string;
  },
  onEvent: SseHandler,
  signal?: AbortSignal,
  onConnected?: () => void
): Promise<void> {
  const hasFiles = Boolean(input.files?.length);
  const body = hasFiles ? new FormData() : null;
  if (body) {
    body.set("profileId", input.profileId);
    body.set("conversationId", input.sessionId);
    body.set("message", input.message);
    body.set("thinkingLevel", input.thinkingLevel);
    if (input.projectId) body.set("projectId", input.projectId);
    if (input.modelKey) body.set("modelKey", input.modelKey);
    if (input.resumePlanId) body.set("resumePlanId", input.resumePlanId);
    for (const file of input.files ?? []) body.append("files", file);
  }
  const response = await fetchFromDesktop(serviceUrl(endpoint, "/api/stream"), {
    method: "POST",
    ...(body ? { body } : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      profileId: input.profileId,
      conversationId: input.sessionId,
      message: input.message,
      thinkingLevel: input.thinkingLevel,
      projectId: input.projectId,
      modelKey: input.modelKey
      ,resumePlanId: input.resumePlanId
      })
    }),
    signal
  });
  if (!response.ok) {
    const text = await response.text();
    let message = "";
    try {
      const payload = JSON.parse(text) as { error?: string };
      message = String(payload.error ?? "");
    } catch {
      message = text;
    }
    throw new Error(message || `Stream failed (${response.status})`);
  }

  onConnected?.();
  await consumeDesktopSse(response, onEvent);
}

/**
 * No bytes for this long (heartbeats included - the server pings every 20s
 * while a run is live) means the stream is dead, not busy: a half-open
 * connection otherwise holds the turn promise open forever, which is exactly
 * the "answer rendered, spinner still turning, send swallowed" freeze. 90s
 * tolerates three missed heartbeats before declaring death.
 */
export const DESKTOP_SSE_IDLE_TIMEOUT_MS = 90_000;

export class DesktopSseIdleTimeoutError extends Error {
  constructor(idleMs: number) {
    super(
      `Stream connection idle for ${Math.round(idleMs / 1000)}s (no frames, no heartbeat); disconnected. ` +
        "The task may still be finishing server-side - reloading the conversation shows its result."
    );
    this.name = "DesktopSseIdleTimeoutError";
  }
}

export async function consumeDesktopSse(
  response: Response,
  onEvent: SseHandler,
  idleTimeoutMs: number = DESKTOP_SSE_IDLE_TIMEOUT_MS
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response body is unavailable");
  const decoder = new TextDecoder();
  let buffer = "";

  // Idle watchdog: every received chunk re-arms the deadline; silence past it
  // rejects the pending read() so the turn settles instead of hanging.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectIdle: ((error: DesktopSseIdleTimeoutError) => void) | undefined;
  const idleWatch = idleTimeoutMs > 0
    ? new Promise<never>((_, reject) => {
      rejectIdle = reject;
    })
    : null;
  const armIdleDeadline = (): void => {
    if (!idleWatch) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      rejectIdle?.(new DesktopSseIdleTimeoutError(idleTimeoutMs));
      // Free the reader: the server may keep the socket open for a run that
      // outlives our patience, and an unclosed reader pins the connection.
      void reader.cancel().catch(() => undefined);
    }, idleTimeoutMs);
  };

  try {
    armIdleDeadline();
    while (true) {
      const { value, done } = idleWatch
        ? await Promise.race([reader.read(), idleWatch])
        : await reader.read();
      armIdleDeadline();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const parsed = parseSseBlock(block);
        if (parsed) await onEvent(parsed.event, parsed.data);
        separator = buffer.indexOf("\n\n");
      }
      if (done) break;
    }

    const parsed = parseSseBlock(buffer.trim());
    if (parsed) await onEvent(parsed.event, parsed.data);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

export interface DesktopChatResult {
  response: string;
  conversationId: string;
  stopReason?: string;
}

/**
 * Sends a message with file attachments through the shared non-streaming
 * `/api/chat` multipart endpoint. The Tauri HTTP client forwards the multipart
 * body and its generated Content-Type boundary.
 *
 * This is a `multipart/form-data` POST from a WebView origin that is never
 * same-origin with the loopback server (`tauri://localhost` when packaged,
 * `http://127.0.0.1:1420` under `desktop:dev`), which SvelteKit's CSRF check
 * would reject as a cross-site form submission; the server allows every such
 * origin via `kit.csrf.trustedOrigins` (`scripts/runtime/csrf-trusted-origins.mjs`).
 */
export async function sendDesktopChatWithFiles(
  endpoint: string,
  input: {
    profileId: string;
    sessionId: string;
    message: string;
    thinkingLevel: DesktopThinkingLevel;
    files: File[];
    projectId?: string;
    modelKey?: string;
  },
  signal?: AbortSignal
): Promise<DesktopChatResult> {
  const form = new FormData();
  form.set("profileId", input.profileId);
  form.set("conversationId", input.sessionId);
  form.set("message", input.message);
  form.set("thinkingLevel", input.thinkingLevel);
  if (input.projectId) form.set("projectId", input.projectId);
  if (input.modelKey) form.set("modelKey", input.modelKey);
  for (const file of input.files) form.append("files", file);

  const payload = await requestJson<{
    ok: true;
    response: string;
    conversationId: string;
    stopReason?: string;
  }>(endpoint, "/api/chat", { method: "POST", body: form, signal });

  return {
    response: payload.response,
    conversationId: payload.conversationId,
    stopReason: payload.stopReason
  };
}

/**
 * Builds a Desktop approval card from a `host_bash_approval` SSE payload
 * (a server-side HostBashApprovalPrompt), or null when the payload lacks a
 * request id. The structured request fields are preferred over the pre-rendered
 * Chinese body so the Desktop UI can localize the option labels itself.
 */
export function parseDesktopApproval(data: Record<string, unknown>): DesktopApprovalPrompt | null {
  const requestId = String(data.requestId ?? "").trim();
  if (!requestId) return null;
  const request = (data.request && typeof data.request === "object" ? data.request : {}) as Record<string, unknown>;
  const command = String(request.command ?? "").trim();
  const args = Array.isArray(request.args) ? request.args.map((arg) => String(arg)) : [];
  const fullCommand = [command, ...args].filter(Boolean).join(" ").trim();
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options: DesktopApprovalOption[] = rawOptions
    .map((option) => (option && typeof option === "object" ? option as Record<string, unknown> : {}))
    .map((option) => ({
      id: String(option.id ?? "").trim(),
      label: String(option.label ?? "").trim(),
      style: option.style ? String(option.style) : undefined
    }))
    .filter((option) => option.id);
  const rawOwner = request.owner && typeof request.owner === "object"
    ? request.owner as Record<string, unknown>
    : null;
  const ownerId = rawOwner ? String(rawOwner.id ?? "").trim() : "";
  const rawPayload = request.payload && typeof request.payload === "object"
    ? request.payload as Record<string, unknown>
    : null;
  return {
    requestId,
    command: fullCommand || command,
    reason: request.reason ? String(request.reason) : undefined,
    displayName: request.displayName ? String(request.displayName) : undefined,
    owner: ownerId
      ? {
          kind: String(rawOwner?.kind ?? "") === "project" ? "project" : "bot",
          id: ownerId,
          label: String(rawOwner?.label ?? "").trim() || ownerId
        }
      : undefined,
    options,
    payload: rawPayload ? {
      path: rawPayload.path ? String(rawPayload.path) : undefined,
      diff: rawPayload.diff ? String(rawPayload.diff) : undefined,
      parameters: rawPayload.parameters && typeof rawPayload.parameters === "object"
        ? rawPayload.parameters as Record<string, unknown>
        : undefined
    } : undefined
  };
}

/**
 * Pending approval for a session, or null.
 *
 * Approval cards normally arrive over the chat SSE stream, but a turn that was
 * resumed *by* an approval runs in the background with no stream attached — a
 * second approval raised during it is emitted to nobody. Polling this while
 * waiting on a resumed turn is what makes that card appear at all.
 */
export async function loadDesktopPendingApprovals(
  endpoint: string,
  profileId: string,
  sessionId: string
): Promise<DesktopApprovalPrompt[]> {
  const payload = await requestJson<{ ok: true; approvals: Record<string, unknown>[] }>(
    endpoint,
    "/api/desktop/host-bash",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_pending", profileId, sessionId })
    }
  );
  return (payload.approvals ?? []).flatMap((raw) => {
    const prompt = parseDesktopApproval(raw);
    return prompt ? [prompt] : [];
  });
}

/**
 * Resolve a pending Host Bash approval without creating a chat message.
 *
 * Returns the server's outcome, not just its prose: an approved command that
 * fails to execute (wrong cwd, missing binary, non-zero exit) reports `failed`
 * here and nowhere else, so a caller that drops this result leaves the user
 * staring at a card that vanished with nothing happening.
 */
export async function resolveDesktopHostBash(
  endpoint: string,
  profileId: string,
  sessionId: string,
  requestId: string,
  decision: DesktopApprovalDecision
): Promise<DesktopApprovalResult> {
  const payload = await requestJson<{
    ok: true;
    response: string;
    approval?: { status?: string; error?: string };
  }>(endpoint, "/api/desktop/host-bash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "resolve_approval",
      profileId,
      sessionId,
      requestId,
      decision
    })
  });
  const status = String(payload.approval?.status ?? "").trim();
  return {
    response: payload.response,
    status: status ? status as DesktopApprovalResult["status"] : undefined,
    error: payload.approval?.error
  };
}

export async function stopDesktopChat(
  endpoint: string,
  profileId: string,
  sessionId: string
): Promise<boolean> {
  const payload = await requestJson<{ ok: true; stopped: boolean }>(endpoint, "/api/stream/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, conversationId: sessionId })
  });
  return payload.stopped;
}

/**
 * Inject a queued message into the turn that is currently running for this
 * session. Resolves to false when the server had nothing running anymore, in
 * which case the caller keeps the message queued and lets it drain normally.
 */
export async function steerDesktopChat(
  endpoint: string,
  profileId: string,
  sessionId: string,
  text: string
): Promise<boolean> {
  const payload = await requestJson<{ ok: true; delivered: boolean }>(endpoint, "/api/stream/steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, conversationId: sessionId, text })
  });
  return payload.delivered;
}

/**
 * Submit a new custom provider from onboarding. The apiKey is sent directly
 * to the server — it is NOT stored in ProviderDraft (which only tracks
 * `apiKeyPresent: boolean`). The response never returns the key.
 */
export async function submitDesktopProvider(
  endpoint: string,
  draft: ProviderDraft,
  apiKey: string
): Promise<DesktopProviderSubmitResponse> {
  const id = `desktop-${Date.now()}`;
  return createDesktopProvider(endpoint, {
    id,
    name: draft.name,
    enabled: true,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl,
    apiKey,
    models: [{
      id: draft.model,
      tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool"],
      enabled: true,
      verification: {}
    }],
    defaultModel: draft.model,
    path: draft.protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions",
    thinkingFormat: null
  });
}

export async function createDesktopProvider(
  endpoint: string,
  provider: DesktopProviderCreateRequest
): Promise<DesktopProviderSubmitResponse> {
  return requestJson<DesktopProviderSubmitResponse>(endpoint, "/api/desktop/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(provider)
  });
}

/**
 * Test a saved provider by id. The API key stays server-side — the Desktop
 * only sends the provider id. Returns ok/error/message.
 */
export async function testDesktopProvider(
  endpoint: string,
  providerId: string,
  model?: string
): Promise<DesktopProviderTestResponse> {
  return requestJson<DesktopProviderTestResponse>(endpoint, "/api/desktop/provider-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, model })
  });
}

export async function updateDesktopProvider(
  endpoint: string,
  provider: DesktopProviderUpdateRequest
): Promise<DesktopProvidersSummary> {
  const payload = await requestJson<DesktopProviderMutationResponse>(endpoint, "/api/desktop/providers", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(provider)
  });
  return payload.summary;
}

export async function updateDesktopProviderGlobals(
  endpoint: string,
  globals: DesktopProviderGlobalsRequest
): Promise<DesktopProvidersSummary> {
  const payload = await requestJson<DesktopProviderMutationResponse>(endpoint, "/api/desktop/providers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(globals)
  });
  return payload.summary;
}

export async function deleteDesktopProvider(endpoint: string, providerId: string): Promise<DesktopProvidersSummary> {
  const payload = await requestJson<DesktopProviderMutationResponse>(
    endpoint,
    `/api/desktop/providers?id=${encodeURIComponent(providerId)}`,
    { method: "DELETE" }
  );
  return payload.summary;
}

export async function discoverDesktopProviderModels(
  endpoint: string,
  providerId: string,
  options?: {
    baseUrl?: string;
    apiKey?: string;
    protocol?: string;
    path?: string;
  }
): Promise<string[]> {
  const payload = await requestJson<DesktopProviderModelsResponse>(endpoint, "/api/desktop/provider-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId,
      ...options
    })
  });
  return payload.models;
}

export function providerItemToUpdateRequest(provider: DesktopProviderItem): DesktopProviderUpdateRequest {
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    models: provider.models.map((model): DesktopProviderModel => ({
      id: model.id,
      // Every field of the saved model must survive this projection: the editor
      // draft is rebuilt from it after each save, so anything omitted here is
      // silently dropped on the next write (pitfall 11).
      alias: model.alias,
      tags: [...model.tags],
      supportedRoles: [...model.supportedRoles],
      contextWindow: model.contextWindow,
      enabled: model.enabled,
      verification: { ...model.verification }
    })),
    defaultModel: provider.defaultModel,
    path: provider.path,
    thinkingFormat: provider.thinkingFormat
  };
}
