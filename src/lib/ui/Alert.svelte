<script lang="ts">
  type Variant = "default" | "success" | "destructive";

  export let variant: Variant = "default";
  export let className = "";

  const variantClass: Record<Variant, string> = {
    default: "wb-status-line",
    success: "wb-status-line",
    destructive: "wb-status-line wb-panel-danger"
  };
</script>

<div class={`text-sm ${variantClass[variant]} ${className}`}>
  <slot />
</div>
