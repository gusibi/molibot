<script lang="ts">
  export let title: string;
  export let description = "";
  export let icon = "tray";
</script>

<div class="section-empty" role="status">
  <i class="ph ph-{icon}" aria-hidden="true"></i>
  <strong>{title}</strong>
  {#if description}<p>{description}</p>{/if}
  <div class="section-empty-action"><slot /></div>
</div>
