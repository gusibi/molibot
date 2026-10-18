import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

(globalThis as any).$state = <T>(value: T): T => value;
const { createAppLogoStore, APP_LOGOS } = await import("./appLogo.svelte.js");
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

test("desktop selection updates native icons and restores from native persistence", async () => {
  let saved = "sleeping";
  const calls: string[] = [];
  const host = { read: async () => saved, write: async (id: string) => { calls.push(id); saved = id; return id; } };
  const local = storage();
  local.values.set("molibot-desktop-app-logo", "happy");
  const store = createAppLogoStore(host, local);
  assert.equal(store.state.ready, false);
  await store.initialize();
  assert.equal(store.state.id, "sleeping");
  await store.select("waving");
  assert.deepEqual(calls, ["waving"]);
  assert.equal(store.state.id, saved);
  assert.equal(store.state.src, "/logos/08-waving.webp");
  const restarted = createAppLogoStore(host, local);
  await restarted.initialize();
  assert.equal(restarted.state.id, "waving");
  assert.equal(local.values.get("molibot-desktop-app-logo"), "happy");
});

test("native failure keeps the confirmed choice, exposes feedback and permits retry", async () => {
  let fail = true;
  const store = createAppLogoStore({ read: async () => "sleeping", write: async (id: string) => { if (fail) throw new Error("tray unavailable"); return id; } }, storage());
  await store.initialize();
  await store.select("waving");
  assert.equal(store.state.id, "sleeping");
  assert.equal(store.state.error, "tray unavailable");
  assert.equal(store.state.busy, false);
  fail = false;
  await store.select("waving");
  assert.equal(store.state.id, "waving");
  assert.equal(store.state.error, "");
});

test("initial restore failure is visible and a new selection can recover", async () => {
  const store = createAppLogoStore({ read: async () => { throw "restore failed"; }, write: async (id: string) => id }, storage());
  await store.initialize();
  assert.equal(store.state.ready, true);
  assert.equal(store.state.error, "restore failed");
  await store.select("happy");
  assert.equal(store.state.id, "happy");
  assert.equal(store.state.error, "");
});

test("pending native change cannot be overtaken or displayed before success", async () => {
  let complete!: (id: string) => void;
  const calls: string[] = [];
  const store = createAppLogoStore({ read: async () => "molibot", write: (id: string) => { calls.push(id); return new Promise<string>((resolve) => complete = resolve); } }, storage());
  await store.initialize();
  const pending = store.select("waving");
  assert.equal(store.state.busy, true);
  assert.equal(store.state.id, "molibot");
  await store.select("sleeping");
  complete("waving");
  await pending;
  assert.deepEqual(calls, ["waving"]);
  assert.equal(store.state.id, "waving");
  assert.equal(store.state.busy, false);
});

test("browser preview persists locally, normalizes unknown IDs and all assets exist", async () => {
  const local = storage();
  const store = createAppLogoStore(null, local);
  await store.initialize();
  await store.select("waving");
  assert.equal(local.values.get("molibot-desktop-app-logo"), "waving");
  assert.equal(createAppLogoStore(null, local).state.id, "waving");
  await store.select("not-a-logo");
  assert.equal(store.state.id, "molibot");
  assert.equal(APP_LOGOS.length, 17);
  for (const logo of APP_LOGOS) {
    assert.ok(existsSync(`public${logo.src}`), logo.src);
    assert.ok(existsSync(`public/app-icons/${logo.id}.png`), logo.id);
    assert.ok(existsSync(`src-tauri/icons/logos/${logo.id}-tray.png`), logo.id);
  }
});
