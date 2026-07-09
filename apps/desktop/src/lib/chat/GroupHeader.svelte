<script lang="ts">
  export let label: string;
  export let icon = "ph-fill ph-folder";
  export let open = false;
  export let onToggle: () => void;
  export let actionLabel = "";
  export let onAction: (() => void) | null = null;
</script>

<div class="conv-group-head" class:open>
  <button class="conv-group-toggle" type="button" aria-expanded={open} onclick={onToggle}>
    <span class="conv-group-tile" aria-hidden="true"><i class={icon}></i></span>
    <span class="conv-group-label">{label}</span>
  </button>
  {#if onAction}
    <button
      type="button"
      class="conv-group-action"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={() => onAction?.()}
    >
      <i class="ph ph-plus" aria-hidden="true"></i>
    </button>
  {/if}
  <button class="conv-caret-button" type="button" aria-label={label} aria-expanded={open} onclick={onToggle}>
    <i class="ph-bold ph-caret-down conv-caret" class:open aria-hidden="true"></i>
  </button>
</div>
