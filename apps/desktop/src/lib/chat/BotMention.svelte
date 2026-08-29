<script lang="ts">
  import BotAvatar from "./BotAvatar.svelte";

  let {
    mode,
    bots,
    selectedId,
    onSelect,
    labels
  }: {
    mode: "select" | "locked";
    bots: Array<{ id: string; name: string; subtitle?: string }>;
    selectedId: string;
    onSelect: (id: string) => void;
    labels: { chooseHint: string; lockedHint: string };
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();

  let selected = $derived(
    bots.find((bot) => bot.id === selectedId) ?? { id: selectedId, name: selectedId }
  );
  let selectedIndex = $derived(Math.max(0, bots.findIndex((bot) => bot.id === selected.id)));
  // A single bot is unambiguous — there is nothing to pick, so only its compact
  // initial remains. The full identity is available to assistive technology.
  let multiple = $derived(bots.length > 1);

  function toggle() {
    if (mode === "select") open = !open;
  }
  function pick(id: string) {
    onSelect(id);
    open = false;
  }

  // Dismiss the popover on outside click / Escape while it is open.
  $effect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") open = false;
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="bot-mention" bind:this={root} data-mode={mode}>
  {#if mode === "select" && multiple}
    <button
      type="button"
      class="mention-token"
      class:active={open}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={`${labels.chooseHint}: ${selected.name}`}
      title={labels.chooseHint}
      onclick={toggle}
    >
      <BotAvatar botId={selected.id} name={selected.name} size={20} colorIndex={selectedIndex} />
    </button>

    {#if open}
      <div class="mention-menu" role="listbox" aria-label={labels.chooseHint}>
        {#each bots as bot, index (bot.id)}
          <button
            type="button"
            role="option"
            class="mention-option"
            class:selected={bot.id === selectedId}
            aria-selected={bot.id === selectedId}
            onclick={() => pick(bot.id)}
          >
            <BotAvatar botId={bot.id} name={bot.name} size={24} colorIndex={index} />
            <span class="mention-option-text">
              <span class="mention-option-name">{bot.name}</span>
              {#if bot.subtitle}<span class="mention-option-sub">{bot.subtitle}</span>{/if}
            </span>
            {#if bot.id === selectedId}
              <i class="ph-bold ph-check mention-check" aria-hidden="true"></i>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {:else if mode === "select"}
    <span class="mention-token static" role="img" aria-label={selected.name} title={selected.name}>
      <BotAvatar botId={selected.id} name={selected.name} size={20} colorIndex={selectedIndex} />
    </span>
  {:else}
    <span class="mention-token locked" role="img" aria-label={`${selected.name}: ${labels.lockedHint}`} title={`${selected.name} · ${labels.lockedHint}`}>
      <BotAvatar botId={selected.id} name={selected.name} size={20} readOnly colorIndex={selectedIndex} />
    </span>
  {/if}
</div>

<style>
  .bot-mention {
    position: relative;
    max-width: 100%;
  }

  /* Lives in the composer's bottom tool row now, so it stays as quiet as the
     neighbouring icon buttons: no resting background, hover reveals one. */
  .mention-token {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--rounded-full);
    background: transparent;
    color: var(--label-secondary);
    font-size: var(--fs-label);
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  }
  .mention-token:hover,
  .mention-token.active {
    background: var(--fill);
    color: var(--label-primary);
  }
  .mention-token.static,
  .mention-token.locked {
    background: transparent;
    cursor: default;
  }
  .mention-token.locked:hover {
    background: transparent;
    color: var(--label-secondary);
  }
  .mention-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 230px;
    max-width: 300px;
    max-height: 288px;
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--control-border);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
    box-shadow: var(--popover-shadow);
    transform-origin: bottom left;
    animation: mention-pop 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes mention-pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  .mention-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--rounded-sm);
    background: transparent;
    color: var(--label-primary);
    font-size: var(--fs-label);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-standard);
  }
  .mention-option:hover {
    background: var(--fill);
  }
  .mention-option.selected {
    background: var(--accent-soft);
  }
  .mention-option-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .mention-option-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mention-option-sub {
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    color: var(--label-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mention-check {
    flex: none;
    font-size: var(--icon-sm);
    color: var(--accent);
  }
</style>
