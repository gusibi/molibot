<script lang="ts">
  type Variant = "default" | "secondary" | "outline" | "destructive" | "ghost";
  type Size = "sm" | "md" | "lg";

  export let type: "button" | "submit" | "reset" = "button";
  export let variant: Variant = "default";
  export let size: Size = "md";
  export let disabled = false;
  export let className = "";

  const variantClass: Record<Variant, string> = {
    default: "bg-[var(--primary)] text-[var(--primary-foreground)] border border-[var(--primary)] hover:opacity-90",
    secondary: "bg-[var(--secondary)] text-[var(--secondary-foreground)] border border-[var(--border)] hover:opacity-95",
    outline: "bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--muted)]",
    destructive: "bg-[var(--destructive)] text-[var(--destructive-foreground)] border border-[var(--destructive)] hover:opacity-90",
    ghost: "bg-transparent text-[var(--foreground)] border border-transparent hover:bg-[var(--muted)]"
  };

  const sizeClass: Record<Size, string> = {
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 text-sm",
    lg: "h-10 px-5 text-sm"
  };
</script>

<button
  {type}
  {disabled}
  class={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
>
  <slot />
</button>
