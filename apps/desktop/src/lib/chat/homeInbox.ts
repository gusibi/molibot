import type { DesktopHomeNotification } from "@molibot/desktop-contract";
import { writable } from "svelte/store";

const UNDO_WINDOW_MS = 4500;
type PendingRead = { item: DesktopHomeNotification; timer?: ReturnType<typeof setTimeout> };

export function createHomeInbox({
  load,
  markRead,
  canWrite,
  onRead,
}: {
  load: (endpoint: string) => Promise<DesktopHomeNotification[]>;
  markRead: (endpoint: string, ids: string[]) => Promise<unknown>;
  canWrite: () => boolean;
  onRead: () => void;
}) {
  let endpoint = "";
  let request = 0;
  let notifications: DesktopHomeNotification[] = [];
  let loading = true;
  let loadError = false;
  let writeError = false;
  const pending = new Map<string, PendingRead>();
  const state = writable(snapshot());

  function snapshot() {
    return {
      notifications: notifications.filter(item => !pending.has(item.id)),
      undoItems: [...pending.values()].filter(entry => entry.timer !== undefined).map(entry => entry.item),
      loading,
      loadError,
      writeError,
    };
  }

  function publish() {
    state.set(snapshot());
  }

  function setEndpoint(target: string) {
    if (endpoint === target) return;
    endpoint = target;
    request++;
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    notifications = [];
    loading = Boolean(target);
    loadError = false;
    writeError = false;
    publish();
  }

  async function refresh(target: string) {
    if (!target || target !== endpoint) return;
    const version = ++request;
    try {
      const items = await load(target);
      if (version !== request) return;
      notifications = items.filter(item => item.type !== "session-completed");
      loadError = false;
    } catch {
      if (version !== request) return;
      loadError = true;
    }
    loading = false;
    publish();
  }

  async function commitRead(target: string, item: DesktopHomeNotification) {
    if (!target || target !== endpoint) return;
    const entry = pending.get(item.id) ?? { item };
    if (pending.has(item.id) && entry.timer === undefined) return;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    if (!canWrite()) {
      pending.delete(item.id);
      publish();
      return;
    }
    pending.set(item.id, entry);
    writeError = false;
    publish();
    try {
      await markRead(target, [item.id]);
    } catch {
      if (pending.get(item.id) !== entry) return;
      pending.delete(item.id);
      writeError = true;
      publish();
      return;
    }
    if (pending.get(item.id) !== entry) return;
    pending.delete(item.id);
    notifications = notifications.filter(row => row.id !== item.id);
    void refresh(target);
    publish();
    onRead();
  }

  function dismiss(target: string, item: DesktopHomeNotification) {
    if (!target || target !== endpoint || !canWrite() || pending.has(item.id)) return;
    pending.set(item.id, { item, timer: setTimeout(() => void commitRead(target, item), UNDO_WINDOW_MS) });
    publish();
  }

  function undo(id: string) {
    const entry = pending.get(id);
    if (entry?.timer === undefined) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    publish();
  }

  return { subscribe: state.subscribe, setEndpoint, refresh, commitRead, dismiss, undo };
}

export type HomeInbox = ReturnType<typeof createHomeInbox>;
