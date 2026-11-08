<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { Terminal } from "@xterm/xterm";
  import type { PiExtensionTerminalSummary } from "@molibot/shared/piExtensionTerminal";
  import "@xterm/xterm/css/xterm.css";
  import Dialog from "./ui/Dialog.svelte";
  import Button from "./ui/Button.svelte";
  import SelectControl from "./ui/SelectControl.svelte";
  import { isPiTerminalActionable, piTerminalLauncherLabel } from "./piExtensionTerminalPresentation";
  import { loadDesktopPiTerminals, loadDesktopPiTerminalOutput, runDesktopPiTerminalAction } from "../api";
  import { piExtensionsCopy } from "../i18n";

  let { endpoint, connected, locale, sessionId, visible, onAttention = () => {} }: { endpoint: string; connected: boolean; locale: string; sessionId: string; visible: boolean; onAttention?: (items: PiExtensionTerminalSummary[]) => void } = $props();
  let copy = $derived(piExtensionsCopy[locale === "zh-CN" ? "zh-CN" : "en"]);
  let terminals = $state<PiExtensionTerminalSummary[]>([]);
  let selectedId = $state("");
  let open = $state(false);
  let error = $state("");
  let element = $state<HTMLDivElement | null>(null);
  let scoped = $derived(visible && sessionId ? terminals.filter(terminal => terminal.sessionId === sessionId) : []);
  let actionable = $derived(scoped.filter(isPiTerminalActionable));
  let launcherLabel = $derived(piTerminalLauncherLabel(actionable, copy));
  let selected = $derived(scoped.find((terminal) => terminal.id === selectedId));
  let pending = $derived(scoped.find(terminal => terminal.status === "running" && terminal.dialog));
  let interactionOpen = $state(false);
  let seenDialogId = $state("");
  let draft = $state("");
  let submitting = $state(false);
  let retryingSharing = $state(false);
  let sharingError = $state("");
  let dialogError = $state("");
  const drafts = new Map<string,string>();
  let activeDraftKey = "";
  let generation = 0;
  let view: Terminal | undefined;
  let inputQueue = Promise.resolve();
  let currentCursor = 0;
  let nextListAt = 0;

  $effect(() => {
    if (!visible || !selected) open = false;
  });

  $effect(() => {
    const dialog = pending?.dialog;
    const key = dialog ? `${endpoint}:${dialog.id}` : "";
    if (activeDraftKey) drafts.set(activeDraftKey, draft);
    while (drafts.size > 32) drafts.delete(drafts.keys().next().value!);
    activeDraftKey = key;
    if (!dialog) { interactionOpen = false; seenDialogId = ""; return; }
    if (dialog.id !== seenDialogId) {
      seenDialogId = dialog.id;
      draft = drafts.get(key) ?? dialog.initialValue ?? "";
      dialogError = "";
      interactionOpen = true;
      open = false;
    }
  });

  $effect(() => {
    const target = endpoint;
    generation++;
    terminals = [];
    untrack(() => onAttention([]));
    drafts.clear();
    activeDraftKey = "";
    selectedId = "";
    open = false;
    error = "";
    sharingError = "";
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
          onAttention(result.filter(terminal => terminal.status === "running" && Boolean(terminal.dialog || terminal.customInteraction) || terminal.requiresReview && !terminal.contextReviewed));
          const liveDrafts = new Set(result.flatMap(terminal => terminal.dialog ? [`${target}:${terminal.dialog.id}`] : []));
          for (const key of drafts.keys()) if (!liveDrafts.has(key)) drafts.delete(key);
          if (activeDraftKey && !liveDrafts.has(activeDraftKey)) activeDraftKey = "";
          const currentScope = result.filter(terminal => terminal.sessionId === sessionId);
          if (!currentScope.some(terminal => terminal.id === selectedId)) selectedId = currentScope.find(terminal => terminal.status === "running")?.id ?? currentScope[0]?.id ?? "";
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
    try { await runDesktopPiTerminalAction(endpoint, { action: "review", id: selectedId }); nextListAt = 0; }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function stop(): Promise<void> {
    if (!selectedId) return;
    try { await runDesktopPiTerminalAction(endpoint, { action: "stop", id: selectedId }); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function retrySharing(): Promise<void> {
    const id=selectedId,target=endpoint,current=generation;
    if(!id || retryingSharing || !connected)return;
    retryingSharing=true;sharingError="";
    try {await runDesktopPiTerminalAction(target,{action:"retrySharing",id});if(current===generation)nextListAt=0;}
    catch(cause){if(current===generation && id===selectedId)sharingError=cause instanceof Error?cause.message:String(cause);}
    finally{retryingSharing=false;}
  }

  function dismissInput(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.isComposing && !submitting) {
      event.preventDefault();
      event.stopPropagation();
      interactionOpen = false;
    }
  }

  async function respond(value: string | boolean | null): Promise<void> {
    const owner = pending;
    const dialog = owner?.dialog;
    if (!owner || !dialog || submitting || !connected) return;
    const current = generation;
    submitting = true;
    dialogError = "";
    try {
      await runDesktopPiTerminalAction(endpoint, { action: "respond", id: owner.id, dialogId: dialog.id, value });
      if (current !== generation) return;
      terminals = terminals.map(entry => entry.id === owner.id && entry.dialog?.id === dialog.id ? { ...entry, dialog: undefined } : entry);
      drafts.delete(`${endpoint}:${dialog.id}`);
      if (activeDraftKey === `${endpoint}:${dialog.id}`) activeDraftKey = "";
      nextListAt = 0;
    } catch (cause) { if (current === generation && pending?.id === owner.id && pending?.dialog?.id === dialog.id) dialogError = cause instanceof Error ? cause.message : String(cause); }
    finally { submitting = false; }
  }
</script>

{#if actionable.length}
  <button class="secondary-button pi-terminal-launcher" type="button" onclick={() => { if (pending) interactionOpen = true; else { selectedId = actionable[0].id; open = true; } }}>{launcherLabel}{actionable.some((terminal) => terminal.status === "running") ? " · ●" : ""}</button>
{/if}
<Dialog open={interactionOpen && Boolean(pending?.dialog)} busy={submitting} closeOnOutside={false} contentClass="pi-interaction-dialog" labelledBy="pi-interaction-title" onOpenChange={value => interactionOpen = value}>
  {#if pending?.dialog}
    <header>
      <p class="pi-interaction-source">{copy.interactionTitle} · {pending.extensionIds.join(", ")}</p>
      <h2 id="pi-interaction-title">{pending.dialog.title}</h2>
    </header>
    <div class="modal-body pi-interaction-body">
      {#if pending.dialog.message}<p>{pending.dialog.message}</p>{/if}
      {#if pending.dialog.kind === "select"}
        <div class="pi-interaction-options">
          {#each pending.dialog.options ?? [] as option, index (index)}
            <Button disabled={submitting || !connected} onclick={() => void respond(option)}>{option}</Button>
          {/each}
        </div>
      {:else if pending.dialog.kind === "editor"}
        <textarea class="pi-interaction-editor" aria-label={pending.dialog.title} bind:value={draft} disabled={submitting || !connected} onkeydown={dismissInput}></textarea>
      {:else if pending.dialog.kind === "input"}
        <input class="pi-interaction-input" aria-label={pending.dialog.title} placeholder={pending.dialog.placeholder ?? ""} bind:value={draft} disabled={submitting || !connected} onkeydown={event => { dismissInput(event); if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void respond(draft); } }} />
      {/if}
      {#if dialogError || error}<p class="pi-terminal-error" role="alert">{dialogError || error}</p>{/if}
      {#if !connected}<p role="status">{copy.terminalDisconnected}</p>{/if}
    </div>
    <footer class="pi-interaction-actions">
      <Button disabled={submitting} onclick={() => interactionOpen = false}>{copy.laterInteraction}</Button>
      <Button disabled={submitting || !connected} onclick={() => void respond(null)}>{copy.cancelInteraction}</Button>
      {#if pending.dialog.kind === "confirm"}
        <Button disabled={submitting || !connected} onclick={() => void respond(false)}>{copy.declineInteraction}</Button>
        <Button variant="primary" disabled={submitting || !connected} onclick={() => void respond(true)}>{copy.confirmInteraction}</Button>
      {:else if pending.dialog.kind !== "select"}
        <Button variant="primary" disabled={submitting || !connected} onclick={() => void respond(draft)}>{copy.submitInteraction}</Button>
      {/if}
    </footer>
  {/if}
</Dialog>
<Dialog {open} busy={selected?.status === "running"} closeOnOutside={false} contentClass="pi-terminal-dialog" labelledBy="pi-terminal-title" onOpenChange={(value) => open = value}>
  <header class="pi-terminal-header">
    <div><h2 id="pi-terminal-title">{selected?.requiresReview && !selected.contextReviewed ? copy.reviewTitle : copy.terminalTitle}</h2><p>{selected?.requiresReview && !selected.contextReviewed ? copy.reviewPanelHint : copy.terminalHint}</p></div>
    <div class="pi-terminal-actions">
      {#if selected?.status === "running"}<button class="danger-button" type="button" onclick={stop}>{copy.stopTerminal}</button>{/if}
      <button class="secondary-button" type="button" onclick={() => open = false}>{copy.hideTerminal}</button>
    </div>
  </header>
  {#if scoped.length > 1}
    <SelectControl ariaLabel={copy.terminalTitle} value={selectedId} onChange={value => selectedId = value} options={scoped.map(terminal => ({ value: terminal.id, label: `${terminal.extensionIds.join(", ")} · ${terminal.status}` }))} />
  {/if}
  {#if !connected}<p role="status">{copy.terminalDisconnected}</p>{/if}
  {#if sharingError || error || selected?.error}<p class="pi-terminal-error" role="alert">{sharingError || error || selected?.error}</p>{/if}
  {#if selected && selected.status !== "running"}<p role="status">{selected.status === "completed" ? copy.terminalCompleted : selected.status === "stopped" ? copy.terminalStopped : selected.status === "waiting_approval" ? copy.terminalWaitingApproval : copy.terminalFailed}</p>{/if}
  {#if selected?.cleanupStatus}
    <p role="status">{selected.cleanupStatus === "running" ? copy.cleanupRunning : selected.cleanupStatus === "hooks_completed" ? copy.cleanupCompleted : selected.cleanupStatus === "unknown" ? copy.cleanupUnknown : copy.cleanupPending}</p>
  {/if}
  {#if selected?.sharingStatus && selected.sharingStatus !== "unverified"}
    <p role="status">{selected.sharingStatus === "released" ? copy.sharingReleased : selected.sharingStatus === "stopping" ? copy.sharingStopping : copy.sharingUnknown}</p>
  {/if}
  {#if selected?.sharingRetryable}
    <Button disabled={retryingSharing || !connected} onclick={() => void retrySharing()}>{retryingSharing ? copy.sharingStopping : copy.retrySharing}</Button>
  {/if}
  {#if selected?.requiresReview && !selected.contextReviewed}
    <p>{copy.reviewHint}</p><button class="secondary-button" type="button" disabled={Boolean(selected.sharingRetryable) || retryingSharing} onclick={review}>{copy.reviewContext}</button>
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
