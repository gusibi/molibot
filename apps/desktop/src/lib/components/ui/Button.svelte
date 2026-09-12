<script lang="ts">
  // Shared button: renders the global `.primary-button` / `.secondary-button`
  // styles so every surface reads as one control family. Surfaces must not
  // fork these styles with surface-scoped overrides (that is how the project
  // settings dialog ended up with pill buttons nobody recognised).
  import type { Snippet } from "svelte";

  let {
    variant = "secondary",
    danger = false,
    type = "button",
    disabled = false,
    title = undefined,
    ariaLabel = undefined,
    class: className = "",
    onclick = () => {},
    children
  }: {
    variant?: "primary" | "secondary";
    danger?: boolean;
    type?: "button" | "submit";
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button {type} {disabled} {title} aria-label={ariaLabel ?? title} class={`${variant}${danger ? " danger-action" : ""}${className ? ` ${className}` : ""}`} {onclick}>
  {@render children()}
</button>
