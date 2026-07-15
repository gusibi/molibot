<script lang="ts">
  export let title: string;
  export let description = "";
  export let stacked = false;
</script>

<div class:stacked class="settings-row setting-row">
  <div class="setting-row-copy">
    <strong>{title}</strong>
    {#if description}<p>{description}</p>{/if}
    <slot name="detail" />
  </div>
  <div class="setting-row-control"><slot /></div>
</div>
