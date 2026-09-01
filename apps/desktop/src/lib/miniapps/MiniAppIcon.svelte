<script lang="ts">
  import Window from "reicon-svelte/icons/Window";
  let {
    src = "",
    label,
    size = "list"
  }: {
    src?: string;
    label: string;
    size?: "sidebar" | "list" | "tab";
  } = $props();
</script>

<span class={`miniapp-icon miniapp-icon-${size}`} aria-hidden="true" title={label}>
  {#if src}
    <img src={src} alt="" width="20" height="20" />
  {:else}
    <Window size={24} aria-hidden="true" />
  {/if}
</span>
