<script lang="ts">
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import { cardIcon } from "../chat/activityIcons";
  import type { DesktopMiniAppResultCard } from "@molibot/desktop-contract";

  /**
   * A Mini App result card (roadmap §2.3).
   *
   * Display only. There is no control here that can write anything: the single
   * affordance is the deep link, which opens the App's own panel and hands it
   * the locator. That is the roadmap's constraint — "卡片是展示，卡片内的交互一律
   * 跳 App 面板" — expressed as a component that structurally cannot do more.
   *
   * Domain-agnostic like every other shared Mini App surface: it renders
   * whatever label/value pairs the host sanitizer allowed through and knows
   * nothing about any app's vocabulary (pitfall #7 / #19 corollary).
   */
  let {
    card,
    openLabel,
    onOpenLink
  }: {
    card: DesktopMiniAppResultCard;
    openLabel: string;
    onOpenLink: (link: string) => void;
  } = $props();
</script>

<div class="miniapp-card">
  <div class="miniapp-card-head">
    {#if card.icon}
      {@const CardIcon = cardIcon(card.icon)}
      <CardIcon class="miniapp-card-icon" size={16} aria-hidden="true" />
    {/if}
    <div class="miniapp-card-heading">
      <strong class="miniapp-card-title">{card.title}</strong>
      {#if card.subtitle}<span class="miniapp-card-subtitle">{card.subtitle}</span>{/if}
    </div>
  </div>

  {#if card.fields.length > 0}
    <dl class="miniapp-card-fields">
      {#each card.fields as field, index (index)}
        <!-- Index keys: a static, host-truncated list where two fields may
             legitimately share a label or a value (pitfall #31a). -->
        <div class="miniapp-card-field">
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if card.link}
    {@const link = card.link}
    <button type="button" class="miniapp-card-link" onclick={() => onOpenLink(link)}>
      <span>{openLabel}</span>
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  {/if}
</div>
