import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  DesktopAgentsResponse,
  DesktopAgentActivityResponse,
  DesktopAgentActivityItem,
  DesktopAgentsSummary,
  DesktopAgentItem,
  DesktopAgentSaveRequest,
  DesktopMcpResponse,
  DesktopMcpSummary,
  DesktopMcpSaveRequest,
  DesktopChannelsResponse,
  DesktopChannelsSummary,
  DesktopChannelInstance,
  DesktopChannelSaveRequest,
  DesktopChannelTestRequest,
  DesktopChannelTestResponse,
  DesktopConversationActivity,
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
  DesktopPluginsResponse,
  DesktopPluginsSummary,
  DesktopPluginsUpdateRequest,
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
  DesktopVideoGenerateResponse,
  DesktopMediaGenerateSummary,
  DesktopTtsResponse,
  DesktopTtsSummary,
  DesktopSkillsResponse,
  DesktopSkillsSummary,
  DesktopSkillsUpdateRequest,
  DesktopApprovalDecision,
  DesktopApprovalOption,
  DesktopApprovalPrompt,
  DesktopBootstrapResponse,
  DesktopFileMediaType,
  DesktopHostBashResponse,
  DesktopHostBashSummary,
  DesktopHostBashToggleResponse,
  DesktopModelState,
  DesktopModelRoutingResponse,
  DesktopModelRoutingSettings,
  DesktopModelRoutingUpdateRequest,
  DesktopProfileSummary,
  DesktopProvidersResponse,
  DesktopProvidersSummary,
  DesktopProviderSubmitResponse,
  DesktopProviderGlobalsRequest,
  DesktopProviderCreateRequest,
  DesktopProviderItem,
  DesktopProviderModel,
  DesktopProviderModelsResponse,
  DesktopProviderMutationResponse,
  DesktopProviderTestResponse,
  DesktopProviderUpdateRequest,
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
  DesktopThinkingLevel,
  DesktopTraceRange,
  DesktopTraceResponse,
  DesktopTraceSummary,
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

export async function loadDesktopBootstrap(endpoint: string): Promise<DesktopProfileSummary[]> {
  const payload = await requestJson<DesktopBootstrapResponse>(endpoint, "/api/desktop/bootstrap");
  return payload.profiles;
}

export interface DesktopProject {
  id: string;
  name: string;
  rootPath: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
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
  | { status: "text"; path: string; content: string; sizeBytes: number; truncated: boolean }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number };

export interface DesktopProjectGitEntry {
  path: string;
  previousPath?: string;
  previousOutsideProject?: boolean;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
}

export type DesktopProjectGitStatus =
  | { status: "ok"; entries: DesktopProjectGitEntry[]; truncated: boolean }
  | { status: "unavailable"; reason: string };

export type DesktopProjectGitDiff =
  | { status: "diff"; path: string; content: string; truncated: boolean }
  | { status: "untracked"; path: string; preview: DesktopProjectFilePreview }
  | { status: "binary" | "oversized"; path: string; sizeBytes: number }
  | { status: "unavailable"; reason: string };

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

export async function patchDesktopProject(endpoint: string, id: string, patch: { name?: string; rootPath?: string; instructions?: string }): Promise<DesktopProject> {
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

export async function loadDesktopProjectFile(endpoint: string, projectId: string, filePath: string): Promise<DesktopProjectFilePreview> {
  const query = new URLSearchParams({ path: filePath });
  return (await requestJson<{ ok: true; preview: DesktopProjectFilePreview }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/file?${query}`)).preview;
}

export async function loadDesktopProjectGitStatus(endpoint: string, projectId: string): Promise<DesktopProjectGitStatus> {
  return (await requestJson<{ ok: true; result: DesktopProjectGitStatus }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/status`)).result;
}

export async function loadDesktopProjectGitDiff(endpoint: string, projectId: string, filePath: string): Promise<DesktopProjectGitDiff> {
  const query = new URLSearchParams({ path: filePath });
  return (await requestJson<{ ok: true; result: DesktopProjectGitDiff }>(endpoint, `/api/settings/projects/${encodeURIComponent(projectId)}/inspection/diff?${query}`)).result;
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

export async function loadDesktopUsage(endpoint: string): Promise<DesktopUsageSummary> {
  const payload = await requestJson<DesktopUsageResponse>(endpoint, "/api/desktop/usage");
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

export async function loadDesktopRunHistory(endpoint: string, limit = 200): Promise<DesktopRunHistoryItem[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const payload = await requestJson<DesktopRunHistoryResponse>(
    endpoint,
    `/api/desktop/run-history?${query.toString()}`
  );
  return payload.items;
}

export async function loadDesktopTrace(endpoint: string, range: DesktopTraceRange): Promise<DesktopTraceSummary> {
  const query = new URLSearchParams({ range });
  const payload = await requestJson<DesktopTraceResponse>(endpoint, `/api/desktop/trace?${query.toString()}`);
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

export type DesktopSandboxPreset = "observe" | "build" | "strict";

const SANDBOX_DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"];
const SANDBOX_DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];
const SANDBOX_BUILD_DOMAINS = [
  "npmjs.org", "*.npmjs.org", "registry.npmjs.org", "registry.yarnpkg.com",
  "pypi.org", "*.pypi.org", "github.com", "*.github.com", "api.github.com", "raw.githubusercontent.com"
];

const DESKTOP_SANDBOX_PRESETS: Record<DesktopSandboxPreset, DesktopSandboxUpdateRequest> = {
  observe: {
    enabled: true,
    initFailureMode: "warn-disable",
    envFilePath: ".env",
    env: { inheritMode: "minimal", allow: [], deny: [] },
    network: { allowedDomains: ["*"], deniedDomains: [] },
    filesystem: { denyRead: SANDBOX_DEFAULT_DENY_READ, allowWrite: ["/tmp", "scratch"], denyWrite: SANDBOX_DEFAULT_DENY_WRITE }
  },
  build: {
    enabled: true,
    initFailureMode: "warn-disable",
    envFilePath: ".env",
    env: { inheritMode: "full", allow: [], deny: [] },
    network: { allowedDomains: SANDBOX_BUILD_DOMAINS, deniedDomains: [] },
    filesystem: { denyRead: SANDBOX_DEFAULT_DENY_READ, allowWrite: [".", "/tmp", "scratch"], denyWrite: SANDBOX_DEFAULT_DENY_WRITE }
  },
  strict: {
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
  for (const name of ["observe", "build", "strict"] as const) {
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

export async function loadDesktopHostBash(endpoint: string): Promise<DesktopHostBashSummary> {
  const payload = await requestJson<DesktopHostBashResponse>(endpoint, "/api/desktop/host-bash");
  return payload.summary;
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

export async function loadDesktopTasks(endpoint: string): Promise<DesktopTaskSummary> {
  const payload = await requestJson<DesktopTaskResponse>(endpoint, "/api/desktop/tasks");
  const items = payload.summary.items
    .filter((item) => item.type === "periodic")
    .map((item) => ({
      ...item,
      enabled: item.enabled !== false,
      executions: Array.isArray(item.executions) ? item.executions : [],
      executionCount: Number(item.executionCount ?? item.executions?.length ?? 0)
    }));
  const counts: DesktopTaskSummary["counts"] = {
    total: items.length,
    byType: { "one-shot": 0, periodic: items.length, immediate: 0 },
    byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 },
    byScope: { workspace: 0, chatScratch: 0 },
    byChannel: {},
    executions: payload.summary.counts.executions ?? { total: 0, completed: 0, failed: 0 }
  };
  for (const item of items) {
    counts.byStatus[item.status] += 1;
    item.scope === "workspace" ? counts.byScope.workspace += 1 : counts.byScope.chatScratch += 1;
    counts.byChannel[item.channel] = (counts.byChannel[item.channel] ?? 0) + 1;
  }
  return { items, counts, targets: Array.isArray(payload.summary.targets) ? payload.summary.targets : [] };
}

export async function runDesktopTaskAction(endpoint: string, input: DesktopTaskActionRequest): Promise<DesktopTaskActionResponse> {
  return requestJson<DesktopTaskActionResponse>(endpoint, "/api/desktop/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
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

export async function loadDesktopAgents(endpoint: string): Promise<DesktopAgentsSummary> {
  const payload = await requestJson<DesktopAgentsResponse>(endpoint, "/api/desktop/agents");
  return payload.summary;
}

export async function loadDesktopAgentActivity(endpoint: string): Promise<DesktopAgentActivityItem[]> {
  const payload = await requestJson<DesktopAgentActivityResponse>(endpoint, "/api/desktop/agent-activity");
  return payload.items;
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

export async function loadDesktopSkills(endpoint: string): Promise<DesktopSkillsSummary> {
  const payload = await requestJson<DesktopSkillsResponse>(endpoint, "/api/desktop/skills");
  return payload.summary;
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
  return Object.fromEntries(items.map(({ id, ...item }) => [id, item]));
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
  return await response.blob();
}

export function filterDesktopFiles(
  files: DesktopSessionFile[],
  filter: DesktopFileFilter
): DesktopSessionFile[] {
  if (filter === "all") return files;
  return files.filter((file) => file.mediaType === filter);
}

export type DesktopTheme = "system" | "light" | "dark";

const DESKTOP_THEMES: readonly DesktopTheme[] = ["system", "light", "dark"];

/** Validates a persisted theme value, falling back to "system" (follow the OS). */
export function normalizeTheme(value: unknown): DesktopTheme {
  const candidate = String(value ?? "").trim();
  return (DESKTOP_THEMES as readonly string[]).includes(candidate)
    ? (candidate as DesktopTheme)
    : "system";
}

export interface DesktopDiagnostics {
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

/**
 * Returns the ids of messages whose content matches the query (case-insensitive),
 * preserving transcript order so prev/next navigation steps through results.
 */
export function findTranscriptMatches(
  messages: Array<{ id: string; content: string }>,
  query: string
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return messages
    .filter((message) => message.content.toLowerCase().includes(needle))
    .map((message) => message.id);
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
  },
  onEvent: SseHandler,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetchFromDesktop(serviceUrl(endpoint, "/api/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: input.profileId,
      conversationId: input.sessionId,
      message: input.message,
      thinkingLevel: input.thinkingLevel,
      projectId: input.projectId
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

  await consumeDesktopSse(response, onEvent);
}

export async function consumeDesktopSse(response: Response, onEvent: SseHandler): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response body is unavailable");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
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
 * This is a `multipart/form-data` POST from the `tauri://localhost` WebView
 * origin, which SvelteKit's CSRF check would reject as a cross-site form
 * submission; the server allows that origin via `kit.csrf.trustedOrigins`.
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
  },
  signal?: AbortSignal
): Promise<DesktopChatResult> {
  const form = new FormData();
  form.set("profileId", input.profileId);
  form.set("conversationId", input.sessionId);
  form.set("message", input.message);
  form.set("thinkingLevel", input.thinkingLevel);
  if (input.projectId) form.set("projectId", input.projectId);
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
  return {
    requestId,
    command: fullCommand || command,
    reason: request.reason ? String(request.reason) : undefined,
    displayName: request.displayName ? String(request.displayName) : undefined,
    options
  };
}

export function hostBashApprovalSubcommand(decision: DesktopApprovalDecision): string {
  switch (decision) {
    case "approve_once":
      return "approve-once";
    case "approve_session":
      return "approve-session";
    case "approve_persistent":
      return "approve";
    case "reject":
      return "reject";
  }
}

/**
 * Resolves a pending Host Bash approval through the shared `/api/chat`
 * `/hosttools` command path. The command itself is not persisted as a session
 * message; the server executes the decision and resumes the original run.
 */
export async function resolveDesktopHostBash(
  endpoint: string,
  profileId: string,
  sessionId: string,
  requestId: string,
  decision: DesktopApprovalDecision
): Promise<string> {
  const payload = await requestJson<{ ok: true; response: string }>(endpoint, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId,
      conversationId: sessionId,
      message: `/hosttools ${hostBashApprovalSubcommand(decision)} ${requestId}`
    })
  });
  return payload.response;
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
    supportsThinking: null,
    thinkingFormat: null,
    reasoningEffortMap: {}
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
      tags: [...model.tags],
      supportedRoles: [...model.supportedRoles],
      contextWindow: model.contextWindow,
      enabled: model.enabled,
      verification: { ...model.verification }
    })),
    defaultModel: provider.defaultModel,
    path: provider.path,
    supportsThinking: provider.supportsThinking,
    thinkingFormat: provider.thinkingFormat,
    reasoningEffortMap: { ...provider.reasoningEffortMap }
  };
}
