// Memory settings — state + orchestration.
import { loadDesktopMemory, loadDesktopMemoryRejections, runDesktopMemoryAction } from "../api";
import type { DesktopMemoryCandidate, DesktopMemoryItem, DesktopMemoryProfile, DesktopMemoryRejection, DesktopMemorySummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const memoryStore = $state({
  memory: null as DesktopMemorySummary | null,
  loading: false,
  endpoint: "",
  items: [] as DesktopMemoryItem[],
  profile: null as DesktopMemoryProfile | null,
  candidates: [] as DesktopMemoryCandidate[],
  candidateEdit: null as DesktopMemoryCandidate | null,
  memoryEdit: null as DesktopMemoryItem | null,
  memoryVersions: [] as DesktopMemoryItem[],
  sourcePreview: null as null | { sessionId: string; messages: Array<{ id: string; role: string; content: string; createdAt: string; selected: boolean }> },
  rejections: [] as DesktopMemoryRejection[],
  channel: "",
  userId: "",
  query: "",
  allScopes: true,
  busyAction: "",
  actionMessage: "",
  rejectionQuery: ""
});

export async function loadMemory(endpoint: string): Promise<void> {
  memoryStore.endpoint = endpoint;
  memoryStore.loading = true;
  session.error = "";
  try {
    const [summary, records, profile, candidates, rejections] = await Promise.all([
      loadDesktopMemory(endpoint),
      runDesktopMemoryAction(endpoint, { action: "list", allScopes: true, limit: 200 }),
      runDesktopMemoryAction(endpoint, { action: "profile", includeOwner: true, includeAgentSelf: true }),
      runDesktopMemoryAction(endpoint, { action: "list-candidates", limit: 200 }),
      loadDesktopMemoryRejections(endpoint)
    ]);
    memoryStore.memory = summary;
    memoryStore.items = records.items ?? [];
    memoryStore.profile = profile.profile ?? null;
    memoryStore.candidates = candidates.candidates ?? [];
    memoryStore.rejections = rejections.items;
  } catch (cause) {
    memoryStore.endpoint = "";
    setError(cause);
  } finally {
    memoryStore.loading = false;
  }
}

export async function openMemorySource(source: { sessionId: string; conversationMessageId: string }): Promise<void> {
  if (!session.endpoint) return;
  try {
    const result = await runDesktopMemoryAction(session.endpoint, { action: "source", sessionId: source.sessionId, messageId: source.conversationMessageId });
    memoryStore.sourcePreview = { sessionId: source.sessionId, messages: result.sourceMessages ?? [] };
  } catch (cause) { setError(cause); }
}

export function beginCandidateEdit(candidate: DesktopMemoryCandidate): void {
  memoryStore.candidateEdit = { ...candidate, sources: candidate.sources.map((source) => ({ ...source })) };
}

export async function confirmMemoryCandidate(candidate: DesktopMemoryCandidate): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction) return;
  memoryStore.busyAction = candidate.id;
  try {
    await runDesktopMemoryAction(endpoint, { action: "confirm-candidate", id: candidate.id, content: candidate.value, namespace: candidate.namespace, domain: candidate.domain, type: candidate.type, subject: candidate.subject, confidence: candidate.confidence, reason: candidate.reason });
    memoryStore.candidates = memoryStore.candidates.filter((item) => item.id !== candidate.id);
    memoryStore.candidateEdit = null;
    memoryStore.actionMessage = session.text.memoryCandidateConfirmed;
    memoryStore.busyAction = "";
    await refreshMemoryRecords();
  } catch (cause) { setError(cause); } finally { memoryStore.busyAction = ""; }
}

export async function ignoreMemoryCandidate(candidate: DesktopMemoryCandidate): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction) return;
  memoryStore.busyAction = candidate.id;
  try {
    await runDesktopMemoryAction(endpoint, { action: "ignore-candidate", id: candidate.id });
    memoryStore.candidates = memoryStore.candidates.filter((item) => item.id !== candidate.id);
    memoryStore.candidateEdit = null;
    memoryStore.actionMessage = session.text.memoryCandidateIgnored;
  } catch (cause) { setError(cause); } finally { memoryStore.busyAction = ""; }
}

export async function refreshMemoryRecords(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction) return;
  memoryStore.busyAction = "search";
  session.error = "";
  try {
    const result = await runDesktopMemoryAction(endpoint, { action: memoryStore.query.trim() ? "search" : "list", channel: memoryStore.channel, userId: memoryStore.userId, allScopes: memoryStore.allScopes, query: memoryStore.query.trim(), limit: 200 });
    memoryStore.items = result.items ?? [];
  } catch (cause) {
    setError(cause);
  } finally {
    memoryStore.busyAction = "";
  }
}

export async function runMemoryMaintenance(action: "sync" | "flush" | "compact" | "backfill-embeddings" | "migrate-json-file"): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction) return;
  memoryStore.busyAction = action;
  session.error = "";
  try {
    const result = await runDesktopMemoryAction(endpoint, { action, channel: memoryStore.channel, userId: memoryStore.userId, allScopes: memoryStore.allScopes });
    memoryStore.actionMessage = `${action}: ${JSON.stringify(result.sync ?? result.result ?? {})}`;
    const refreshed = await runDesktopMemoryAction(endpoint, { action: "list", channel: memoryStore.channel, userId: memoryStore.userId, allScopes: memoryStore.allScopes, limit: 200 });
    memoryStore.items = refreshed.items ?? [];
  } catch (cause) {
    setError(cause);
  } finally {
    memoryStore.busyAction = "";
  }
}

export async function saveMemoryItem(item: DesktopMemoryItem): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction) return;
  memoryStore.busyAction = item.id;
  try {
    const result = await runDesktopMemoryAction(endpoint, { action: "update", channel: item.channel, userId: item.externalUserId, id: item.id, content: item.content, tags: item.tags, expiresAt: item.expiresAt || null, pinned: item.pinned, allowInjection: item.allowInjection !== false });
    if (result.item) memoryStore.items = memoryStore.items.map((candidate) => candidate.id === item.id ? result.item! : candidate);
    memoryStore.memoryEdit = null;
    memoryStore.actionMessage = session.text.memoryUpdated;
  } catch (cause) {
    setError(cause);
  } finally {
    memoryStore.busyAction = "";
  }
}

export async function restoreMemoryState(item: DesktopMemoryItem): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction) return;
  memoryStore.busyAction = item.id;
  try {
    const result = await runDesktopMemoryAction(endpoint, { action: "restore-state", channel: item.channel, userId: item.externalUserId, id: item.id });
    if (result.item) {
      memoryStore.items = memoryStore.items.map((candidate) => candidate.id === item.id ? result.item! : candidate);
      memoryStore.profile = null;
      await loadMemory(endpoint);
    }
  } catch (cause) { setError(cause); } finally { memoryStore.busyAction = ""; }
}

export async function beginMemoryEdit(item: DesktopMemoryItem): Promise<void> {
  memoryStore.memoryEdit = { ...item, tags: [...item.tags] };
  memoryStore.memoryVersions = [];
  memoryStore.actionMessage = "";
  if (!session.endpoint) return;
  try {
    const result = await runDesktopMemoryAction(session.endpoint, { action: "versions", channel: item.channel, userId: item.externalUserId, id: item.id });
    memoryStore.memoryVersions = result.versions ?? [];
  } catch (cause) { setError(cause); }
}

export async function deleteMemoryItem(item: DesktopMemoryItem): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || memoryStore.busyAction || !window.confirm(session.text.memoryDeleteConfirm)) return;
  memoryStore.busyAction = item.id;
  try {
    await runDesktopMemoryAction(endpoint, { action: "delete", channel: item.channel, userId: item.externalUserId, id: item.id });
    memoryStore.items = memoryStore.items.filter((candidate) => candidate.id !== item.id);
    memoryStore.actionMessage = session.text.memoryDeleted;
  } catch (cause) {
    setError(cause);
  } finally {
    memoryStore.busyAction = "";
  }
}
