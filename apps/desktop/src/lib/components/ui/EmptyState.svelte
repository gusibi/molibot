<script lang="ts">
  import Activity from "reicon-svelte/icons/Activity";
  import DuotoneIcon from "../../icons/duotone/DuotoneIcon.svelte";
  import type { DuotoneIconName } from "../../icons/duotone/bodies.generated";
  import type { ReiconComponent } from "./iconTypes";

  /**
   * Empty states are decorative showcase positions, so they render the Reicon
   * duotone weight (DESIGN.md "Foundations"). Only glyphs without an official
   * duotone — and without a same-concept duotone in the generated module —
   * fall back to their Outline component.
   */
  const EMPTY_STATE_ICONS = {
    activity: { outline: Activity },
    bell: { duotone: "Bell" },
    "chart-line": { duotone: "ChartLine" },
    "chat-circle-dots": { duotone: "ChatDots" },
    "check-circle": { duotone: "CheckCircle" },
    "clock-countdown": { duotone: "Stopwatch" },
    "clock-counter-clockwise": { duotone: "History" },
    "cloud-slash": { duotone: "CloudCross" },
    cpu: { duotone: "Cpu" },
    cube: { duotone: "Box" },
    eye: { duotone: "Eye" },
    "eye-slash": { duotone: "EyeClosed" },
    "file-text": { duotone: "FileText" },
    "film-strip": { duotone: "Clapperboard" },
    image: { duotone: "Gallery" },
    "list-magnifying-glass": { duotone: "Search" },
    "magnifying-glass": { duotone: "Magnifier" },
    plugs: { duotone: "Socket" },
    "plugs-connected": { duotone: "PlugCircle" },
    pulse: { duotone: "Pulse" },
    ranking: { duotone: "Ranking" },
    robot: { duotone: "Cpu" },
    "shield-slash": { duotone: "ShieldSlash" },
    "shield-warning": { duotone: "ShieldAlert" },
    sparkle: { duotone: "Wand" },
    "speaker-high": { duotone: "Speaker" },
    tray: { duotone: "Inbox" },
    user: { duotone: "User" },
    "warning-circle": { duotone: "TriangleWarning" }
  } satisfies Record<string, { duotone: DuotoneIconName } | { outline: ReiconComponent }>;

  type EmptyStateIcon = keyof typeof EMPTY_STATE_ICONS;

  export let title: string;
  export let description = "";
  export let icon: EmptyStateIcon = "tray";

  $: iconSpec = EMPTY_STATE_ICONS[icon];
</script>

<div class="section-empty" role="status">
  {#if "duotone" in iconSpec}
    <DuotoneIcon name={iconSpec.duotone} size={24} class="section-empty-icon" />
  {:else}
    {@const OutlineIcon = iconSpec.outline}
    <OutlineIcon class="section-empty-icon" size={24} aria-hidden="true" />
  {/if}
  <strong>{title}</strong>
  {#if description}<p>{description}</p>{/if}
  <div class="section-empty-action"><slot /></div>
</div>
