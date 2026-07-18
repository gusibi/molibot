import assert from "node:assert/strict";
import test from "node:test";
import { createWindowState, type NativeTheme } from "./windowState";

type Listener = () => void;

function createEnvironment() {
  let focused = true;
  let theme: NativeTheme = "light";
  let scaleFactor = 2;
  const focusListeners = new Set<Listener>();
  const blurListeners = new Set<Listener>();
  const mediaListeners = new Map<string, Set<Listener>>();
  const mediaMatches = new Map<string, boolean>();

  return {
    environment: {
      active: () => focused,
      theme: () => theme,
      scaleFactor: () => scaleFactor,
      media(query: string) {
        return {
          get matches() { return mediaMatches.get(query) ?? false; },
          addEventListener(_type: "change", listener: Listener) {
            const listeners = mediaListeners.get(query) ?? new Set<Listener>();
            listeners.add(listener);
            mediaListeners.set(query, listeners);
          },
          removeEventListener(_type: "change", listener: Listener) {
            mediaListeners.get(query)?.delete(listener);
          }
        };
      },
      onFocus(listener: Listener) {
        focusListeners.add(listener);
        return () => focusListeners.delete(listener);
      },
      onBlur(listener: Listener) {
        blurListeners.add(listener);
        return () => blurListeners.delete(listener);
      }
    },
    focus(next = true) {
      focused = next;
      for (const listener of next ? focusListeners : blurListeners) listener();
    },
    setTheme(next: NativeTheme) { theme = next; },
    setScaleFactor(next: number) { scaleFactor = next; },
    setMedia(query: string, matches: boolean) {
      mediaMatches.set(query, matches);
      for (const listener of mediaListeners.get(query) ?? []) listener();
    }
  };
}

function createHost() {
  let focused = true;
  let theme: NativeTheme = "light";
  let scaleFactor = 2;
  let focusListener: ((value: boolean) => void) | null = null;
  let themeListener: ((value: NativeTheme) => void) | null = null;
  let scaleListener: ((value: number) => void) | null = null;
  let unlistens = 0;

  return {
    host: {
      isFocused: async () => focused,
      theme: async () => theme,
      scaleFactor: async () => scaleFactor,
      onFocusChanged: async (listener: (value: boolean) => void) => {
        focusListener = listener;
        return () => { unlistens += 1; focusListener = null; };
      },
      onThemeChanged: async (listener: (value: NativeTheme) => void) => {
        themeListener = listener;
        return () => { unlistens += 1; themeListener = null; };
      },
      onScaleChanged: async (listener: (value: number) => void) => {
        scaleListener = listener;
        return () => { unlistens += 1; scaleListener = null; };
      }
    },
    emitFocus(value: boolean) { focused = value; focusListener?.(value); },
    emitTheme(value: NativeTheme) { theme = value; themeListener?.(value); },
    emitScale(value: number) { scaleFactor = value; scaleListener?.(value); },
    unlistens: () => unlistens
  };
}

test("WindowState projects native focus, theme, scale, and accessibility changes once", async () => {
  const environment = createEnvironment();
  const native = createHost();
  const state = createWindowState(native.host, environment.environment);
  const snapshots: string[] = [];
  state.subscribe((snapshot) => snapshots.push(JSON.stringify(snapshot)));

  await state.start();
  native.emitFocus(false);
  native.emitTheme("dark");
  native.emitScale(1.5);
  environment.setMedia("(prefers-reduced-transparency: reduce)", true);
  environment.setMedia("(prefers-contrast: more)", true);

  assert.deepEqual(state.snapshot, {
    active: false,
    theme: "dark",
    scaleFactor: 1.5,
    reducedTransparency: true,
    increasedContrast: true
  });
  assert.equal(snapshots.length, 5);
  state.dispose();
  assert.equal(native.unlistens(), 3);
});

test("WindowState falls back to browser lifecycle and stops updates after disposal", async () => {
  const environment = createEnvironment();
  const state = createWindowState(null, environment.environment);
  await state.start();

  environment.focus(false);
  assert.equal(state.snapshot.active, false);
  state.dispose();
  environment.focus(true);
  environment.setMedia("(prefers-contrast: more)", true);
  assert.equal(state.snapshot.active, false);
  assert.equal(state.snapshot.increasedContrast, false);
});
