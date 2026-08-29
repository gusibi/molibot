<script lang="ts">
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
    <i class="ph ph-app-window" aria-hidden="true"></i>
  {/if}
</span>
