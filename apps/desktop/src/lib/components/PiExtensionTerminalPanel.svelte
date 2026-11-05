<script lang="ts">
  import { onMount } from "svelte";
  import type { Terminal } from "@xterm/xterm";
  import type { PiExtensionTerminalSummary } from "@molibot/shared/piExtensionTerminal";
  import "@xterm/xterm/css/xterm.css";
  import Dialog from "./ui/Dialog.svelte";
  import { loadDesktopPiTerminals, loadDesktopPiTerminalOutput, runDesktopPiTerminalAction } from "../api";
  import { piExtensionsCopy } from "../i18n";

  let { endpoint, connected, locale }: { endpoint: string; connected: boolean; locale: string } = $props();
  let copy = $derived(piExtensionsCopy[locale === "zh-CN" ? "zh-CN" : "en"]);
  let terminals = $state<PiExtensionTerminalSummary[]>([]);
  let selectedId = $state("");
  let open = $state(false);
  let error = $state("");
  let element = $state<HTMLDivElement | null>(null);
  let selected = $derived(terminals.find((terminal) => terminal.id === selectedId));
  let generation = 0;
  let view: Terminal | undefined;
  let inputQueue = Promise.resolve();
  let currentCursor = 0;
  let nextListAt = 0;

  $effect(() => {
    const target = endpoint;
    generation++;
    terminals = [];
    selectedId = "";
    open = false;
    error = "";
    nextListAt = 0;
    void target;
  });

  onMount(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      const target = endpoint;
      const current = generation;
      try {
        if (!target || !connected) return;
        if (Date.now() >= nextListAt) {
          const result = await loadDesktopPiTerminals(target);
          if (disposed || current !== generation) return;
          nextListAt = Date.now() + 1500;
          terminals = result;
          if (!result.some(terminal => terminal.id === selectedId)) selectedId = result.find(terminal => terminal.status === "running")?.id ?? result[0]?.id ?? "";
          if (!result.length) open = false;
        }
        if (open && selectedId && view) {
          const id = selectedId;
          const terminal = view;
          const output = await loadDesktopPiTerminalOutput(target, id, currentCursor);
          if (disposed || current !== generation || id !== selectedId || terminal !== view) return;
          if (output.reset) terminal.reset();
          terminal.write(output.output);
          currentCursor = output.cursor;
          terminals = terminals.map(entry => entry.id === id ? output.terminal : entry);
        }
        error = "";
      } catch (cause) {
        if (!disposed && current === generation) error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), open && selected?.status === "running" ? 150 : 1500);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  });

  $effect(() => {
    const container = element;
    const id = selectedId;
    const target = endpoint;
    if (!container || !id || !open) return;
    let disposed = false;
    let terminal: Terminal | undefined;
    let observer: ResizeObserver | undefined;
    currentCursor = 0;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;
      terminal = new Terminal({ screenReaderMode: true, cursorBlink: true, convertEol: false, scrollback: 3000, fontSize: 13,
        fontFamily: "Geist Mono, monospace", theme: { background: getComputedStyle(container).getPropertyValue("--pi-terminal-bg").trim(), foreground: getComputedStyle(container).getPropertyValue("--pi-terminal-fg").trim() } });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container);
      terminal.textarea?.setAttribute("aria-label", copy.terminalInput);
      view = terminal;
      terminal.onData((data) => {
        if (!connected || selected?.id !== id || selected.status !== "running") return;
        inputQueue = inputQueue.then(() => runDesktopPiTerminalAction(target, { action: "input", id, data }))
          .catch((cause) => { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); });
      });
      observer = new ResizeObserver(() => {
        if (disposed || !terminal) return;
        fit.fit();
        if (connected && selected?.id === id && selected.status === "running") {
          void runDesktopPiTerminalAction(target, { action: "resize", id, columns: Math.max(20, Math.min(400, terminal.cols)), rows: Math.max(5, Math.min(200, terminal.rows)) })
            .catch((cause) => { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); });
        }
      });
      observer.observe(container);
      fit.fit();
      terminal.focus();
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      terminal?.dispose();
      if (view === terminal) view = undefined;
    };
  });

  $effect(() => {
    const label = copy.terminalInput;
    element?.querySelector("textarea")?.setAttribute("aria-label", label);
  });

  async function review(): Promise<void> {
    if (!selectedId) return;
    try { await runDesktopPiTerminalAction(endpoint, { action: "review", id: selectedId }); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function stop(): Promise<void> {
    if (!selectedId) return;
    try { await runDesktopPiTerminalAction(endpoint, { action: "stop", id: selectedId }); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }
</script>

{#if terminals.length}
  <button class="secondary-button pi-terminal-launcher" type="button" onclick={() => { selectedId ||= terminals[0].id; open = true; }}>{copy.terminalTitle}{terminals.some((terminal) => terminal.status === "running") ? " · ●" : ""}</button>
{/if}
<Dialog {open} busy={selected?.status === "running"} closeOnOutside={false} contentClass="pi-terminal-dialog" labelledBy="pi-terminal-title" onOpenChange={(value) => open = value}>
  <header class="pi-terminal-header">
    <div><h2 id="pi-terminal-title">{copy.terminalTitle}</h2><p>{copy.terminalHint}</p></div>
    <div class="pi-terminal-actions">
      {#if selected?.status === "running"}<button class="danger-button" type="button" onclick={stop}>{copy.stopTerminal}</button>{/if}
      <button class="secondary-button" type="button" onclick={() => open = false}>{copy.hideTerminal}</button>
    </div>
  </header>
  {#if terminals.length > 1}
    <select aria-label={copy.terminalTitle} bind:value={selectedId}>{#each terminals as terminal (terminal.id)}<option value={terminal.id}>{terminal.extensionIds.join(", ")} · {terminal.status}</option>{/each}</select>
  {/if}
  {#if !connected}<p role="status">{copy.terminalDisconnected}</p>{/if}
  {#if error || selected?.error}<p class="pi-terminal-error" role="alert">{error || selected?.error}</p>{/if}
  {#if selected && selected.status !== "running"}<p role="status">{selected.status === "completed" ? copy.terminalCompleted : selected.status === "stopped" ? copy.terminalStopped : selected.status === "waiting_approval" ? copy.terminalWaitingApproval : copy.terminalFailed}</p>{/if}
  {#if selected?.requiresReview && !selected.contextReviewed}
    <p>{copy.reviewHint}</p><button class="secondary-button" type="button" onclick={review}>{copy.reviewContext}</button>
  {/if}
  <div class="pi-terminal-surface" bind:this={element} aria-label={copy.terminalTitle}></div>
</Dialog>

<style>
  .pi-terminal-launcher { position: fixed; bottom: 18px; right: 20px; z-index: 45; }
  :global(.pi-terminal-dialog) { width: min(1000px, calc(100vw - 32px)); max-width: 1000px; display: flex; flex-direction: column; gap: 12px; padding: 20px; }
  .pi-terminal-header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
  .pi-terminal-header h2 { margin: 0 0 6px; font-size: var(--fs-section); line-height: var(--lh-section); }
  .pi-terminal-header p { margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .pi-terminal-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .pi-terminal-surface { height: min(65vh, 620px); min-height: 200px; min-width: 0; padding: 8px; background: var(--pi-terminal-bg); border-radius: var(--rounded-sm); overflow: hidden; }
  .pi-terminal-error { color: var(--danger); overflow-wrap: anywhere; }
  @media (max-width: 600px) { .pi-terminal-header { flex-direction: column; } :global(.pi-terminal-dialog) { padding: 12px; } }
</style>
