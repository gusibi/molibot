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

  function focusTrackStop(track: HTMLElement, index: number): void {
    track.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
  }

  /** Nearest stop index for a pointer position, using the same 11px inset as the stop/knob layout. */
  function levelIndexFromClientX(track: HTMLElement, clientX: number): number {
    const rect = track.getBoundingClientRect();
    const span = rect.width - 22;
    if (span <= 0) return Math.floor(thinkingLevelOptions.length / 2);
    const frac = Math.min(Math.max(clientX - rect.left - 11, 0), span) / span;
    return Math.round(frac * (thinkingLevelOptions.length - 1));
  }

  /**
   * Direct (non-delegated) listeners for the whole popover. Svelte 5 routes
   * `onclick` through the app-root delegation table, which silently dies when a
   * long-lived dev webview survives broken HMR updates — the thinking stops then
   * stop responding while `toggle` (attached directly) keeps working. Direct
   * listeners keep this menu's interactions alive through that class of state
   * corruption, and give the level track its drag behaviour.
   */
  function popoverInteraction(popover: HTMLElement) {
    let draggingLevel = false;
    let dragTrack: HTMLElement | null = null;

    const onPopoverClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-menu-action]");
      if (!target || !popover.contains(target)) return;
      if ((target as HTMLButtonElement).disabled) return;
      switch (target.dataset.menuAction) {
        case "open-model":
          void showPage("model", true);
          break;
        case "back":
          void showPage("overview", true);
          break;
        case "select-model":
          selectModel(target.dataset.value ?? "");
          break;
      }
    };

    const onPopoverKeydown = (event: KeyboardEvent) => {
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
    };

    const selectLevelAt = (clientX: number): void => {
      const index = levelIndexFromClientX(popover.querySelector<HTMLElement>(".composer-level-track") ?? popover, clientX);
      const level = thinkingLevelOptions[Math.min(Math.max(index, 0), thinkingLevelOptions.length - 1)];
      if (level) selectThinking(level);
    };

    const onTrackPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const track = (event.target as HTMLElement | null)?.closest<HTMLElement>(".composer-level-track");
      if (!track || !popover.contains(track)) return;
      event.preventDefault();
      draggingLevel = true;
      dragTrack = track;
      try {
        track.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; selection already happened.
      }
      selectLevelAt(event.clientX);
    };

    const onTrackPointerMove = (event: PointerEvent) => {
      if (!draggingLevel) return;
      selectLevelAt(event.clientX);
    };

    const onTrackPointerEnd = (event: PointerEvent) => {
      if (!draggingLevel) return;
      draggingLevel = false;
      if (dragTrack?.hasPointerCapture(event.pointerId)) dragTrack.releasePointerCapture(event.pointerId);
      dragTrack = null;
    };

    const onTrackKeydown = (event: KeyboardEvent) => {
      const stop = event.target as HTMLElement;
      if (!stop.classList?.contains("composer-level-stop")) return;
      const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      const current = Number(stop.dataset.levelIndex ?? "0");
      const next = Math.max(0, Math.min(thinkingLevelOptions.length - 1, current + delta));
      selectThinking(thinkingLevelOptions[next]);
      focusTrackStop(popover.querySelector<HTMLElement>(".composer-level-track") ?? popover, next);
    };

    popover.addEventListener("click", onPopoverClick);
    popover.addEventListener("keydown", onPopoverKeydown);
    popover.addEventListener("pointerdown", onTrackPointerDown);
    popover.addEventListener("pointermove", onTrackPointerMove);
    popover.addEventListener("pointerup", onTrackPointerEnd);
    popover.addEventListener("pointercancel", onTrackPointerEnd);
    popover.addEventListener("keydown", onTrackKeydown);
    return {
      destroy() {
        popover.removeEventListener("click", onPopoverClick);
        popover.removeEventListener("keydown", onPopoverKeydown);
        popover.removeEventListener("pointerdown", onTrackPointerDown);
        popover.removeEventListener("pointermove", onTrackPointerMove);
        popover.removeEventListener("pointerup", onTrackPointerEnd);
        popover.removeEventListener("pointercancel", onTrackPointerEnd);
        popover.removeEventListener("keydown", onTrackKeydown);
      }
    };
  }

  /** Direct listeners for the trigger as well: the disabled guard and the
   * arrow-key open must not depend on the delegation table either. */
  function triggerInteraction(node: HTMLElement) {
    const onClick = (event: MouseEvent) => {
      if (disabled) event.preventDefault();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") void onTriggerKeydown(event);
    };
    node.addEventListener("click", onClick);
    node.addEventListener("keydown", onKeydown);
    return {
      destroy() {
        node.removeEventListener("click", onClick);
        node.removeEventListener("keydown", onKeydown);
      }
    };
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
    // Escape lives on the document: with the menu opened by mouse, focus stays
    // on the summary and the keydown never passes through the popover.
    const handleKeydown = (event: KeyboardEvent) => {
      if (!open || event.key !== "Escape") return;
      event.preventDefault();
      if (page === "overview") close(true);
      else void showPage("overview", true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeydown);
    };
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
    use:triggerInteraction
  >
    <Cpu size={16} aria-hidden="true" />
    <span class="composer-model-label"><span class="composer-model-label-text">{modelLabel}</span></span>
    <span class="composer-model-level">{levelLabel}</span>
    <AngleDown class="composer-model-caret" weight="Filled" size={14} aria-hidden="true" />
  </summary>

  {#if open}
    <div class="composer-model-popover" role="menu" tabindex="-1" aria-label={copy.model} use:popoverInteraction>
      {#if page === "overview"}
        <button type="button" role="menuitem" disabled={changingModel || modelOptions.length === 0} data-menu-action="open-model">
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
              <div class="composer-level-fill" style={`width: ${levelIndex > 0 ? `calc(11px + (100% - 22px) * ${levelFrac})` : "0px"}`} aria-hidden="true"></div>
              <div class="composer-level-knob" style={`left: calc(11px + (100% - 22px) * ${levelFrac})`} aria-hidden="true"></div>
              {#each thinkingLevelOptions as level, i (level)}
                <button
                  type="button"
                  class="composer-level-stop"
                  role="menuitemradio"
                  aria-checked={level === thinkingLevel}
                  aria-label={thinkingOptionLabel(level)}
                  title={thinkingOptionLabel(level)}
                  data-level-index={i}
                  data-filled={i < levelIndex}
                  style={`left: calc(11px + (100% - 22px) * ${thinkingLevelOptions.length > 1 ? i / (thinkingLevelOptions.length - 1) : 0.5})`}
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
          <button type="button" class="composer-menu-back" aria-label={copy.cancelAction} data-menu-action="back"><AngleLeft size={14} aria-hidden="true" /></button>
          <strong>{copy.model}</strong>
        </div>
        <div class="composer-menu-options">
          {#each modelGroups as group (group.provider)}
            <div class="composer-model-option-group" role="group" aria-label={group.provider}>
              <div class="composer-model-option-provider">{group.provider}</div>
              {#each group.options as item (item.option.key)}
                <button type="button" role="menuitemradio" aria-checked={item.option.key === activeModelKey} title={item.option.label} data-menu-action="select-model" data-value={item.option.key}>
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
