<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  /**
   * Host Bash approval prompt. Reads as a permission dialog, not a warning
   * banner: one question, the exact command, and a decision row that runs
   * least-privilege → most-privilege from left to right with the safe default
   * (`仅此一次`) pinned to the right where the eye lands last.
   *
   * The server orders `options` the same way (reject first), so the visual
   * order and the number shortcuts stay in sync without the card knowing what
   * any individual option means.
   */
  export let title: string;
  /** What is being run — tool display name, shown under the question. */
  export let subtitle = "";
  export let reasonLabel: string;
  export let command: string;
  export let reason = "";
  export let options: Array<{ id: string; label: string }> = [];
  export let disabled = false;
  export let dangerOptionId = "reject";
  /** Option triggered by ⌘⏎ / Enter. Defaults to the last (safest) option. */
  export let defaultOptionId = "";
  /** `{duration}` template for how long the run has been blocked. Optional. */
  export let waitingLabel = "";
  export let secondsLabel = "{count}s";
  export let minutesLabel = "{count} min";
  export let onResolve: (id: string) => void;

  let cardElement: HTMLElement;
  /**
   * The digit and ⌘⏎ shortcuts are bound to `window`, so they fire wherever the
   * reader happens to be. Gating them on the card actually being on screen is
   * what keeps a decision from being made by someone typing "1" while reading
   * history — and it is what lets a second such card (a Plan proposal) coexist
   * without the two fighting over the same digits.
   */
  let onScreen = false;

  /**
   * How long the run has been blocked. A waiting approval is indistinguishable
   * from a hung service without it — the pitfalls file records this exact
   * confusion — so the card states its own age rather than looking idle.
   */
  const startedAt = Date.now();
  let elapsedMs = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  $: waitingText = !waitingLabel || elapsedMs < 10_000
    ? ""
    : waitingLabel.replace("{duration}", elapsedMs < 60_000
      ? secondsLabel.replace("{count}", String(Math.floor(elapsedMs / 1000)))
      : minutesLabel.replace("{count}", String(Math.floor(elapsedMs / 60_000))));

  onMount(() => {
    timer = setInterval(() => { elapsedMs = Date.now() - startedAt; }, 1_000);
    const observer = new IntersectionObserver(
      (entries) => { onScreen = entries.some((entry) => entry.isIntersecting); },
      { threshold: 0.35 }
    );
    observer.observe(cardElement);
    return () => observer.disconnect();
  });

  onDestroy(() => { if (timer) clearInterval(timer); });

  $: rejectOption = options.find((option) => option.id === dangerOptionId);
  $: allowOptions = options.filter((option) => option.id !== dangerOptionId);
  $: defaultOption = allowOptions.find((option) => option.id === defaultOptionId)
    ?? allowOptions[allowOptions.length - 1];
  // Number hints follow the rendered order: reject is always 1.
  $: shortcutIndex = new Map(
    [...(rejectOption ? [rejectOption] : []), ...allowOptions].map((option, index) => [option.id, index + 1])
  );

  function resolve(id: string | undefined): void {
    if (disabled || !id) return;
    onResolve(id);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (disabled || options.length === 0 || !onScreen) return;
    const target = event.target as HTMLElement | null;
    // Never steal a digit the user is typing into the composer.
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      resolve(defaultOption?.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resolve(rejectOption?.id);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    if (!Number.isInteger(digit) || digit < 1) return;
    for (const [id, index] of shortcutIndex) {
      if (index !== digit) continue;
      event.preventDefault();
      resolve(id);
      return;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="approval-card" role="alertdialog" aria-label={title} bind:this={cardElement}>
  <div class="approval-head">
    <strong class="approval-title">{title}</strong>
    {#if subtitle}<span class="approval-subtitle">{subtitle}</span>{/if}
    {#if waitingText}<span class="approval-waiting"><i class="ph ph-clock" aria-hidden="true"></i>{waitingText}</span>{/if}
  </div>

  <code class="approval-command">{command}</code>

  {#if reason}
    <p class="approval-reason"><span class="approval-reason-label">{reasonLabel}</span>{reason}</p>
  {/if}

  <div class="approval-actions">
    {#if rejectOption}
      <button
        type="button"
        class="approval-action approval-action-deny"
        {disabled}
        onclick={() => resolve(rejectOption.id)}
      >
        {rejectOption.label}
        <span class="approval-key">{shortcutIndex.get(rejectOption.id)}</span>
      </button>
    {/if}
    <div class="approval-allow-group">
      {#each allowOptions as option (option.id)}
        <button
          type="button"
          class="approval-action"
          class:approval-action-default={option.id === defaultOption?.id}
          {disabled}
          onclick={() => resolve(option.id)}
        >
          {option.label}
          <span class="approval-key">{shortcutIndex.get(option.id)}</span>
          {#if option.id === defaultOption?.id}<span class="approval-key">⌘⏎</span>{/if}
        </button>
      {/each}
    </div>
  </div>
</div>
