<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import { emptyWindowHeader, windowHeader } from "./windowHeader";

  /**
   * A page publishes its identity to the shared window header through this
   * component instead of rendering its own title bar. It renders nothing: the
   * one `<header class="chat-header">` lives in the window layout (`ChatView`),
   * next to the native controls, so every page shares one header row and the
   * content container below never repeats a title (DESIGN.md: unified window
   * header). Pages keep ownership of their title state and action handlers.
   */
  let {
    title,
    sourceLabel = "",
    subtitle = "",
    searching = false,
    actions = null
  }: {
    title: string;
    sourceLabel?: string;
    subtitle?: string;
    searching?: boolean;
    actions?: Snippet | null;
  } = $props();

  const owner = Symbol("window-header");

  $effect(() => {
    windowHeader.set({ title, sourceLabel, subtitle, searching, actions, owner });
  });

  onDestroy(() => {
    windowHeader.update((current) => current.owner === owner ? { ...emptyWindowHeader } : current);
  });
</script>
