<script lang="ts">
  import { tick } from "svelte";
  import Notebook from "../icons/duotone/components/Notebook.svelte";
  import Check from "reicon-svelte/icons/Check";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import Button from "../components/ui/Button.svelte";
  import { runDesktopMemoryAction } from "../api";
  import type { DesktopHomeMemoryReview, DesktopMemoryComparison } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  let { review, endpoint, stale, copy, locale = "en", formatTime, onChanged, onOpenMemory }: {
    locale?: string;
    review: DesktopHomeMemoryReview;
    endpoint: string;
    stale: boolean;
    copy: Translation;
    formatTime: (value: string) => string;
    onChanged: () => Promise<void>;
    onOpenMemory: () => void;
  } = $props();

  let comparison = $state<DesktopMemoryComparison | null>(null);
  let comparisonLoading = $state(false);
  let comparisonError = $state(false);
  let comparisonRevision = $state(0);
  $effect(() => {
    const item = candidate, target = endpoint;
    comparisonRevision;
    comparison = null; comparisonError = false; comparisonLoading = false;
    if (!item || !target || stale || (!item.supersedesMemoryId && !item.disputesMemoryId)) return;
    let disposed = false;
    comparisonLoading = true;
    void runDesktopMemoryAction(target, { action: "compare-candidate", id: item.id, expectedUpdatedAt: item.updatedAt }).then(response => {
      if (disposed) return;
      if (response.comparison?.candidateId !== item.id || response.comparison.candidateUpdatedAt !== item.updatedAt) throw new Error("Candidate changed");
      comparison = response.comparison;
    }).catch(() => { if (!disposed) comparisonError = true; }).finally(() => { if (!disposed) comparisonLoading = false; });
    return () => { disposed = true; };
  });
  let index = $state(0);
  let editingId = $state("");
  let editingVersion = $state("");
  let draft = $state("");
  let busy = $state(false);
  let error = $state("");
  let feedback = $state("");
  let source = $state<{ id: string; endpoint: string; text: string; error: boolean } | null>(null);
  let sourceLoading = $state("");
  let region: HTMLElement;
  const currentIndex = $derived(Math.min(index, Math.max(0, review.items.length - 1)));
  const candidate = $derived(review.items[currentIndex]);
  const disabled = $derived(stale || !endpoint || busy || review.unavailable);
  const reference = $derived(candidate?.sources[0]);
  let previousEndpoint = "";
  $effect(() => {
    if (endpoint === previousEndpoint) return;
    previousEndpoint = endpoint;
    index = 0;
    editingId = "";
    source = null;
    sourceLoading = "";
    error = "";
    feedback = "";
  });


  async function showSource(): Promise<void> {
    if (!candidate || !reference || stale) return;
    const id = candidate.id;
    const target = endpoint;
    const key = `${target}:${id}`;
    if (sourceLoading === key) return;
    sourceLoading = key;
    try {
      const response = await runDesktopMemoryAction(target, { action: "source", sessionId: reference.sessionId, messageId: reference.conversationMessageId });
      if (candidate?.id !== id || endpoint !== target) return;
      const selected = response.sourceMessages?.find(item => item.selected);
      source = { id, endpoint: target, text: selected?.content ?? copy.homeMemorySourceUnavailable, error: !selected };
    } catch {
      if (candidate?.id === id && endpoint === target) source = { id, endpoint: target, text: copy.homeMemorySourceUnavailable, error: true };
    } finally {
      if (sourceLoading === key) sourceLoading = "";
    }
  }

  async function resolve(decision: "confirm" | "ignore"): Promise<void> {
    if (!candidate || disabled) return;
    if (decision === "confirm" && editingId === candidate.id && !draft.trim()) {
      error = copy.homeMemoryEmpty;
      return;
    }
    const item = candidate;
    const target = endpoint;
    busy = true;
    error = "";
    feedback = "";
    try {
      const response = await runDesktopMemoryAction(target, {
        action: decision === "confirm" ? "confirm-candidate" : "ignore-candidate",
        id: item.id,
        expectedUpdatedAt: editingId === item.id ? editingVersion : item.updatedAt,
        ...(decision === "confirm" && editingId === item.id ? { content: draft.trim() } : {})
      });
      if (target !== endpoint) return;
      const saved = response.candidate;
      const succeeded = decision === "ignore"
        ? saved?.status === "ignored"
        : (saved?.status === "confirmed" || saved?.status === "edited-then-confirmed") && Boolean(saved.confirmedMemoryId);
      if (!succeeded) throw new Error(copy.homeMemoryChanged);
      feedback = decision === "confirm" ? copy.memoryCandidateConfirmed : copy.homeMemoryIgnored;
      editingId = "";
      await onChanged();
      await tick();
      region?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } catch (cause) {
      if (target !== endpoint) return;
      error = cause instanceof Error ? cause.message : copy.homeMemoryChanged;
      await onChanged();
    } finally {
      busy = false;
    }
  }

  function move(offset: number): void {
    index = currentIndex + offset;
    editingId = "";
    error = "";
    source = null;
  }
</script>

<section class="agent-home-memory" aria-label={copy.homeMemoryHeading} bind:this={region}>
  <div class="agent-home-memory-head">
    <h2><Notebook size={17} aria-hidden="true" />{copy.homeMemoryHeading}</h2>
    {#if candidate}<span class="agent-home-meta">{currentIndex + 1} / {review.items.length}{review.hasMore ? "+" : ""}</span>{/if}
  </div>
  {#if review.unavailable}
    <p class="agent-home-memory-empty" role="alert">{copy.homeMemoryUnavailable}</p>
    <Button variant="text" disabled={busy || stale} onclick={() => void onChanged()}>{copy.retry}</Button>
  {:else if candidate}
    <div class="agent-home-memory-meta"><span>{candidate.domain === "owner" ? copy.homeMemoryPersonal : copy.homeMemoryAgent}</span><time datetime={candidate.createdAt}>{formatTime(candidate.createdAt)}</time></div>
    {#if candidate.supersedesMemoryId || candidate.disputesMemoryId}
      <section class="agent-home-memory-comparison" aria-label={locale === "zh-CN" ? "记忆新旧对照" : "Memory comparison"}>
        {#if comparisonLoading}<p role="status">{locale === "zh-CN" ? "正在读取原记忆…" : "Loading the original memory…"}</p>
        {:else if comparisonError}<p role="alert">{locale === "zh-CN" ? "原记忆读取失败，请重试后再确认。" : "Could not read the original memory. Retry before confirming."}</p><Button variant="text" disabled={stale} onclick={() => comparisonRevision++}>{copy.retry}</Button>
        {:else if comparison}
          {#each comparison.originals as original}
            <div><h3>{locale === "zh-CN" ? (original.relation === "replaces" ? "将被替换的记忆" : "存在分歧的记忆") : (original.relation === "replaces" ? "Memory to replace" : "Disputed memory")}</h3>
              <p>{original.available ? original.content : (locale === "zh-CN" ? "原记忆已删除或不在当前可见范围内，请在记忆中心核对后再确认。" : "The original memory was deleted or is outside the current scope. Review it in the memory center before confirming.")}</p>
            </div>
          {/each}
          <h3>{locale === "zh-CN" ? "本次建议" : "Proposed memory"}</h3>
          <p>{editingId === candidate.id ? draft : candidate.value}</p>
        {/if}
      </section>
    {/if}
    {#if editingId === candidate.id}
      <textarea class="agent-home-memory-edit" aria-label={copy.memoryCandidateEdit} bind:value={draft} disabled={disabled}></textarea>
    {:else if !comparison}
      <p class="agent-home-memory-value">{candidate.value}</p>
    {/if}
    {#if reference}
      {#key candidate.id}
      <details class="agent-home-memory-source" ontoggle={(event) => { if (event.currentTarget.open) void showSource(); }}>
        <summary>{copy.memoryOpenSource}</summary>
        {#if sourceLoading === `${endpoint}:${candidate.id}`}<p>{copy.loading}</p>
        {:else if source?.id === candidate.id && source.endpoint === endpoint}<blockquote class:has-error={source.error}>{source.text}</blockquote>{/if}
      </details>
      {/key}
    {/if}
    <div class="agent-home-card-actions">
      <Button variant="primary" disabled={disabled || Boolean((candidate.supersedesMemoryId || candidate.disputesMemoryId) && (!comparison || comparisonLoading || comparisonError || comparison.originals.some(original => !original.available)))} onclick={() => void resolve("confirm")}><Check size={14} aria-hidden="true" />{editingId === candidate.id ? copy.homeMemorySaveEdit : copy.homeMemoryConfirm}</Button>
      <Button variant="text" disabled={disabled} onclick={() => void resolve("ignore")}>{copy.homeMemoryIgnore}</Button>
      <Button variant="text" disabled={disabled} onclick={() => { draft = candidate.value; editingId = candidate.id; editingVersion = candidate.updatedAt; }}>{copy.homeMemoryEdit}</Button>
    </div>
  {:else}
    <p class="agent-home-memory-empty">{copy.homeMemoryDone}</p>
  {/if}
  {#if error}<p class="agent-home-memory-error" role="alert">{error}</p>{/if}
  {#if feedback}<p class="agent-home-memory-feedback" role="status">{feedback}</p>{/if}
  <div class="agent-home-memory-foot">
    <Button variant="text" onclick={onOpenMemory}>{review.hasMore ? copy.homeMemoryViewMore : copy.homeMemoryCenter}<ArrowRight size={13} aria-hidden="true" /></Button>
    {#if candidate}<div class="agent-home-memory-navigation">
      <Button variant="icon" title={copy.homeMemoryPrevious} disabled={busy || currentIndex === 0} onclick={() => move(-1)}><ArrowLeft size={14} aria-hidden="true" /></Button>
      <Button variant="icon" title={copy.homeMemoryNext} disabled={busy || currentIndex >= review.items.length - 1} onclick={() => move(1)}><ArrowRight size={14} aria-hidden="true" /></Button>
    </div>{/if}
  </div>
</section>

{#if review.skillDraftCount}<div class="agent-home-band"><Button variant="text" onclick={onOpenMemory}>{review.skillDraftCount}{review.skillDraftHasMore ? "+" : ""} · {locale === 'zh-CN' ? '待审核技能草稿' : 'Skill drafts'}</Button></div>{/if}
