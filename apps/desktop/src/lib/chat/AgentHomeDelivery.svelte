<script lang="ts">
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import CircleInfo from "reicon-svelte/icons/CircleInfo";
  import type { DesktopDeliveryDisplay } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  let {
    display,
    copy,
    locale,
    onOpen,
    openable = true
  }: {
    display: DesktopDeliveryDisplay;
    copy: Translation;
    locale: string;
    onOpen: () => void;
    openable?: boolean;
  } = $props();

  const recommended = $derived(display.type === "topic-proposals"
    ? display.candidates.find((candidate) => candidate.id === display.recommendedCandidateId) ?? null
    : null);
  const otherCandidates = $derived(display.type === "topic-proposals"
    ? display.candidates.filter((candidate) => candidate.id !== display.recommendedCandidateId)
    : []);
  const separator = $derived(locale === "zh-CN" ? "、" : ", ");
</script>

{#if display.type === "briefing"}
  <div class="agent-home-delivery" data-display="briefing">
    <span class="agent-home-delivery-kind">{copy.handoverBriefingLabel}</span>
    <h3 class="agent-home-delivery-title">{display.title}</h3>
    {#if display.introduction}<p class="agent-home-delivery-lede">{display.introduction}</p>{/if}
    {#if display.highlights.length}
      <ol class="agent-home-highlights">
        {#each display.highlights as highlight (highlight.title)}
          <li>
            <h4>{highlight.title}</h4>
            <p>{highlight.takeaway}</p>
            {#if highlight.sources?.length}
              <p class="agent-home-delivery-sources">
                <span>{copy.handoverSourceLabel}</span>
                {#each highlight.sources as source, index (source.label + index)}
                  {#if index > 0}<span aria-hidden="true">{separator}</span>{/if}
                  {#if source.url}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>{:else}<span>{source.label}</span>{/if}
                {/each}
              </p>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if display.bodyPreview}<p class="agent-home-delivery-body">{display.bodyPreview}</p>{/if}
    <button type="button" class="agent-home-delivery-open" disabled={!openable} onclick={onOpen}>{copy.handoverReadDelivery}<ArrowRight size={14} aria-hidden="true" /></button>
  </div>
{:else if display.type === "topic-proposals"}
  <div class="agent-home-delivery" data-display="topic-proposals">
    <span class="agent-home-delivery-kind">{copy.handoverTopicLabel}</span>
    <h3 class="agent-home-delivery-title">{display.title}</h3>
    {#if recommended}
      <article class="agent-home-topic agent-home-topic--recommended">
        <span class="agent-home-chip">{copy.handoverRecommendedTopic}</span>
        <h4>{recommended.title}</h4>
        <p class="agent-home-topic-angle">{recommended.angle}</p>
        {#if recommended.rationale}<p>{recommended.rationale}</p>{/if}
        {#if recommended.outline?.length}
          <div class="agent-home-topic-block">
            <span>{copy.handoverViewOutline}</span>
            <ol>{#each recommended.outline as line (line)}<li>{line}</li>{/each}</ol>
          </div>
        {/if}
        {#if recommended.materials?.length}
          <p class="agent-home-topic-materials"><span>{copy.handoverMaterials}</span>{recommended.materials.join(separator)}</p>
        {/if}
      </article>
    {/if}
    {#if otherCandidates.length}
      <div class="agent-home-topic-others">
        <span class="agent-home-topic-others-label">{copy.handoverOtherCandidates}</span>
        {#each otherCandidates as candidate (candidate.id)}
          <div class="agent-home-topic-candidate">
            <h4>{candidate.title}</h4>
            <p>{candidate.angle}</p>
          </div>
        {/each}
      </div>
    {/if}
    <button type="button" class="agent-home-delivery-open" disabled={!openable} onclick={onOpen}>{copy.handoverReadDelivery}<ArrowRight size={14} aria-hidden="true" /></button>
  </div>
{:else if display.type === "document"}
  <div class="agent-home-delivery" data-display="document">
    <span class="agent-home-delivery-kind">{copy.handoverDocumentLabel}</span>
    <h3 class="agent-home-delivery-title">{display.title}</h3>
    {#if display.summary}<p class="agent-home-delivery-lede">{display.summary}</p>{/if}
    <button type="button" class="agent-home-delivery-open" disabled={!openable} onclick={onOpen}>{copy.handoverReadDelivery}<ArrowRight size={14} aria-hidden="true" /></button>
  </div>
{:else}
  <div class="agent-home-delivery" data-display="generic">
    {#if display.title}<h3 class="agent-home-delivery-title">{display.title}</h3>{/if}
    {#if display.summary}<p class="agent-home-delivery-lede">{display.summary}</p>{/if}
    {#if display.artifactPath}<p class="agent-home-delivery-meta"><CircleInfo size={13} aria-hidden="true" />{display.artifactPath}</p>{/if}
  </div>
{/if}
