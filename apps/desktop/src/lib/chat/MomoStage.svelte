<script lang="ts">
  import type { Snippet } from "svelte";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import { MOMO_SHAPES, momoExpressionSrc, type MomoExpression } from "./homePresence";

  /**
   * Momo on the desk. The expression is the Agent's real state, never
   * decoration: the caller passes what `homeMood` resolved and this component
   * only decides how the artwork meets the surface. An Agent with its own
   * avatar keeps that avatar.
   */
  let {
    expression = undefined,
    avatar = "",
    name,
    size = "stage",
    status = "",
    title = "",
    onclick = undefined,
    live = false,
    /** Bump to replay the small hop when the owner reaches for the composer. */
    hop = 0,
    statusIcon = undefined
  }: {
    expression?: MomoExpression;
    avatar?: string;
    name: string;
    size?: "stage" | "pin";
    status?: string;
    title?: string;
    onclick?: () => void;
    live?: boolean;
    hop?: number;
    statusIcon?: Snippet;
  } = $props();

  const shape = $derived(expression ? MOMO_SHAPES[expression] : "avatar");
</script>

{#snippet portrait()}
  {#if expression}
    {#key hop}
      <div class:momo-portrait--hop={hop > 0}>
        {#key expression}
          <img class="momo-art" src={momoExpressionSrc(expression)} alt="" draggable="false" />
        {/key}
      </div>
    {/key}
  {:else}
    <AgentAvatar {name} src={avatar} />
    {#if statusIcon}
      <span class="agent-home-status-mark" aria-hidden="true">{@render statusIcon()}</span>
    {/if}
  {/if}
{/snippet}

<div
  class="momo-stage"
  class:momo-stage--pin={size === "pin"}
  class:momo-stage--bust={shape === "bust"}
  class:momo-stage--badge={shape === "badge"}
  class:momo-stage--avatar={shape === "avatar"}
  data-expression={expression}
  data-status={status || undefined}
>
  <div class="momo-motion">
    {#if live && expression}
      <span class="momo-bubble" aria-hidden="true"><i></i><i></i><i></i></span>
    {/if}
    {#if expression === "sleeping"}
      <span class="momo-zzz" aria-hidden="true"><span>z</span><span>z</span><span>z</span></span>
    {/if}
    <span class="momo-ground" aria-hidden="true"></span>
    {#if onclick}
      <button type="button" class="agent-home-avatar-action momo-figure" {title} aria-label={title} onclick={onclick}>
        {@render portrait()}
      </button>
    {:else}
      <div class="momo-figure" role="img" aria-label={title}>
        {@render portrait()}
      </div>
    {/if}
  </div>
</div>
