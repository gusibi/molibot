<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import AngleLeft from "reicon-svelte/icons/AngleLeft";
  import AngleRight from "reicon-svelte/icons/AngleRight";
  import Check from "reicon-svelte/icons/Check";
  import Cpu from "../icons/duotone/components/Cpu.svelte";
  import Lightning from "../icons/duotone/components/Lightning.svelte";
  import { onMount, tick } from "svelte";
  import type { DesktopModelOption, DesktopThinkingLevel } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { groupModelOptions } from "../presentation";

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
  let page: "overview" | "model" = "overview";

  $: modelLabel = activeModelLabel || copy.model;
  $: levelLabel = thinkingLevelLabel || copy.thinkingLevel;
  $: modelGroups = groupModelOptions(modelOptions);
  $: levelIndex = Math.max(0, thinkingLevelOptions.indexOf(thinkingLevel));
  $: levelFrac = thinkingLevelOptions.length > 1 ? levelIndex / (thinkingLevelOptions.length - 1) : 0.5;

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
    if (value !== thinkingLevel) onChangeThinking(value);
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
    <Cpu size={16} aria-hidden="true" />
    <span class="composer-model-label"><span class="composer-model-label-text">{modelLabel}</span></span>
    <span class="composer-model-level">{levelLabel}</span>
    <AngleDown class="composer-model-caret" weight="Filled" size={14} aria-hidden="true" />
  </summary>

  {#if open}
    <div class="composer-model-popover" role="menu" tabindex="-1" aria-label={copy.model} onkeydown={onMenuKeydown}>
      {#if page === "overview"}
        <button type="button" role="menuitem" disabled={changingModel || modelOptions.length === 0} onclick={() => showPage("model", true)}>
          <span class="composer-menu-copy"><strong>{copy.model}</strong><small title={activeModelTitle || modelLabel}>{modelLabel}</small></span>
          <AngleRight size={14} aria-hidden="true" />
        </button>
        {#if thinkingLevelOptions.length > 1}
          <div class="composer-level-picker" role="group" aria-label={copy.thinkingLevel}>
            <div class="composer-level-head">
              <span>{copy.thinkingLevel}</span>
              <strong><Lightning size={14} aria-hidden="true" />{levelLabel}</strong>
            </div>
            <div class="composer-level-track">
              <div class="composer-level-knob" style={`left: calc(11px + (100% - 22px) * ${levelFrac})`} aria-hidden="true"></div>
              {#each thinkingLevelOptions as level, i (level)}
                <button
                  type="button"
                  class="composer-level-stop"
                  role="menuitemradio"
                  aria-checked={level === thinkingLevel}
                  aria-label={thinkingOptionLabel(level)}
                  title={thinkingOptionLabel(level)}
                  style={`left: calc(11px + (100% - 22px) * ${thinkingLevelOptions.length > 1 ? i / (thinkingLevelOptions.length - 1) : 0.5})`}
                  onkeydown={(event) => {
                    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                    if (!delta) return;
                    event.preventDefault();
                    const next = Math.max(0, Math.min(thinkingLevelOptions.length - 1, i + delta));
                    selectThinking(thinkingLevelOptions[next]);
                    const track = event.currentTarget.parentElement;
                    track?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
                  }}
                  onclick={() => selectThinking(level)}
                ></button>
              {/each}
            </div>
            <div class="composer-level-endpoints" aria-hidden="true">
              <span>{thinkingOptionLabel(thinkingLevelOptions[0])}</span>
              <span>{thinkingOptionLabel(thinkingLevelOptions[thinkingLevelOptions.length - 1])}</span>
            </div>
          </div>
        {/if}
      {:else}
        <div class="composer-menu-heading">
          <button type="button" class="composer-menu-back" aria-label={copy.cancelAction} onclick={() => showPage("overview", true)}><AngleLeft size={14} aria-hidden="true" /></button>
          <strong>{copy.model}</strong>
        </div>
        <div class="composer-menu-options">
          {#each modelGroups as group (group.provider)}
            <div class="composer-model-option-group" role="group" aria-label={group.provider}>
              <div class="composer-model-option-provider">{group.provider}</div>
              {#each group.options as item (item.option.key)}
                <button type="button" role="menuitemradio" aria-checked={item.option.key === activeModelKey} title={item.option.label} onclick={() => selectModel(item.option.key)}>
                  <span class="composer-model-option-name">{item.name}</span>
                  {#if item.option.key === activeModelKey}<Check class="composer-menu-check" weight="Filled" size={14} aria-hidden="true" />{/if}
                </button>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</details>
