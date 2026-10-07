import { writable } from "svelte/store";
import type { Snippet } from "svelte";

/**
 * The window's single global header shows the current page's identity. Pages do
 * not render their own title bar; they publish their title, secondary context
 * and action row here, and the shared window layout renders them in the one
 * header band next to the native controls (see `ChatView` and DESIGN.md).
 *
 * `actions` is a Svelte snippet owned by whichever page is mounted, so it keeps
 * that page's handlers and reactive state. Each provider carries an `owner`
 * token and only clears the store on unmount when it still owns it, so a page
 * swap can never blank out the page that mounted in its place.
 */
export type WindowHeaderContent = {
  title: string;
  sourceLabel: string;
  subtitle: string;
  searching: boolean;
  actions: Snippet | null;
  owner: symbol | null;
};

export const emptyWindowHeader: WindowHeaderContent = {
  title: "",
  sourceLabel: "",
  subtitle: "",
  searching: false,
  actions: null,
  owner: null
};

export const windowHeader = writable<WindowHeaderContent>({ ...emptyWindowHeader });
