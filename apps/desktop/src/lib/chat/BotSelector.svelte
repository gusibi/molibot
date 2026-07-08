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
    bots: Array<{ id: string; name: string }>;
    selectedId: string;
    onSelect: (id: string) => void;
    labels: { bot: string; chooseHint: string; lockedHint: string };
  } = $props();

  let selected = $derived(bots.find((bot) => bot.id === selectedId) ?? { id: selectedId, name: selectedId });
</script>

<div class="bot-selector" data-mode={mode}>
  <span class="bot-selector-label">{labels.bot}</span>
  {#if mode === "select"}
    <div class="bot-selector-control">
      <BotAvatar botId={selected.id} name={selected.name} size={22} />
      <select
        aria-label={labels.bot}
        value={selectedId}
        onchange={(event) => onSelect((event.currentTarget as HTMLSelectElement).value)}
      >
        {#each bots as bot (bot.id)}
          <option value={bot.id}>{bot.name}</option>
        {/each}
      </select>
      <span class="bot-selector-hint">{labels.chooseHint}</span>
    </div>
  {:else}
    <div class="bot-selector-control bot-selector-locked">
      <BotAvatar botId={selected.id} name={selected.name} size={22} />
      <span class="bot-selector-name">{selected.name}</span>
      <i class="ph ph-lock-simple" aria-hidden="true" title={labels.lockedHint}></i>
    </div>
  {/if}
</div>

<style>
  .bot-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--fill, rgba(0, 0, 0, 0.03));
    font-size: 12px;
  }
  .bot-selector-label {
    font-weight: 600;
    opacity: 0.7;
    flex: 0 0 auto;
  }
  .bot-selector-control {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .bot-selector select {
    border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 12px;
    background: var(--surface, #fff);
    color: inherit;
    max-width: 180px;
  }
  .bot-selector-hint {
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bot-selector-locked {
    opacity: 0.85;
  }
  .bot-selector-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
