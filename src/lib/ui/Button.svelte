<script lang="ts">
  type Variant = "default" | "secondary" | "outline" | "destructive" | "ghost";
  type Size = "sm" | "md" | "lg";

  export let type: "button" | "submit" | "reset" = "button";
  export let variant: Variant = "default";
  export let size: Size = "md";
  export let disabled = false;
  export let className = "";

  const variantClass: Record<Variant, string> = {
    default:
      "border border-[color-mix(in_oklab,var(--primary)_32%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_92%,var(--card))] text-[var(--primary-foreground)] shadow-[var(--shadow-sm)] hover:-translate-y-px hover:opacity-95",
    secondary:
      "border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_56%,var(--card))] text-[var(--foreground)] shadow-[var(--shadow-sm)] hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--accent)_68%,var(--card))]",
    outline:
      "border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_92%,transparent)] text-[var(--foreground)] shadow-[var(--shadow-sm)] hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--muted)_72%,var(--card))]",
    destructive:
      "border border-[color-mix(in_oklab,var(--destructive)_34%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_88%,var(--card))] text-[var(--destructive-foreground)] shadow-[var(--shadow-sm)] hover:-translate-y-px hover:opacity-95",
    ghost:
      "border border-transparent bg-transparent text-[var(--foreground)] hover:bg-[color-mix(in_oklab,var(--muted)_62%,var(--card))]"
  };

  const sizeClass: Record<Size, string> = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 text-sm",
    lg: "h-11 px-5 text-sm"
  };
</script>

<button
  {type}
  {disabled}
  on:click
  class={`inline-flex items-center justify-center rounded-full font-medium tracking-[0.02em] transition-all disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ring)_38%,transparent)] ${variantClass[variant]} ${sizeClass[size]} ${className}`}
>
  <slot />
</button>
