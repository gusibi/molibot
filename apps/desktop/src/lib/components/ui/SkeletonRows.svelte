<script lang="ts">
  export let count = 3;
  export let label = "Loading";
</script>

<div class="skeleton-rows" role="status" aria-label={label} aria-live="polite">
  {#each Array(count) as _, index (index)}
    <div class="skeleton-row" aria-hidden="true"><span></span><i></i></div>
  {/each}
</div>
