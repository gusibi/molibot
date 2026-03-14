<script lang="ts">
  type Variant = "default" | "success" | "destructive";

  export let variant: Variant = "default";
  export let className = "";

  const variantClass: Record<Variant, string> = {
    default: "border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
    success: "border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
    destructive: "border-[var(--destructive)] bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] text-[var(--foreground)]"
  };
</script>

<div class={`rounded-md border px-3 py-2 text-sm ${variantClass[variant]} ${className}`}>
  <slot />
</div>
