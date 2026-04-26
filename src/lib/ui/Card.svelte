<script lang="ts">
  export let className = "";
</script>

<section class={`wb-panel rounded-[1.2rem] ${className}`}>
  <slot />
</section>
