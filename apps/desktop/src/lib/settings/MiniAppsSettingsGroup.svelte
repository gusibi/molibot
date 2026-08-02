<script lang="ts">
  import MiniAppsManager from "../miniapps/MiniAppsManager.svelte";

  /**
   * Settings › Plugins mount of the Mini App manager.
   *
   * The sidebar's Mini Apps destination is the primary surface; this exists so
   * the app list is also reachable from where every other plugin kind lives.
   * Both mount the same component, so they cannot drift apart.
   *
   * No `onOpenApp` here: opening a panel belongs to Chat, and Settings is a
   * different view.
   */
</script>

<MiniAppsManager />
