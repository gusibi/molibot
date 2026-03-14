<script lang="ts">
  export let className = "";
</script>

<section class={`rounded-xl border border-[var(--border)] bg-[var(--card)] ${className}`}>
  <slot />
</section>
