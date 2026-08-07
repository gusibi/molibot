<script lang="ts">
  import MiniAppsAiSettings from "../miniapps/MiniAppsAiSettings.svelte";
  import MiniAppsManager from "../miniapps/MiniAppsManager.svelte";

  /**
   * Settings › Plugins mount of the Mini App surfaces.
   *
   * The sidebar's Mini Apps destination is the primary place to browse and
   * install apps; this exists so the list is also reachable from where every
   * other plugin kind lives. Both mount the same manager, so they cannot drift.
   *
   * The AI capability settings live *only* here. They are one global decision
   * about the owner's own model configuration rather than something to tune
   * while browsing apps, so the Mini Apps page links here instead of carrying a
   * second copy of the controls.
   *
   * No `onOpenApp`: opening a panel belongs to Chat. No `onOpenAiSettings`
   * either — the section it would point at is already on this screen.
   */
</script>

<MiniAppsManager />
<MiniAppsAiSettings />
