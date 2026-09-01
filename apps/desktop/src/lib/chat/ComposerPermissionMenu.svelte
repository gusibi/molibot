<script lang="ts">
  import Check from "reicon-svelte/icons/Check";
  import Hand from "reicon-svelte/icons/Hand";
  import Lightning from "reicon-svelte/icons/Lightning";
  import ListCheck from "reicon-svelte/icons/ListCheck";
  import PenLine from "reicon-svelte/icons/PenLine";
  import type { ReiconComponent } from "../components/ui/iconTypes";
  import { onMount, tick } from "svelte";
  import type { Translation } from "../i18n";

  type PermissionModeOption = "plan" | "manual" | "accept_edits" | "auto";

  const MODE_ICONS: Record<PermissionModeOption, ReiconComponent> = {
    plan: ListCheck,
    manual: Hand,
    accept_edits: PenLine,
    auto: Lightning
  };

  export let copy: Translation;
  export let value: PermissionModeOption = "accept_edits";
  export let options: readonly PermissionModeOption[] = [];
  export let disabled = false;
  export let onChange: (value: PermissionModeOption) => void;

  let root: HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = false;

  $: label = modeLabel(value);
  $: TriggerIcon = modeIcon(value);

  function modeLabel(mode: PermissionModeOption): string {
    return {
      plan: copy.permissionModePlan,
      manual: copy.permissionModeManual,
      accept_edits: copy.permissionModeAcceptEdits,
      auto: copy.permissionModeAuto
    }[mode];
  }

  function modeHint(mode: PermissionModeOption): string {
    return {
      plan: copy.permissionModePlanHint,
      manual: copy.permissionModeManualHint,
      accept_edits: copy.permissionModeAcceptEditsHint,
      auto: copy.permissionModeAutoHint
    }[mode];
  }

  function modeIcon(mode: PermissionModeOption): ReiconComponent {
    return MODE_ICONS[mode];
  }

  function close(restoreFocus = false): void {
    open = false;
    root.open = false;
    if (restoreFocus) trigger.focus();
  }

  function selectMode(mode: PermissionModeOption): void {
    if (mode !== value) onChange(mode);
    close(true);
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') ?? []);
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
      close(true);
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

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (open && !root.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  });
</script>

<details class="composer-permission-menu" bind:this={root} ontoggle={(event) => (open = event.currentTarget.open)}>
  <summary
    bind:this={trigger}
    class="composer-permission-trigger"
    aria-label={`${copy.permissionMode}: ${label}`}
    title={`${copy.permissionMode}: ${label}`}
    aria-disabled={disabled}
    onkeydown={onTriggerKeydown}
    onclick={(event) => disabled && event.preventDefault()}
  >
    <TriggerIcon size={14} aria-hidden="true" />
    <span>{label}</span>
  </summary>

  {#if open}
    <div class="composer-model-popover composer-permission-popover" role="menu" tabindex="-1" aria-label={copy.permissionMode} onkeydown={onMenuKeydown}>
      <div class="composer-menu-options">
        {#each options as mode (mode)}
          {@const ModeIcon = modeIcon(mode)}
          <button type="button" role="menuitemradio" aria-checked={mode === value} onclick={() => selectMode(mode)}>
            <ModeIcon size={16} aria-hidden="true" />
            <span class="composer-model-option-copy">
              <span class="composer-model-option-name">{modeLabel(mode)}</span>
              <small class="composer-model-option-id">{modeHint(mode)}</small>
            </span>
            {#if mode === value}<Check class="composer-menu-check" weight="Filled" size={14} aria-hidden="true" />{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</details>
