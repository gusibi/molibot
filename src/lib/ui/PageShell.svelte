<script lang="ts">
  export let widthClass = "max-w-7xl";
  export let gapClass = "space-y-6";
  export let className = "";
  export let variant: "workbench" | "plain" = "workbench";
</script>

<div class={`settings-page mx-auto ${widthClass} ${gapClass} px-6 py-8 sm:px-10 sm:py-12 ${variant === "workbench" ? "wb-page" : ""} ${className}`}>
  <slot />
</div>
