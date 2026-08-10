<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ownsDecisionShortcuts, registerDecisionCard } from "./decisionShortcuts";

  export let id: string;
  export let title: string;
  export let subtitle = "";
  export let options: Array<{ id: string; label: string }> = [];
  export let disabled = false;
  export let dangerOptionId = "reject";
  export let defaultOptionId = "";
  export let waitingLabel = "";
  export let secondsLabel = "{count}s";
  export let minutesLabel = "{count} min";
  export let onResolve: (id: string) => void;

  let cardElement: HTMLElement;
  const startedAt = Date.now();
  let elapsedMs = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unregister: (() => void) | undefined;

  $: waitingText = !waitingLabel || elapsedMs < 10_000
    ? ""
    : waitingLabel.replace("{duration}", elapsedMs < 60_000
      ? secondsLabel.replace("{count}", String(Math.floor(elapsedMs / 1000)))
      : minutesLabel.replace("{count}", String(Math.floor(elapsedMs / 60_000))));
  $: rejectOption = options.find((option) => option.id === dangerOptionId);
  $: allowOptions = options.filter((option) => option.id !== dangerOptionId);
  $: defaultOption = allowOptions.find((option) => option.id === defaultOptionId) ?? allowOptions.at(-1);
  $: shortcutIndex = new Map(
    [...(rejectOption ? [rejectOption] : []), ...allowOptions].map((option, index) => [option.id, index + 1])
  );

  onMount(() => {
    timer = setInterval(() => { elapsedMs = Date.now() - startedAt; }, 1_000);
    unregister = registerDecisionCard(id, { element: cardElement, enabled: () => !disabled });
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    unregister?.();
  });

  function resolve(optionId: string | undefined): void {
    if (!disabled && optionId) onResolve(optionId);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (disabled || options.length === 0 || !ownsDecisionShortcuts(id)) return;
    const target = event.target as HTMLElement | null;
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
    const match = [...shortcutIndex].find(([, index]) => index === digit);
    if (match) {
      event.preventDefault();
      resolve(match[0]);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="approval-card decision-card" role="alertdialog" aria-label={title} bind:this={cardElement}>
  <div class="approval-head">
    <strong class="approval-title">{title}</strong>
    {#if subtitle}<span class="approval-subtitle">{subtitle}</span>{/if}
    {#if waitingText}<span class="approval-waiting"><i class="ph ph-clock" aria-hidden="true"></i>{waitingText}</span>{/if}
  </div>

  <slot />

  <div class="approval-actions">
    {#if rejectOption}
      <button type="button" class="approval-action approval-action-deny" {disabled} onclick={() => resolve(rejectOption.id)}>
        {rejectOption.label}<span class="approval-key">{shortcutIndex.get(rejectOption.id)}</span>
      </button>
    {/if}
    <div class="approval-allow-group">
      {#each allowOptions as option (option.id)}
        <button type="button" class="approval-action" class:approval-action-default={option.id === defaultOption?.id} {disabled} onclick={() => resolve(option.id)}>
          {option.label}<span class="approval-key">{shortcutIndex.get(option.id)}</span>
          {#if option.id === defaultOption?.id}<span class="approval-key">⌘⏎</span>{/if}
        </button>
      {/each}
    </div>
  </div>
</div>
