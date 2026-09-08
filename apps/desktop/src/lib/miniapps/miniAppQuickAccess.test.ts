import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMiniAppQuickAccess,
  recordMiniAppRecent,
  saveMiniAppQuickAccess,
  toggleMiniAppFavorite,
  type MiniAppQuickAccessStorage
} from "./miniAppQuickAccess";
import type { MiniAppQuickAccessState } from "./miniAppQuickAccess";

function memoryStorage(): MiniAppQuickAccessStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("mini app quick access survives a save and load round trip per connection scope", () => {
  const storage = memoryStorage();
  const state = {
    favoriteIds: ["prompt-box", "todo"],
    recentIds: ["todo", "prompt-box"]
  };

  saveMiniAppQuickAccess(storage, "http://127.0.0.1:3040", state);

  assert.deepEqual(loadMiniAppQuickAccess(storage, "http://127.0.0.1:3040"), state);
  assert.deepEqual(loadMiniAppQuickAccess(storage, "http://127.0.0.1:3041"), {
    favoriteIds: [],
    recentIds: []
  });
});

test("quick access state removes duplicate and invalid ids while loading", () => {
  const storage = memoryStorage();
  storage.setItem(
    "molibot-miniapp-quick-access:http%3A%2F%2F127.0.0.1%3A3040",
    JSON.stringify({ favoriteIds: ["todo", "todo", 4], recentIds: ["todo", "todo", null] })
  );

  assert.deepEqual(loadMiniAppQuickAccess(storage, "http://127.0.0.1:3040"), {
    favoriteIds: ["todo"],
    recentIds: ["todo"]
  });
});

test("favorite and recent actions are idempotent and keep the recent list bounded", () => {
  let state: MiniAppQuickAccessState = { favoriteIds: [], recentIds: [] };
  state = toggleMiniAppFavorite(state, "todo");
  state = toggleMiniAppFavorite(state, "todo");
  assert.deepEqual(state.favoriteIds, []);

  for (let index = 0; index < 7; index += 1) {
    state = recordMiniAppRecent(state, `app-${index}`);
  }
  state = recordMiniAppRecent(state, "app-4");
  assert.deepEqual(state.recentIds, ["app-4", "app-6", "app-5", "app-3", "app-2"]);
});
