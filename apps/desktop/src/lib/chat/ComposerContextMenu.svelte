<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Locale } from "../i18n";
  import type { Translation } from "../i18n";
  import type { DesktopSessionUsageSummary } from "@molibot/desktop-contract";
  import {
    deriveSessionUsageView,
    formatContextTokens,
    type ComposerContextUsage
  } from "../presentation";

  export let copy: Translation;
  export let locale: Locale;
  /** Null until a transcript carries usage: the panel then shows an empty state and the ring stays empty. */
  export let usage: ComposerContextUsage | null = null;
  /**
   * Server-summed cumulative usage for the ACTIVE session, from the transcript
   * response. `null` before the first load (draft) — the panel then only shows
   * the context section; `available: false` renders the explicit unavailable
   * state, never zero.
   */
  export let sessionUsage: DesktopSessionUsageSummary | null = null;

  let root: HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = false;

  const RING_RADIUS = 8;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  /** One full turn of the ring = 100% of the context window. */
  $: ringFrac = usage && usage.usedTokens > 0
    ? Math.min(1, Math.max(0.02, usage.percent / 100))
    : 0;
  $: hasWindow = (usage?.contextWindow ?? 0) > 0;
  $: usedLabel = usage ? formatContextTokens(usage.usedTokens, locale) : "";
  $: capacityLabel = usage ? (hasWindow ? `${usedLabel}/${formatContextTokens(usage.contextWindow, locale)}` : usedLabel) : "";
  $: percentLabel = usage && hasWindow ? formatShare(usage.percent) : "";
  $: sessionView = deriveSessionUsageView(sessionUsage);
  $: sessionUnavailable = sessionUsage !== null && sessionView === null;

  /** 93% · 3% · 0.4% — significant digits only, never a bare "0.0%". */
  function formatShare(percent: number): string {
    if (!Number.isFinite(percent) || percent <= 0) return "0%";
    if (percent < 0.05) return "<0.1%";
    const value = percent >= 10 ? Math.round(percent) : Number(percent.toFixed(1));
    return `${value}%`;
  }

  /** Grouped exact count ("84,028") for row tooltips, in the active locale. */
  function exactTokens(value: number): string {
    return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US").format(value);
  }

  function categoryLabel(key: ComposerContextUsage["categories"][number]["key"]): string {
    return {
      messages: copy.contextCategoryMessages,
      mcpTools: copy.contextCategoryMcpTools,
      systemTools: copy.contextCategorySystemTools,
      systemPrompt: copy.contextCategorySystemPrompt,
      skills: copy.contextCategorySkills,
      other: copy.contextCategoryOther
    }[key];
  }

  function close(restoreFocus = false): void {
    open = false;
    root.open = false;
    if (restoreFocus) trigger.focus();
  }

  async function onTriggerKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open = true;
    root.open = true;
    await tick();
    root?.querySelector<HTMLElement>(".composer-context-head")?.focus();
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (open && !root.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  });
</script>

<details class="composer-context-menu" bind:this={root} ontoggle={(event) => (open = event.currentTarget.open)}>
  <summary
    bind:this={trigger}
    class="composer-context-trigger"
    aria-label={copy.contextPanelAria}
    title={copy.contextPanelAria}
    onkeydown={onTriggerKeydown}
  >
    <svg class="composer-context-ring" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <circle class="composer-context-ring-track" cx="10" cy="10" r={RING_RADIUS}></circle>
      {#if ringFrac > 0}
        <circle
          class="composer-context-ring-fill"
          cx="10" cy="10" r={RING_RADIUS}
          stroke-dasharray={`${ringFrac * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 10 10)"
        ></circle>
      {/if}
    </svg>
  </summary>

  {#if open}
    <div
      class="composer-model-popover composer-context-popover"
      role="dialog"
      tabindex="-1"
      aria-label={copy.contextPanelAria}
      onkeydown={onMenuKeydown}
    >
      {#if !sessionUsage && !usage}
        <header class="composer-context-head" tabindex="-1">
          <strong>{copy.sessionUsageTitle}</strong>
        </header>
        <p class="composer-context-empty">{copy.contextPanelEmpty}</p>
      {:else}
        {#if sessionUsage}
          <header class="composer-context-head" tabindex="-1">
            <strong>{copy.sessionUsageTitle}</strong>
            {#if sessionView}
              <span class="composer-context-total" title={exactTokens(sessionView.totalTokens)}>{formatContextTokens(sessionView.totalTokens, locale)}</span>
            {:else}
              <span class="composer-context-total">{copy.sessionUsageUnavailable}</span>
            {/if}
          </header>
          {#if sessionView}
            <ul class="composer-context-rows">
              <li>
                <span class="composer-context-label">{copy.sessionUsageInput}</span>
                <span class="composer-context-value" title={exactTokens(sessionView.inputTokens)}>{formatContextTokens(sessionView.inputTokens, locale)}</span>
              </li>
              <li>
                <span class="composer-context-label">{copy.sessionUsageOutput}</span>
                <span class="composer-context-value" title={exactTokens(sessionView.outputTokens)}>{formatContextTokens(sessionView.outputTokens, locale)}</span>
              </li>
              <li>
                <span class="composer-context-label">{copy.sessionUsageCacheRead}</span>
                <span class="composer-context-value" title={exactTokens(sessionView.cacheReadTokens)}>{formatContextTokens(sessionView.cacheReadTokens, locale)}</span>
              </li>
              <li>
                <span class="composer-context-label">{copy.sessionUsageCacheWrite}</span>
                <span class="composer-context-value" title={exactTokens(sessionView.cacheWriteTokens)}>{formatContextTokens(sessionView.cacheWriteTokens, locale)}</span>
              </li>
            </ul>
            <footer class="composer-context-cache">
              <span>{copy.contextCacheHitRate}</span>
              <strong>{sessionView.hitRate === null ? "—" : formatShare(sessionView.hitRate * 100)}</strong>
            </footer>
          {:else}
            <p class="composer-context-empty">{copy.sessionUsageUnavailable}</p>
          {/if}
        {/if}
        {#if usage}
          <div class="composer-context-section">
            <div class="composer-context-head" tabindex="-1">
              <span class="composer-context-section-label">{copy.contextSectionTitle}</span>
              <span class="composer-context-total">{capacityLabel}{hasWindow ? `（${percentLabel}）` : ""}</span>
            </div>
            {#if hasWindow}
              <div
                class="composer-context-bar"
                role="progressbar"
                aria-label={copy.contextPanelTitle}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usage.percent)}
              >
                <div class="composer-context-bar-fill" style={`width: ${Math.max(usage.percent, usage.usedTokens > 0 ? 1.5 : 0)}%`}></div>
              </div>
            {/if}
            {#if usage.categories.length > 0}
              <p class="composer-context-sublabel">{copy.contextBreakdownLabel}</p>
              <ul class="composer-context-rows">
                {#each usage.categories as category (category.key)}
                  <li>
                    <span class="composer-context-dot" aria-hidden="true"></span>
                    <span class="composer-context-label">{categoryLabel(category.key)}</span>
                    <span class="composer-context-value" title={exactTokens(category.tokens)}>{formatShare(category.percent)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</details>
