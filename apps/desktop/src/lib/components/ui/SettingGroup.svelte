<script lang="ts">
  export let title = "";
  export let description = "";
  export let ariaLabel = "";
  export let contentClass = "";
</script>

<section class="setting-group-section" aria-label={ariaLabel || title || undefined}>
  {#if title || description}
    <header class="section-header">
      <div>
        {#if title}<h3>{title}</h3>{/if}
        {#if description}<p>{description}</p>{/if}
      </div>
      <div class="section-header-action"><slot name="action" /></div>
    </header>
  {/if}
  <div class={`settings-card setting-group ${contentClass}`.trim()}><slot /></div>
</section>
