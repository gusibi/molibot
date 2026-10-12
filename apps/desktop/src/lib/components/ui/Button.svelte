<script lang="ts">
  // Shared button: renders the global primary, secondary or icon button
  // styles so every surface reads as one control family. Surfaces must not
  // fork these styles with surface-scoped overrides (that is how the project
  // settings dialog ended up with pill buttons nobody recognised).
  //
  // `variant` maps to the global control-family class; it must never render a
  // bare `primary`/`secondary` class (no rule matches it), or a consumer that
  // does not also pass an explicit class — Project settings, Update dialog —
  // gets a native button and falls out of the app theme.
  import type { Snippet } from "svelte";

  let {
    variant = "secondary",
    danger = false,
    type = "button",
    disabled = false,
    title = undefined,
    ariaLabel = undefined,
    "aria-pressed": ariaPressed = undefined,
    "aria-expanded": ariaExpanded = undefined,
    class: className = "",
    onclick = () => {},
    children
  }: {
    variant?: "primary" | "secondary" | "icon";
    danger?: boolean;
    type?: "button" | "submit";
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    "aria-pressed"?: boolean;
    "aria-expanded"?: boolean;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button {type} {disabled} {title} aria-label={ariaLabel ?? title} aria-pressed={ariaPressed} aria-expanded={ariaExpanded} class={`${variant === "icon" ? "icon-button" : variant === "primary" ? "primary-button" : "secondary-button"}${danger ? " danger-action" : ""}${className ? ` ${className}` : ""}`} {onclick}>
  {@render children()}
</button>
