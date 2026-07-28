<script lang="ts">
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
  export let onResolve: (id: string) => void;

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
    if (disabled || options.length === 0) return;
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

<div class="approval-card" role="alertdialog" aria-label={title}>
  <div class="approval-head">
    <strong class="approval-title">{title}</strong>
    {#if subtitle}<span class="approval-subtitle">{subtitle}</span>{/if}
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
