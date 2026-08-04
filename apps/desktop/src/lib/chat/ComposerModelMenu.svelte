<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { DesktopModelOption, DesktopThinkingLevel } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { modelOptionCopy } from "../presentation";

  export let copy: Translation;
  export let modelOptions: DesktopModelOption[] = [];
  export let activeModelKey = "";
  export let activeModelLabel = "";
  export let activeModelTitle = "";
  export let changingModel = false;
  export let thinkingLevel: DesktopThinkingLevel;
  export let thinkingLevelOptions: readonly DesktopThinkingLevel[] = [];
  export let thinkingLevelLabel = "";
  export let disabled = false;
  export let onChangeModel: (value: string) => void;
  export let onChangeThinking: (value: DesktopThinkingLevel) => void;

  let root: HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = false;
  let page: "overview" | "model" | "thinking" = "overview";

  $: modelLabel = activeModelLabel || copy.model;
  $: levelLabel = thinkingLevelLabel || copy.thinkingLevel;

  function thinkingOptionLabel(level: DesktopThinkingLevel): string {
    return {
      off: copy.thinkingOff,
      minimal: copy.thinkingMinimal,
      low: copy.thinkingLow,
      medium: copy.thinkingMedium,
      high: copy.thinkingHigh,
      xhigh: copy.thinkingXHigh,
      max: copy.thinkingMax
    }[level];
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') ?? []);
  }

  async function showPage(next: typeof page, focus = false): Promise<void> {
    page = next;
    if (focus) {
      await tick();
      buttons()[0]?.focus();
    }
  }

  function close(restoreFocus = false): void {
    open = false;
    root.open = false;
    page = "overview";
    if (restoreFocus) trigger.focus();
  }

  async function onTriggerKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open = true;
    root.open = true;
    await tick();
    const available = buttons();
    available[event.key === "ArrowUp" ? available.length - 1 : 0]?.focus();
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (page === "overview") close(true);
      else void showPage("overview", true);
      return;
    }
    if (event.key === "ArrowLeft" && page !== "overview") {
      event.preventDefault();
      void showPage("overview", true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const available = buttons();
    const current = available.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    available[(current + delta + available.length) % available.length]?.focus();
  }

  function selectModel(value: string): void {
    if (value === activeModelKey) return close(true);
    onChangeModel(value);
    close(true);
  }

  function selectThinking(value: DesktopThinkingLevel): void {
    if (value === thinkingLevel) return close(true);
    onChangeThinking(value);
    close(true);
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (open && !root.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  });
</script>

<details class="composer-model-menu" bind:this={root} ontoggle={(event) => {
  open = event.currentTarget.open;
  if (!open) page = "overview";
}}>
  <summary
    bind:this={trigger}
    class="composer-model-trigger"
    aria-label={`${copy.model}: ${modelLabel}, ${copy.thinkingLevel}: ${levelLabel}`}
    title={activeModelTitle || modelLabel}
    aria-disabled={disabled}
    onkeydown={onTriggerKeydown}
    onclick={(event) => disabled && event.preventDefault()}
  >
    <i class="ph ph-cpu" aria-hidden="true"></i>
    <span class="composer-model-label"><span class="composer-model-label-text">{modelLabel}</span></span>
    <span class="composer-model-level">{levelLabel}</span>
    <i class="ph-bold ph-caret-down" aria-hidden="true"></i>
  </summary>

  {#if open}
    <div class="composer-model-popover" role="menu" tabindex="-1" aria-label={copy.model} onkeydown={onMenuKeydown}>
      {#if page === "overview"}
        <button type="button" role="menuitem" disabled={changingModel || modelOptions.length === 0} onclick={() => showPage("model", true)}>
          <span class="composer-menu-copy"><strong>{copy.model}</strong><small title={activeModelTitle || modelLabel}>{modelLabel}</small></span>
          <i class="ph ph-caret-right" aria-hidden="true"></i>
        </button>
        <button type="button" role="menuitem" disabled={thinkingLevelOptions.length <= 1} onclick={() => showPage("thinking", true)}>
          <span class="composer-menu-copy"><strong>{copy.thinkingLevel}</strong><small>{levelLabel}</small></span>
          <i class="ph ph-caret-right" aria-hidden="true"></i>
        </button>
      {:else}
        <div class="composer-menu-heading">
          <button type="button" class="composer-menu-back" aria-label={copy.cancelAction} onclick={() => showPage("overview", true)}><i class="ph ph-caret-left" aria-hidden="true"></i></button>
          <strong>{page === "model" ? copy.model : copy.thinkingLevel}</strong>
        </div>
        <div class="composer-menu-options">
          {#if page === "model"}
            {#each modelOptions as model (model.key)}
              {@const option = modelOptionCopy(model)}
              <button type="button" role="menuitemradio" aria-checked={model.key === activeModelKey} onclick={() => selectModel(model.key)}>
                <span class="composer-model-option-copy" title={model.label}>
                  <span class="composer-model-option-name">{option.name}</span>
                  {#if option.detail}<small class="composer-model-option-id">{option.detail}</small>{/if}
                </span>
                {#if model.key === activeModelKey}<i class="ph-bold ph-check" aria-hidden="true"></i>{/if}
              </button>
            {/each}
          {:else}
            {#each thinkingLevelOptions as level (level)}
              <button type="button" role="menuitemradio" aria-checked={level === thinkingLevel} onclick={() => selectThinking(level)}>
                <span>{thinkingOptionLabel(level)}</span>
                {#if level === thinkingLevel}<i class="ph-bold ph-check" aria-hidden="true"></i>{/if}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</details>
