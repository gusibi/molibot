<script lang="ts">
  let {
    src = "",
    label,
    size = "list"
  }: {
    src?: string;
    label: string;
    size?: "sidebar" | "list" | "panel";
  } = $props();
</script>

<span class={`miniapp-icon miniapp-icon-${size}`} aria-hidden="true" title={label}>
  {#if src}
    <img src={src} alt="" />
  {:else}
    <i class="ph ph-app-window"></i>
  {/if}
</span>
