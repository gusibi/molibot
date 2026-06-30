import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  DesktopAgentsResponse,
  DesktopAgentsSummary,
  DesktopAgentItem,
  DesktopAgentSaveRequest,
  DesktopMcpResponse,
  DesktopMcpSummary,
  DesktopMcpSaveRequest,
  DesktopChannelsResponse,
  DesktopChannelsSummary,
  DesktopChannelSaveRequest,
  DesktopChannelTestRequest,
  DesktopChannelTestResponse,
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
  return payload.summary;
}

export async function runDesktopTaskAction(endpoint: string, input: DesktopTaskActionRequest): Promise<DesktopTaskActionResponse> {
  return requestJson<DesktopTaskActionResponse>(endpoint, "/api/desktop/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export async function loadDesktopProviders(endpoint: string): Promise<DesktopProvidersSummary> {
  const payload = await requestJson<DesktopProvidersResponse>(endpoint, "/api/desktop/providers");
  return payload.summary;
}

export async function loadDesktopAgents(endpoint: string): Promise<DesktopAgentsSummary> {
  const payload = await requestJson<DesktopAgentsResponse>(endpoint, "/api/desktop/agents");
  return payload.summary;
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
    for (const session of group.sessions) {
      rows.push({
        id: session.id,
        channel: group.channel,
        title: session.title,
        senderName: session.senderName,
        chatType: session.chatType,
        updatedAt: session.updatedAt,
        threadTitle: session.threadTitle,
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

/** One Bot-instance sub-section inside a channel (plan §7.2 hierarchy). */
export interface ExternalInstanceSection {
  /** null for legacy/unknown-instance sessions (no botInstanceName). */
  botInstanceName: string | null;
  sessions: DesktopExternalSessionView[];
}

/** One channel section, optionally split into Bot-instance sub-sections. */
export interface ExternalChannelSection {
  channel: string;
  total: number;
  /** True only when the channel has more than one distinct Bot instance. */
  showInstances: boolean;
  instances: ExternalInstanceSection[];
}

/**
 * Groups external sessions by channel and, within a channel, by Bot instance
 * (plan §7.2 "单实例时直接显示会话。多实例时自动增加 渠道 → Bot 实例 → 会话 层级").
 * Preserves the server's known-channel order and within-instance newest-first
 * order, and surfaces instance sub-sections only when a channel actually has
 * more than one distinct instance — a single-instance (or legacy, no-metadata)
 * channel renders its sessions flat. Pure derivation for testability.
 */
export function groupExternalSessionsByInstance(
  summary: DesktopExternalSessionsSummary
): ExternalChannelSection[] {
  const sections: ExternalChannelSection[] = [];
  for (const group of summary.groups) {
    const order: (string | null)[] = [];
    const buckets = new Map<string | null, DesktopExternalSessionView[]>();
    for (const session of group.sessions) {
      const name = session.botInstanceName?.trim();
      const key = name ? name : null;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
        order.push(key);
      }
      bucket.push({
        id: session.id,
        channel: group.channel,
        title: session.title,
        senderName: session.senderName,
        chatType: session.chatType,
        updatedAt: session.updatedAt,
        threadTitle: session.threadTitle,
        botInstanceName: session.botInstanceName
      });
    }
    sections.push({
      channel: group.channel,
      total: group.total,
      showInstances: order.length >= 2,
      instances: order.map((key) => ({ botInstanceName: key, sessions: buckets.get(key)! }))
    });
  }
  return sections;
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
  return payload.sessions;
}

export async function createDesktopSession(
  endpoint: string,
  profileId: string
): Promise<DesktopSessionSummary> {
  const payload = await requestJson<{ ok: true; session: DesktopSessionSummary }>(
    endpoint,
    "/api/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId })
    }
  );
  return payload.session;
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
  sessionId: string
): Promise<DesktopSessionFile[]> {
  const query = new URLSearchParams({ profileId, sessionId });
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
  download = false
): string {
  const query = new URLSearchParams({ profileId, sessionId, fileId });
  if (download) query.set("download", "1");
  return serviceUrl(endpoint, `/api/web/files?${query.toString()}`);
}

export async function fetchDesktopFileBlob(
  endpoint: string,
  profileId: string,
  sessionId: string,
  fileId: string,
  download = false
): Promise<Blob> {
  const response = await fetchFromDesktop(
    desktopFileContentUrl(endpoint, profileId, sessionId, fileId, download)
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

export interface DesktopActivityEntry {
  kind: "tool" | "subagent" | "note";
  label: string;
  state: "start" | "ok" | "error" | "info";
}

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
  if (event === "thread_note") {
    const text = String(data.text ?? "").trim();
    return text ? { kind: "note", label: text, state: "info" } : null;
  }
  if (event !== "runner_event") return null;
  const diagnostic = String(data.diagnostic ?? "").trim();
  if (!diagnostic) return null;
  if (diagnostic.startsWith("tool_start=")) {
    return { kind: "tool", label: extractDiagnosticField(diagnostic, "tool_start"), state: "start" };
  }
  if (diagnostic.startsWith("tool_end=")) {
    const isError = /(^|,\s*)status=error/.test(diagnostic);
    return {
      kind: "tool",
      label: extractDiagnosticField(diagnostic, "tool_end"),
      state: isError ? "error" : "ok"
    };
  }
  if (diagnostic.startsWith("subagent")) {
    return { kind: "subagent", label: diagnostic, state: "info" };
  }
  return null;
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
      thinkingLevel: input.thinkingLevel
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
  },
  signal?: AbortSignal
): Promise<DesktopChatResult> {
  const form = new FormData();
  form.set("profileId", input.profileId);
  form.set("conversationId", input.sessionId);
  form.set("message", input.message);
  form.set("thinkingLevel", input.thinkingLevel);
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

export async function discoverDesktopProviderModels(endpoint: string, providerId: string): Promise<string[]> {
  const payload = await requestJson<DesktopProviderModelsResponse>(endpoint, "/api/desktop/provider-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId })
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
