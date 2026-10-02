<script lang="ts">
  import { onDestroy } from "svelte";
  import type { AgentRoom, RoomExecution, RoomView, RoomPermissionMode } from "@molibot/shared/rooms";
  import type { DesktopAgentItem } from "@molibot/desktop-contract";
  import type { Translation, Locale } from "../i18n";
  import { desktopRoomAttachmentUrl, uploadDesktopRoomFiles, loadDesktopRooms, loadDesktopRoom, actOnDesktopRoom, streamDesktopRoom, loadDesktopAgents, loadDesktopProjects } from "../api";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import ChatComposerShell from "./ChatComposerShell.svelte";
  import ChatMarkdown from "./ChatMarkdown.svelte";
  import { roomsCopy } from "./roomsCopy";

  export let endpoint: string;
  export let copy: Translation;
  export let locale: Locale;
  export let requestedRoomId = "";
  export let onSessionChanged: () => void = () => {};
  let rooms: AgentRoom[] = [];
  let agents: DesktopAgentItem[] = [];
  let projects: Awaited<ReturnType<typeof loadDesktopProjects>> = [];
  let view: RoomView | null = null;
  let selected = "";
  let applied = "";
  let loadedEndpoint = "";
  let error = "";
  let reconnecting = false;
  let editing = false;
  let title = "";
  let members: string[] = [];
  let primary = "";
  let projectId = "";
  let permission = "";
  let targets: string[] = [];
  let replyToId = "";
  let input = "";
  let files: File[] = [];
  let fileInput: HTMLInputElement;
  let submitting = false;
  let pendingSend: { key: string; submissionId: string; attachmentIds: string[] } | undefined;
  let abort: AbortController | undefined;
  let destroyed = false;
  let generation = 0;
  let cursor = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadPending = false;
  let reloadAgain = false;
  $: words = roomsCopy[locale];
  $: enabled = agents.filter(a => a.enabled);
  $: memberOptions = enabled.filter(a => members.includes(a.id)).map(a => ({ value: a.id, label: a.name }));
  $: projectOptions = [{ value: "", label: words.regular }, ...projects.map(p => ({ value: p.id, label: p.name }))];
  $: modeOptions = [{ value: "", label: words.inherit }, ...["plan", "manual", "accept_edits", "auto"].map(value => ({ value, label: ({ plan: copy.permissionModePlan, manual: copy.permissionModeManual, accept_edits: copy.permissionModeAcceptEdits, auto: copy.permissionModeAuto } as Record<string, string>)[value] ?? value }))];
  $: participants = enabled.filter(a => view?.room.participants.some(p => p.agentId === a.id && p.active));
  $: recipients = targets.length ? targets : [view?.messages.find(m => m.id === replyToId)?.authorAgentId ?? view?.room.primaryAgentId ?? ""];
  $: reply = view?.messages.find(m => m.id === replyToId);
  $: active = view?.executions.filter(e => ["running", "waiting_approval", "cancelling", "queued", "paused"].includes(e.status)) ?? [];
  $: if (endpoint && endpoint !== loadedEndpoint) { loadedEndpoint = endpoint; void initialize(); }
  $: if (requestedRoomId !== applied) { applied = requestedRoomId; if (requestedRoomId && endpoint) void open(requestedRoomId); }

  async function initialize() {
    const currentEndpoint = endpoint;
    try {
      const [list, catalog, p] = await Promise.all([loadDesktopRooms(endpoint), loadDesktopAgents(endpoint), loadDesktopProjects(endpoint)]);
      if (destroyed || currentEndpoint !== endpoint) return;
      rooms = list.rooms; agents = catalog.items; projects = p;
      if (requestedRoomId) await open(requestedRoomId);
    } catch (e) { error = String(e); }
  }
  function closeStream() { generation++; abort?.abort(); if (retryTimer) clearTimeout(retryTimer); }
  async function reload(id = selected) {
    if (!id) return;
    const fresh = await loadDesktopRoom(endpoint, id);
    if (selected === id && !destroyed) view = fresh;
  }
  async function open(id: string) {
    closeStream(); selected = id; editing = false; error = ""; targets = []; replyToId = ""; input = ""; files = []; pendingSend = undefined; view = null; cursor = 0;
    const runGeneration = generation;
    try { await reload(id); if (runGeneration === generation) void watch(id, runGeneration); }
    catch (e) { error = String(e); }
  }
  async function watch(id: string, current: number) {
    abort = new AbortController();
    try {
      reconnecting = false;
      await streamDesktopRoom(endpoint, id, cursor, abort.signal, event => {
        if (current !== generation || event.sequence <= cursor) return;
        cursor = event.sequence;
        if (event.type === "text" && view) view = { ...view, executions: view.executions.map(e => e.id === event.executionId ? { ...e, partialText: String(event.payload) } : e) };
        else {
          reloadAgain = true;
          if (!reloadPending) void refreshEvents(id, current);
        }
      });
    } catch (e) { if (current === generation) reconnecting = true; }
    if (!destroyed && current === generation) {
      retryTimer = setTimeout(() => { void reload(id).catch(e => { error = String(e); }).finally(() => { if (current === generation && !destroyed) void watch(id, current); }); }, 2000);
    }
  }
  async function refreshEvents(id: string, current: number) {
    reloadPending = true;
    try {
      while (reloadAgain && current === generation) { reloadAgain = false; await reload(id); }
    } catch (e) { error = String(e); }
    finally { reloadPending = false; }
  }
  function setup(room?: AgentRoom) {
    editing = true; title = room?.title ?? ""; members = room?.participants.filter(p => p.active).map(p => p.agentId) ?? [];
    primary = room?.primaryAgentId ?? ""; projectId = room?.projectId ?? ""; permission = room?.permissionMode ?? "";
  }
  function toggle(id: string, checked: boolean) { members = checked ? [...members, id] : members.filter(x => x !== id); if (!members.includes(primary)) primary = members[0] ?? ""; }
  async function save() {
    submitting = true; error = "";
    try {
      const result = await actOnDesktopRoom(endpoint, { action: selected ? "update" : "create", roomId: selected, title, agentIds: members, primaryAgentId: primary, projectId: projectId || undefined, permissionMode: permission || undefined });
      rooms = (await loadDesktopRooms(endpoint)).rooms;
      onSessionChanged();
      if (result.room) await open(result.room.id);
    } catch (e) { error = String(e); } finally { submitting = false; }
  }
  async function action(action: string, e?: RoomExecution) {
    error = "";
    try {
      const result = await actOnDesktopRoom(endpoint, { action, roomId: selected, executionId: e?.id, submissionId: crypto.randomUUID(), text: input });
      if (action === "steer" && !result.delivered) throw new Error("Execution cannot accept steering");
      if (action === "steer") input = "";
      await reload();
    } catch (e) { error = String(e); }
  }
  async function send() {
    if ((!input.trim() && !files.length) || submitting) return;
    const draft = { endpoint, roomId: selected, text: input, targets: [...targets], replyToId, files: [...files], generation };
    const key = JSON.stringify([draft.roomId, draft.text, draft.targets, draft.replyToId, draft.files.map(f => [f.name, f.size, f.lastModified])]);
    const isCurrent = () => !destroyed && generation === draft.generation && selected === draft.roomId && endpoint === draft.endpoint;
    submitting = true; error = "";
    try {
      let submission = pendingSend?.key === key ? pendingSend : undefined;
      if (!submission) {
        const uploaded = draft.files.length ? await uploadDesktopRoomFiles(draft.endpoint, draft.roomId, draft.files) : { attachments: [] };
        submission = { key, submissionId: crypto.randomUUID(), attachmentIds: uploaded.attachments.map(a => a.id) };
        if (isCurrent()) pendingSend = submission;
      }
      await actOnDesktopRoom(draft.endpoint, { action: "send", attachmentIds: submission.attachmentIds, roomId: draft.roomId, submissionId: submission.submissionId, text: draft.text, agentIds: draft.targets.length ? draft.targets : undefined, replyToId: draft.replyToId || undefined });
      if (isCurrent()) {
        if (input === draft.text) input = "";
        files = []; targets = []; replyToId = ""; pendingSend = undefined;
        await reload(draft.roomId);
      }
      onSessionChanged();
    } catch (e) { if (isCurrent()) error = String(e); } finally { submitting = false; }
  }
  async function approve(e: RoomExecution, decision: "approve_once" | "reject") {
    if (!e.approvalId) return;
    try { await actOnDesktopRoom(endpoint, { action: "approve", roomId: selected, executionId: e.id, decision }); await reload(); }
    catch (e) { error = String(e); }
  }
  async function remove() {
    try { await actOnDesktopRoom(endpoint, { action: "delete", roomId: selected }); closeStream(); selected = ""; view = null; rooms = (await loadDesktopRooms(endpoint)).rooms; onSessionChanged(); }
    catch (e) { error = String(e); }
  }
  function back() { closeStream(); selected = ""; view = null; editing = false; void initialize(); }
  onDestroy(() => { destroyed = true; closeStream(); });
</script>

<section class="room-workspace" data-theme-region="chat">
  <header class="room-header">
    <h2>{view?.room.title ?? words.title}</h2>
    <div class="room-actions">
      {#if selected}<Button class="secondary-button" onclick={back}>{words.back}</Button><Button class="secondary-button" onclick={() => view && setup(view.room)}>{words.edit}</Button>
      {:else}<Button class="secondary-button" onclick={() => { selected = ""; setup(); }}>{words.newRoom}</Button>{/if}
    </div>
  </header>
  {#if error}<p class="onboarding-error" role="alert">{error}</p>{/if}
  {#if reconnecting}<p class="room-metadata" role="status">{words.reconnecting}</p>{/if}
  {#if editing}
    <div class="room-setup">
      <label class="setting-row"><span>{words.name}</span><input aria-label={words.name} bind:value={title} maxlength="120" /></label>
      <h3>{words.members}</h3>
      {#if !enabled.length}<p>{words.noMembers}</p>{/if}
      {#each enabled as agent (agent.id)}
        <div class="setting-row"><span>{agent.name}</span><IosSwitch checked={members.includes(agent.id)} ariaLabel={agent.name} onCheckedChange={checked => toggle(agent.id, checked)} /></div>
      {/each}
      <div class="setting-row"><span>{words.primary}</span><SelectControl value={primary} options={memberOptions} ariaLabel={words.primary} onChange={value => primary = value} /></div>
      {#if !selected}<div class="setting-row"><span>{words.project}</span><SelectControl value={projectId} options={projectOptions} ariaLabel={words.project} onChange={value => projectId = value} /></div>{/if}
      <div class="setting-row"><span>{words.permission}</span><SelectControl value={permission} options={modeOptions} ariaLabel={words.permission} onChange={value => permission = value} /></div>
    </div>
    <div class="settings-footbar"><Button class="primary-button" variant="primary" disabled={submitting || !title.trim() || !members.length} onclick={() => void save()}>{selected ? words.save : words.create}</Button></div>
  {:else if !selected}
    <div class="room-list">
      {#if !rooms.length}<p class="room-metadata">{words.empty}</p>{/if}
      {#each rooms as room (room.id)}<Button class="secondary-button room-list-row" onclick={() => void open(room.id)}>{room.title}<span class="room-metadata">{room.participants.filter(p => p.active).length} · {projects.find(p => p.id === room.projectId)?.name ?? words.regular}</span></Button>{/each}
    </div>
  {:else if view}
    <div class="room-transcript" aria-live="polite">
      {#each view.messages as message (message.id)}
        <article class="room-message" class:room-user={message.role === "user"}>
          <div class="room-metadata">{message.role === "user" ? copy.you : message.authorName}</div>
          <ChatMarkdown source={message.content} {copy} {endpoint} />
          {#each message.attachments ?? [] as attachment}<a class="room-metadata" href={desktopRoomAttachmentUrl(endpoint, selected, attachment.local)} download={attachment.original}>{attachment.original}</a>{/each}
          {#if message.role === "assistant"}
            <div class="room-actions"><Button class="secondary-button" onclick={() => replyToId = message.id}>{words.reply}</Button><Button class="secondary-button" onclick={() => { targets = message.authorAgentId ? [message.authorAgentId] : []; replyToId = message.id; }}>{words.execute}</Button></div>
          {/if}
        </article>
      {/each}
      {#each view.executions.filter(e => e.status !== "completed") as execution (execution.id)}
        <article class="room-execution">
          <div class="room-actions"><strong>{agents.find(a => a.id === execution.agentId)?.name ?? execution.agentId}</strong><span class="room-metadata">{words[execution.status]}</span>
            {#if ["running", "waiting_approval", "queued", "paused"].includes(execution.status)}<Button class="secondary-button" onclick={() => void action("stop", execution)}>{words.stop}</Button>{/if}
            {#if ["failed", "interrupted", "paused"].includes(execution.status)}<Button class="secondary-button" onclick={() => void action("resume", execution)}>{words.resume}</Button>{/if}
            {#if execution.status === "running" && input.trim()}<Button class="secondary-button" onclick={() => void action("steer", execution)}>{words.steer}</Button>{/if}
          </div>
          {#if execution.status === "queued"}<p class="room-metadata">{words.blocked} {execution.blockedBy ? `${agents.find(a => a.id === execution.blockedBy?.agentId)?.name ?? execution.blockedBy.agentId}${execution.blockedBy.waitingApproval ? ` · ${words.waiting_approval}` : ""}` : ""}</p>{/if}
          {#if execution.partialText && !view.messages.some(m => m.executionId === execution.id)}<ChatMarkdown source={execution.partialText} {copy} {endpoint} />{/if}
          {#each execution.operations?.filter(op => op.status === "unknown") ?? [] as operation (operation.id)}
            <p class="onboarding-error">{words.unknown} {operation.description}</p>
            {#if ["failed", "interrupted"].includes(execution.status)}
              <div class="room-actions"><Button class="secondary-button" onclick={() => void actOnDesktopRoom(endpoint, { action: "reconcile", roomId: selected, executionId: execution.id, operationId: operation.id, outcome: "completed" }).then(() => reload()).catch(e => { error = String(e); })}>{locale === "zh-CN" ? "已核对：操作已完成" : "Verified: operation completed"}</Button><Button class="secondary-button" onclick={() => void actOnDesktopRoom(endpoint, { action: "reconcile", roomId: selected, executionId: execution.id, operationId: operation.id, outcome: "failed" }).then(() => reload()).catch(e => { error = String(e); })}>{locale === "zh-CN" ? "已核对：未完成，可重试" : "Verified: not completed, retry allowed"}</Button></div>
            {/if}
          {/each}
          {#if execution.error}<p class="onboarding-error">{execution.error}</p>{/if}
          {#if execution.status === "waiting_approval"}<p>{execution.approval?.displayName}: {execution.approval?.command}</p><p class="room-metadata">{execution.approval?.reason}</p><div class="room-actions"><Button class="secondary-button" onclick={() => void approve(execution, "approve_once")}>{words.approve}</Button><Button class="secondary-button" onclick={() => void approve(execution, "reject")}>{words.reject}</Button></div>{/if}
        </article>
      {/each}
    </div>
    <footer class="room-composer">
      <div class="room-actions">
        {#each participants as agent (agent.id)}<Button class={targets.includes(agent.id) ? "secondary-button room-target-selected" : "secondary-button"} onclick={() => targets = targets.includes(agent.id) ? targets.filter(id => id !== agent.id) : [...targets, agent.id]}>@{agent.name}</Button>{/each}
        {#if active.length}<Button class="secondary-button" onclick={() => void action("stop")}>{words.stopAll}</Button>{:else}<Button class="secondary-button" danger onclick={() => void remove()}>{words.remove}</Button>{/if}
      </div>
      <p class="room-metadata">{recipients.map(id => agents.find(a => a.id === id)?.name ?? id).join(", ")} · {targets.length > 1 ? words.discussion : words.direct}</p>
      {#if targets.length > 1}<p class="room-metadata">{words.limits}</p>{/if}
      {#if reply}<div class="room-actions"><span class="room-quote">{reply.content.slice(0, 160)}</span><Button class="secondary-button" onclick={() => replyToId = ""}>{words.cancelReply}</Button></div>{/if}
      <input type="file" multiple hidden bind:this={fileInput} onchange={() => files = [...files, ...Array.from(fileInput.files ?? [])]} />
      <div class="room-actions"><Button class="secondary-button" onclick={() => fileInput.click()}>{locale === "zh-CN" ? "添加附件" : "Attach files"}</Button>{#each files as file, index}<Button class="secondary-button" onclick={() => files = files.filter((_, i) => i !== index)}>{file.name} ×</Button>{/each}</div>
      <ChatComposerShell {copy} bind:value={input} canSend={Boolean(input.trim() || files.length) && !submitting} disabled={submitting} placeholder={words.placeholder} onSend={() => void send()} onKeydown={event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } }} onPasteFiles={pasted => files = [...files, ...pasted]} />
    </footer>
  {/if}
</section>
