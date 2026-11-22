import { mount, unmount } from "svelte";
import { writable, fromStore } from "svelte/store";
import Panel from "./ContextWindowPanel.svelte";
import { translator } from "../i18n";

/** Browser-only fixture for polling transitions on the real panel. */
export function mountContextPanel(target: HTMLElement, endpoint: string) {
  const live = writable(false);
  const state = fromStore(live);
  const panel = mount(Panel, {
    target,
    props: {
      copy: translator("en"), locale: "en", endpoint,
      profileId: "default", sessionId: "fixture",
      usage: null, sessionUsage: null, fallbackContextWindow: 1000,
      get sending() { return state.current; }
    }
  });
  return { setLive: () => live.set(true), destroy: () => unmount(panel) };
}
