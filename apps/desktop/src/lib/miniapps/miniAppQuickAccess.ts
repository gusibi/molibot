export interface MiniAppQuickAccessState {
  favoriteIds: string[];
  recentIds: string[];
}

export interface MiniAppQuickAccessStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "molibot-miniapp-quick-access:";
const RECENT_LIMIT = 10;

function emptyQuickAccess(): MiniAppQuickAccessState {
  return { favoriteIds: [], recentIds: [] };
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || ids.includes(item)) continue;
    ids.push(item);
  }
  return ids;
}

function normalizeQuickAccess(value: unknown): MiniAppQuickAccessState {
  if (!value || typeof value !== "object") return emptyQuickAccess();
  const candidate = value as { favoriteIds?: unknown; recentIds?: unknown };
  return {
    favoriteIds: uniqueIds(candidate.favoriteIds),
    recentIds: uniqueIds(candidate.recentIds).slice(0, RECENT_LIMIT)
  };
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

export function loadMiniAppQuickAccess(
  storage: MiniAppQuickAccessStorage | null | undefined,
  scope: string
): MiniAppQuickAccessState {
  if (!storage || !scope) return emptyQuickAccess();
  try {
    const raw = storage.getItem(storageKey(scope));
    return raw ? normalizeQuickAccess(JSON.parse(raw)) : emptyQuickAccess();
  } catch {
    return emptyQuickAccess();
  }
}

export function saveMiniAppQuickAccess(
  storage: MiniAppQuickAccessStorage | null | undefined,
  scope: string,
  state: MiniAppQuickAccessState
): void {
  if (!storage || !scope) return;
  try {
    storage.setItem(storageKey(scope), JSON.stringify(normalizeQuickAccess(state)));
  } catch {
    // A storage quota or privacy failure should not stop an app from opening.
  }
}

export function toggleMiniAppFavorite(
  state: MiniAppQuickAccessState,
  appId: string
): MiniAppQuickAccessState {
  if (!appId) return state;
  const favoriteIds = state.favoriteIds.includes(appId)
    ? state.favoriteIds.filter((id) => id !== appId)
    : [...state.favoriteIds, appId];
  return { ...state, favoriteIds };
}

export function recordMiniAppRecent(
  state: MiniAppQuickAccessState,
  appId: string
): MiniAppQuickAccessState {
  if (!appId) return state;
  return {
    ...state,
    recentIds: [appId, ...state.recentIds.filter((id) => id !== appId)].slice(0, RECENT_LIMIT)
  };
}
