export type NativeTheme = "light" | "dark";

export type WindowStateSnapshot = {
  active: boolean;
  theme: NativeTheme;
  scaleFactor: number;
  reducedTransparency: boolean;
  increasedContrast: boolean;
};

type Unlisten = () => void;

type WindowStateHost = {
  isFocused(): Promise<boolean>;
  theme(): Promise<NativeTheme | null>;
  setTheme(theme: NativeTheme | null): Promise<void>;
  scaleFactor(): Promise<number>;
  onFocusChanged(listener: (focused: boolean) => void): Promise<Unlisten>;
  onThemeChanged(listener: (theme: NativeTheme) => void): Promise<Unlisten>;
  onScaleChanged(listener: (scaleFactor: number) => void): Promise<Unlisten>;
};

type MediaQuery = {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};

type WindowStateEnvironment = {
  active(): boolean;
  theme(): NativeTheme;
  scaleFactor(): number;
  media(query: string): MediaQuery;
  onFocus(listener: () => void): Unlisten;
  onBlur(listener: () => void): Unlisten;
};

export type WindowStateAdapter = {
  snapshot: WindowStateSnapshot;
  subscribe(listener: (snapshot: WindowStateSnapshot) => void): Unlisten;
  setTheme(theme: NativeTheme | null): Promise<void>;
  start(): Promise<void>;
  dispose(): void;
};

const browserEnvironment: WindowStateEnvironment = {
  active: () => document.hasFocus(),
  theme: () => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  scaleFactor: () => window.devicePixelRatio || 1,
  media: (query) => window.matchMedia(query),
  onFocus(listener) {
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  },
  onBlur(listener) {
    window.addEventListener("blur", listener);
    return () => window.removeEventListener("blur", listener);
  }
};

function initialSnapshot(environment: WindowStateEnvironment): WindowStateSnapshot {
  return {
    active: environment.active(),
    theme: environment.theme(),
    scaleFactor: environment.scaleFactor(),
    reducedTransparency: environment.media("(prefers-reduced-transparency: reduce)").matches,
    increasedContrast: environment.media("(prefers-contrast: more)").matches
  };
}

export function createWindowState(
  host: WindowStateHost | null = null,
  environment: WindowStateEnvironment = browserEnvironment
): WindowStateAdapter {
  let snapshot = initialSnapshot(environment);
  let disposed = false;
  const listeners = new Set<(next: WindowStateSnapshot) => void>();
  const cleanups: Unlisten[] = [];

  function update(next: Partial<WindowStateSnapshot>): void {
    const updated = { ...snapshot, ...next };
    if (Object.entries(updated).every(([key, value]) => snapshot[key as keyof WindowStateSnapshot] === value)) return;
    snapshot = updated;
    for (const listener of listeners) listener(snapshot);
  }

  function subscribe(listener: (next: WindowStateSnapshot) => void): Unlisten {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function start(): Promise<void> {
    if (disposed) return;
    const reducedTransparency = environment.media("(prefers-reduced-transparency: reduce)");
    const increasedContrast = environment.media("(prefers-contrast: more)");
    const refreshAccessibility = () => update({
      reducedTransparency: reducedTransparency.matches,
      increasedContrast: increasedContrast.matches
    });
    reducedTransparency.addEventListener("change", refreshAccessibility);
    increasedContrast.addEventListener("change", refreshAccessibility);
    cleanups.push(
      environment.onFocus(() => update({ active: true })),
      environment.onBlur(() => update({ active: false })),
      () => reducedTransparency.removeEventListener("change", refreshAccessibility),
      () => increasedContrast.removeEventListener("change", refreshAccessibility)
    );

    if (!host) return;
    const [active, theme, scaleFactor, removeFocus, removeTheme, removeScale] = await Promise.all([
      host.isFocused(),
      host.theme(),
      host.scaleFactor(),
      host.onFocusChanged((focused) => update({ active: focused })),
      host.onThemeChanged((nextTheme) => update({ theme: nextTheme })),
      host.onScaleChanged((nextScaleFactor) => update({ scaleFactor: nextScaleFactor }))
    ]);
    if (disposed) {
      removeFocus();
      removeTheme();
      removeScale();
      return;
    }
    cleanups.push(removeFocus, removeTheme, removeScale);
    update({ active, theme: theme ?? environment.theme(), scaleFactor });
  }

  return {
    get snapshot() {
      return snapshot;
    },
    subscribe,
    setTheme(theme) {
      return host?.setTheme(theme) ?? Promise.resolve();
    },
    start,
    dispose() {
      if (disposed) return;
      disposed = true;
      while (cleanups.length) cleanups.pop()?.();
      listeners.clear();
    }
  };
}

export async function createTauriWindowState(): Promise<WindowStateAdapter> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  return createWindowState({
    isFocused: () => window.isFocused(),
    theme: () => window.theme(),
    setTheme: (theme) => window.setTheme(theme),
    scaleFactor: () => window.scaleFactor(),
    onFocusChanged(listener) {
      return window.onFocusChanged(({ payload }) => listener(payload));
    },
    onThemeChanged(listener) {
      return window.onThemeChanged(({ payload }) => listener(payload));
    },
    onScaleChanged(listener) {
      return window.onScaleChanged(({ payload }) => listener(payload.scaleFactor));
    }
  });
}
