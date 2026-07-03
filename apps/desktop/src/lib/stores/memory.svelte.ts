// Memory settings — state + orchestration.
import { loadDesktopMemory, loadDesktopMemoryRejections, runDesktopMemoryAction } from "../api";
import type { DesktopMemoryItem, DesktopMemoryRejection, DesktopMemorySummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const memoryStore = $state({
  memory: null as DesktopMemorySummary | null,
  loading: false,
  endpoint: "",
  items: [] as DesktopMemoryItem[],
  memoryEdit: null as DesktopMemoryItem | null,
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
    const [summary, records, rejections] = await Promise.all([
      loadDesktopMemory(endpoint),
      runDesktopMemoryAction(endpoint, { action: "list", allScopes: true, limit: 200 }),
      loadDesktopMemoryRejections(endpoint)
    ]);
    memoryStore.memory = summary;
    memoryStore.items = records.items ?? [];
    memoryStore.rejections = rejections.items;
  } catch (cause) {
    memoryStore.endpoint = "";
    setError(cause);
  } finally {
    memoryStore.loading = false;
  }
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

export async function runMemoryMaintenance(action: "sync" | "flush" | "compact"): Promise<void> {
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
    const result = await runDesktopMemoryAction(endpoint, { action: "update", channel: item.channel, userId: item.externalUserId, id: item.id, content: item.content, tags: item.tags, expiresAt: item.expiresAt || null });
    if (result.item) memoryStore.items = memoryStore.items.map((candidate) => candidate.id === item.id ? result.item! : candidate);
    memoryStore.memoryEdit = null;
    memoryStore.actionMessage = session.text.memoryUpdated;
  } catch (cause) {
    setError(cause);
  } finally {
    memoryStore.busyAction = "";
  }
}

export function beginMemoryEdit(item: DesktopMemoryItem): void {
  memoryStore.memoryEdit = { ...item, tags: [...item.tags] };
  memoryStore.actionMessage = "";
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
