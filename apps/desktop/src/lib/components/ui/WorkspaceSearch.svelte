<script lang="ts">
  import { onMount, tick } from "svelte";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import X from "reicon-svelte/icons/X";
  import Button from "./Button.svelte";

  let { value, label, placeholder = "", closeLabel, onInput }: {
    value: string;
    label: string;
    placeholder?: string;
    closeLabel: string;
    onInput: (value: string) => void;
  } = $props();

  let open = $state(false);
  let input = $state<HTMLInputElement>();
  let trigger = $state<HTMLSpanElement>();

  onMount(() => { if (value) void expand(); });

  async function expand(): Promise<void> {
    open = true;
    await tick();
    input?.focus();
  }

  async function close(): Promise<void> {
    onInput("");
    open = false;
    await tick();
    trigger?.querySelector("button")?.focus();
  }
</script>

<div class="workspace-search" class:open>
  {#if open}
    <div class="workspace-search-field" role="search" aria-label={label}>
      <Magnifier size={14} aria-hidden="true" />
      <input bind:this={input} type="search" {value} aria-label={label} {placeholder} autocomplete="off" spellcheck="false" oninput={(event) => onInput(event.currentTarget.value)} onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void close(); } }} />
      <Button variant="icon" title={closeLabel} onclick={() => void close()}><X size={14} aria-hidden="true" /></Button>
    </div>
  {:else}
    <span bind:this={trigger}><Button variant="icon" title={label} aria-expanded={false} onclick={() => void expand()}><Magnifier size={16} aria-hidden="true" /></Button></span>
  {/if}
</div>
