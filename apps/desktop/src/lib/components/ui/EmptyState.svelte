<script lang="ts">
  export let title: string;
  export let description = "";
  export let icon = "tray";
</script>

<div class="empty-state" role="status">
  <i class="ph ph-{icon}" aria-hidden="true"></i>
  <strong>{title}</strong>
  {#if description}<p>{description}</p>{/if}
  <div class="empty-state-action"><slot /></div>
</div>
