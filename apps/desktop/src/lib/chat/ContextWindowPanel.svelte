<script lang="ts">
  import { Popover } from "bits-ui";
  import Gauge from "reicon-svelte/icons/Gauge";
  import type { DesktopConversationActivity, DesktopSessionUsageSummary } from "@molibot/desktop-contract";
  import { loadDesktopExternalTranscript, loadDesktopProjectSession, loadDesktopSession } from "../api";
  import {
    deriveComposerContextUsage,
    deriveSessionUsageView,
    formatContextTokens,
    type ComposerContextUsage
  } from "../presentation";
  import type { Locale, Translation } from "../i18n";
  import {
    buildContextWindowBlocks,
    buildContextRoundUsage,
    buildToolUsageRows,
    estimateContextTextTokens,
    layoutContextWindowBlocks,
    type ContextWindowBlockKey,
    type ContextWindowTone
  } from "./contextWindowView";

  type ContextFilter = "all" | "system" | "tools" | "memory" | "files" | "session";
  type ContentRow = {
    key: string;
    label: string;
    detail: string;
    tokens: number;
    tone: ContextWindowTone;
    running: boolean;
    reportedTokens?: number;
  };

  let {
    copy,
    locale,
    endpoint,
    profileId,
    sessionId,
    projectId = "",
    external = false,
    usage,
    sessionUsage,
    fallbackContextWindow = 0,
    modelLabel = "",
    sending = false,
    streamingText = "",
    streamingThinking = "",
    activities = [],
    messages = []
  }: {
    copy: Translation;
    locale: Locale;
    endpoint: string;
    profileId: string;
    sessionId: string;
    projectId?: string;
    /** External (channel mirror) transcripts load through the read-only endpoint. */
    external?: boolean;
    usage: ComposerContextUsage | null;
    sessionUsage: DesktopSessionUsageSummary | null;
    fallbackContextWindow?: number;
    modelLabel?: string;
    sending?: boolean;
    streamingText?: string;
    streamingThinking?: string;
    activities?: DesktopConversationActivity[];
    messages?: ContextSourceMessage[];
  } = $props();

  /** Minimal transcript row the panel reads; web and external transcripts both satisfy it. */
type ContextSourceMessage = {
  role: string;
  content: string;
  thinking?: string;
  activities?: DesktopConversationActivity[];
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
};

let open = $state(false);
  let filter = $state<ContextFilter>("all");
  let showAll = $state(false);
  let polledUsage = $state<ComposerContextUsage | null>(null);
  let polledSessionUsage = $state<DesktopSessionUsageSummary | null>(null);
  let polledMessages = $state<ContextSourceMessage[]>([]);
  let pollError = $state("");
  let pollGeneration = 0;

  const sourceKey = $derived(`${endpoint}:${profileId}:${sessionId}:${projectId}`);
  let polledSourceKey = $state("");
  const currentUsage = $derived(polledSourceKey === sourceKey ? polledUsage ?? usage : usage);
  const currentSessionUsage = $derived(polledSourceKey === sourceKey ? polledSessionUsage ?? sessionUsage : sessionUsage);
  const currentMessages = $derived(polledSourceKey === sourceKey && polledMessages.length > 0 ? polledMessages : messages);
  const sessionView = $derived(deriveSessionUsageView(currentSessionUsage));
  const liveTokens = $derived(
    estimateContextTextTokens(streamingText) + estimateContextTextTokens(streamingThinking)
  );
  const toolActivities = $derived(
    sending
      ? activities
      : currentMessages.flatMap((message) => message.activities ?? [])
  );
  const toolRows = $derived(buildToolUsageRows(toolActivities));
  const roundUsage = $derived(buildContextRoundUsage(currentMessages, sending ? activities : []));
  const contextBlocks = $derived(buildContextWindowBlocks(currentUsage, liveTokens, roundUsage));
  const mapRects = $derived(layoutContextWindowBlocks(contextBlocks));
  const remainingBlock = $derived(contextBlocks.find((block) => block.key === "remaining") ?? null);
  const hasWindow = $derived((currentUsage?.contextWindow ?? 0) > 0);
  const usedTokens = $derived(contextBlocks.filter(block => block.key !== "remaining").reduce((sum, block) => sum + block.tokens, 0));
  const usedPercent = $derived(currentUsage && hasWindow ? usedTokens / currentUsage.contextWindow * 100 : 0);
  const health = $derived(!currentUsage || !hasWindow ? "unknown" : usedPercent < 75 ? "healthy" : usedPercent < 90 ? "near" : "high");
  const counted = $derived(currentUsage?.counted ?? false);
  const filters = $derived<Array<{ key: ContextFilter; label: string }>>([
    { key: "all", label: copy.contextFilterAll },
    { key: "system", label: copy.contextCategorySystemPrompt },
    { key: "tools", label: copy.contextCategoryTools },
    { key: "memory", label: copy.contextCategoryMemory },
    { key: "files", label: copy.contextCategoryFiles },
    { key: "session", label: copy.contextCategoryMessages }
  ]);

  const blockLabel = $derived<Record<ContextWindowTone, string>>({
    systemPrompt: copy.contextCategorySystemPrompt,
    tools: copy.contextToolsLabel,
    toolResults: copy.contextToolResultsLabel,
    memory: copy.contextCategoryMemory,
    files: copy.contextCategoryFiles,
    skills: copy.contextCategorySkills,
    messages: copy.contextCategoryMessages,
    live: copy.contextLiveGenerating,
    reported: copy.contextReportedLabel,
    remaining: copy.contextRemainingLabel
  });

  function contextBlockLabel(key: ContextWindowBlockKey): string {
    const roundMatch = /^round:(\d+)$/.exec(key);
    if (roundMatch) {
      return copy.contextRoundLabel.replace("{number}", roundMatch[1]);
    }
    if (key === "olderRounds") return copy.contextOlderRoundsLabel;
    return blockLabel[key as ContextWindowTone];
  }

  function blockTone(key: ContextWindowBlockKey): ContextWindowTone {
    if (key === "olderRounds" || /^round:\d+$/.test(key)) return "messages";
    return key as ContextWindowTone;
  }

  const contentRows = $derived.by<ContentRow[]>(() => {
    const rows: ContentRow[] = [];
    for (const block of contextBlocks) {
      if (block.key === "remaining" || block.key === "live" || block.key === "toolResults") continue;
      rows.push({
        key: block.key,
        label: contextBlockLabel(block.key),
        detail: block.reportedTokens === undefined
          ? ""
          : block.key === "olderRounds"
            ? copy.contextOlderUsageSummary
                .replace("{retained}", formatContextTokens(block.tokens, locale))
                .replace("{spent}", formatContextTokens(block.reportedTokens, locale))
            : copy.contextRoundUsageSummary
            .replace("{retained}", formatContextTokens(block.tokens, locale))
            .replace("{spent}", formatContextTokens(block.reportedTokens, locale)),
        tokens: block.tokens,
        tone: blockTone(block.key),
        running: false,
        ...(block.reportedTokens === undefined ? {} : { reportedTokens: block.reportedTokens })
      });
    }
    for (const tool of toolRows) {
      rows.push({
        key: `tool:${tool.key}`,
        label: tool.label,
        detail: `×${tool.count}`,
        tokens: tool.tokens,
        tone: "toolResults",
        running: tool.running
      });
    }
    if (sending && liveTokens > 0) {
      rows.push({
        key: "live",
        label: copy.contextLiveGenerating,
        detail: "",
        tokens: liveTokens,
        tone: "live",
        running: true
      });
    }
    return rows;
  });

  const filteredRows = $derived(contentRows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "tools") return row.tone === "tools" || row.tone === "toolResults";
    if (filter === "system") return row.tone === "systemPrompt" || row.tone === "skills";
    if (filter === "memory") return row.tone === "memory";
    if (filter === "files") return row.tone === "files";
    return row.tone === "messages";
  }));
  const visibleRows = $derived(showAll ? filteredRows : filteredRows.slice(0, 8));

  function formatShare(percent: number): string {
    if (!Number.isFinite(percent) || percent <= 0) return "0%";
    if (percent < 0.05) return "<0.1%";
    const value = percent >= 10 ? Math.round(percent) : Number(percent.toFixed(1));
    return `${value}%`;
  }

  function exactTokens(value: number): string {
    return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US").format(value);
  }

  function blockUsageHint(key: string, retainedTokens: number, reportedTokens: number): string {
    return (key === "olderRounds" ? copy.contextOlderUsageHint : copy.contextRoundUsageHint)
      .replace("{retained}", formatContextTokens(retainedTokens, locale))
      .replace("{spent}", formatContextTokens(reportedTokens, locale));
  }

  $effect(() => {
    if (!open || !endpoint || !profileId || !sessionId) return;
    const generation = ++pollGeneration;
    const interval = sending ? 1_000 : 3_000;
    let timer: number | undefined;
    let stopped = false;
    polledUsage = null;
    polledSessionUsage = null;
    polledMessages = [];
    pollError = "";

    const poll = async () => {
      if (stopped || generation !== pollGeneration) return;
      try {
        let detailMessages: ContextSourceMessage[];
        let detailUsage: DesktopSessionUsageSummary | null = null;
        if (projectId) {
          const detail = await loadDesktopProjectSession(endpoint, projectId, sessionId);
          detailMessages = detail.messages;
          detailUsage = detail.usage ?? null;
        } else if (external) {
          // External channel mirrors are read-only and live outside the web
          // index; the transcript endpoint is the only source that resolves them.
          detailMessages = (await loadDesktopExternalTranscript(endpoint, sessionId)).messages;
        } else {
          const detail = await loadDesktopSession(endpoint, profileId, sessionId);
          detailMessages = detail.messages;
          detailUsage = detail.usage ?? null;
        }
        if (stopped || generation !== pollGeneration) return;
        polledSourceKey = sourceKey;
        polledUsage = deriveComposerContextUsage(detailMessages, fallbackContextWindow);
        polledSessionUsage = detailUsage;
        polledMessages = detailMessages;
        pollError = "";
      } catch {
        if (!stopped && generation === pollGeneration) pollError = copy.contextWindowLoadFailed;
      }
      if (!stopped && generation === pollGeneration) timer = window.setTimeout(poll, interval);
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  });
</script>

<Popover.Root bind:open={open}>
  <Popover.Trigger
    class="icon-button"
    aria-label={copy.contextWindowAria}
    title={copy.contextWindowAria}
  >
    <Gauge size={16} aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="context-window-popover" align="end" side="bottom" sideOffset={8}>
      <header class="context-window-header">
        <div>
          <h3>{copy.contextWindowTitle}</h3>
          {#if pollError}<p role="status">{pollError}</p>{/if}
        </div>
        <div class="context-window-identity">
          {#if modelLabel}<span title={modelLabel}>{modelLabel}</span>{/if}
          <em class="context-window-live" data-state={sending ? "live" : counted ? "counted" : "estimate"}>{sending ? copy.contextLiveBadge : counted ? copy.contextCountedBadge : copy.contextEstimatedBadge}</em>
        </div>
      </header>

      {#if currentUsage}
        <div class="context-window-summary">
          <section aria-label={copy.contextUsedLabel}>
            <header>
              <span>{copy.contextUsedLabel}</span>
              <strong data-health={health}>
                {health === "unknown" ? copy.contextHealthUnknown : health === "healthy" ? copy.contextHealthHealthy : health === "near" ? copy.contextHealthNear : copy.contextHealthHigh}
              </strong>
            </header>
            <p>
              <strong title={exactTokens(usedTokens)}>{formatContextTokens(usedTokens, locale)}</strong>
              {#if hasWindow}<span> / {formatContextTokens(currentUsage.contextWindow, locale)} token</span>{/if}
            </p>
            {#if hasWindow}
              <small>{copy.contextUsedShare.replace("{share}", formatShare(Math.min(100, usedPercent)))}{#if remainingBlock} · {copy.contextRemainingLabel} {formatContextTokens(remainingBlock.tokens, locale)} · {formatShare(remainingBlock.percent)}{/if}</small>
            {:else}
              <small>{copy.contextWindowUnknown}</small>
            {/if}
            <small>{copy.contextCurrentWindowHint}</small>
          </section>
          <section aria-label={copy.contextCacheTitle}>
            <header>
              <span>{copy.contextCacheTitle}</span>
              <strong>{sessionView?.hitRate == null ? "—" : formatShare(sessionView.hitRate * 100)}</strong>
            </header>
            <div
              class="context-window-meter"
              role="progressbar"
              aria-label={copy.contextCacheTitle}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={sessionView?.hitRate == null ? undefined : Math.round(sessionView.hitRate * 100)}
            >
              <span style={`width: ${sessionView?.hitRate == null ? 0 : Math.min(100, sessionView.hitRate * 100)}%`}></span>
            </div>
            <small>
              {sessionView ? copy.contextCachedTokens.replace("{tokens}", formatContextTokens(sessionView.cacheReadTokens, locale)) : copy.sessionUsageUnavailable}
              {#if sessionView} · {copy.contextRequestCount.replace("{count}", String(sessionView.requests))}{/if}
            </small>
          </section>
        </div>

        <section class="context-window-map-section" aria-label={copy.contextMapLabel}>
          <div class="context-window-map">
            {#each mapRects as rect (rect.key)}
              <div
                class="context-window-block"
                data-key={rect.key === "olderRounds" ? "olderRounds" : rect.key.startsWith("round:") ? "round" : rect.key}
                style={`left:${rect.x}%; top:${rect.y}%; width:${rect.width}%; height:${rect.height}%;`}
                title={`${contextBlockLabel(rect.key)} · ${counted ? "" : "≈"}${formatContextTokens(rect.tokens, locale)} · ${formatShare(rect.percent)}`}
              >
                {#if rect.width >= 10 && rect.height >= 15}
                  <strong>{contextBlockLabel(rect.key)}</strong>
                  <span>{counted ? "" : "≈"}{formatContextTokens(rect.tokens, locale)} · {formatShare(rect.percent)}</span>
                {:else if rect.width >= 5 && rect.height >= 8}
                  <strong>{contextBlockLabel(rect.key)}</strong>
                {/if}
              </div>
            {/each}
          </div>
          <ul class="context-window-legend">
            {#each contextBlocks as block (block.key)}
              <li data-key={block.key === "olderRounds" ? "olderRounds" : block.key.startsWith("round:") ? "round" : block.key}>
                <i aria-hidden="true"></i>
                {contextBlockLabel(block.key)}
                <span>{counted ? "" : "≈"}{formatContextTokens(block.tokens, locale)}</span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="context-window-content" aria-label={copy.contextContentLabel}>
          <header>
            <h4>{copy.contextContentLabel}</h4>
            <div role="group" aria-label={copy.contextFilterLabel}>
              {#each filters as item (item.key)}
                <button type="button" aria-pressed={filter === item.key} onclick={() => { filter = item.key; showAll = false; }}>
                  {item.label}
                </button>
              {/each}
            </div>
          </header>
          {#if visibleRows.length === 0}
            <p class="context-window-empty">{copy.contextNoMatches}</p>
          {:else}
            <ul>
              {#each visibleRows as row (row.key)}
                <li data-key={row.tone}>
                  <span class="context-window-row-label">
                    {row.label}
                    {#if row.running}<em aria-hidden="true">●</em>{/if}
                  </span>
                  <small>{row.detail}</small>
                  <span
                    class="context-window-row-value"
                    title={row.reportedTokens === undefined
                      ? (counted ? exactTokens(row.tokens) : `≈${exactTokens(row.tokens)}`)
                      : `${exactTokens(row.reportedTokens)} · ${blockUsageHint(row.key, row.tokens, row.reportedTokens)}`}
                  >
                    {#if row.reportedTokens === undefined && !counted}≈{/if}{formatContextTokens(row.reportedTokens ?? row.tokens, locale)}
                  </span>
                </li>
              {/each}
            </ul>
            {#if filteredRows.length > visibleRows.length}
              <button class="context-window-more" type="button" onclick={() => (showAll = true)}>
                {copy.contextShowAll.replace("{count}", String(filteredRows.length))}
              </button>
            {/if}
          {/if}
        </section>
      {:else}
        <div class="context-window-empty-state">
          <Gauge size={28} aria-hidden="true" />
          <p>{copy.contextPanelEmpty}</p>
          {#if pollError}<small role="status">{pollError}</small>{/if}
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
