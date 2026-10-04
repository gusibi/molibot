<script lang="ts">
  import { onDestroy } from "svelte";
  import type { AgentRoom, RoomExecution, RoomView, RoomPermissionMode } from "@molibot/shared/rooms";
  import { DESKTOP_THINKING_LEVELS, type DesktopModelOption, type DesktopThinkingSelection, type DesktopAgentItem } from "@molibot/desktop-contract";
  import type { Translation, Locale } from "../i18n";
  import { fetchDesktopRoomFileBlob, uploadDesktopRoomFiles, loadDesktopRoom, actOnDesktopRoom, streamDesktopRoom, loadDesktopAgents, loadDesktopProjects } from "../api";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import BotMention from "./BotMention.svelte";
  import BotAvatar from "./BotAvatar.svelte";
  import ChatInputArea from "./ChatInputArea.svelte";
  import { shouldSubmitComposer, resolveComposerThinking, thinkingSelectionLabel } from "./composerInput";
  import { formatMessageTime } from "./messageTime";
  import { saveBlobAsFile } from "../saveFile";
  import ChatMessagesPane from "./ChatMessagesPane.svelte";
  import ApprovalCard from "./ApprovalCard.svelte";
  import ChatHeader from "./ChatHeader.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import type { TranscriptMessage, TranscriptAttachmentActions } from "./transcript";
  import type { DesktopActivityEntry } from "../api";
  import type { ComposerMenuItem } from "./composerSuggestionCatalog";
  import { roomMentionIds } from "@molibot/shared/roomMentions";
  import { sessionDraftKey, type SessionDraftStore } from "./sessionDraftStore";
  import { humanizeModelOption } from "../presentation";
  import { roomsCopy } from "./roomsCopy";

  export let draftStore: SessionDraftStore;
  let activeDraftKey = "";
  export let modelOptions: DesktopModelOption[] = [];
  export let defaultThinking: DesktopThinkingSelection = "medium";
  export let autoAvailable = false;
  export let recording = false;
  export let recordingSeconds = 0;
  export let recordingError = "";
  export let pendingAudioUrls = new Map<File, string>();
  export let inferAttachmentKind: (file: File) => "image" | "audio" | "video" | "file";
  export let onToggleRecording: () => void;
  export let onFinishRecording: (send: boolean) => void;
  export let onDismissRecordingError: () => void;
  export let onOpenSettings: () => void;
  let modelKey = "";
  let thinking: DesktopThinkingSelection | undefined;
  export function addFiles(picked: File[]) { files = [...files, ...picked.filter(file => file.size > 0)]; }
  export let endpoint: string;
  export let copy: Translation;
  export let locale: Locale;
  export let requestedRoomId = "";
  export let startInCreate = false;
  export let onSelectRoom: (roomId: string) => void = () => {};
  export let onExit: () => void = () => {};
  export let onSessionChanged: () => void = () => {};
  let appliedStartInCreate = startInCreate;
  let agents: DesktopAgentItem[] = [];
  let projects: Awaited<ReturnType<typeof loadDesktopProjects>> = [];
  let view: RoomView | null = null;
  let selected = "";
  let selectedSession = "";
  const selectionStorageKey = "molibot-desktop-room-sessions";
  let applied = "";
  let loadedEndpoint = "";
  let error = "";
  let reconnecting = false;
  let editing = startInCreate;
  let title = "";
  let members: string[] = [];
  let primary = "";
  let projectId = "";
  let permission = "";
  let targets: string[] = [];
  let copiedId = "";
  let mediaUrls = new Map<string, string>();
  let mediaLoading = new Set<string>();
  let mediaFailed = new Set<string>();
  let executionActivities: Record<string, DesktopActivityEntry[]> = {};
  $: mentionSuggestions = participants.map((agent): ComposerMenuItem => ({id: `agent:${agent.id}`, kind: "agent", label: `@${agent.name}`, insertText: `@${agent.id} `, description: agent.description, aliases: [agent.id, agent.name], submitOnSelect: false}));
  $: mentioned = resolveMentions(input, participants);
  function resolveMentions(text: string, members: DesktopAgentItem[]) {
    try { return roomMentionIds(text, members); } catch { return []; }
  }
  $: executionsById = new Map((view?.executions ?? []).map(execution => [execution.id, execution]));
  $: committedTranscript = (view?.messages ?? []).map((message): TranscriptMessage => {
    const execution = message.executionId ? executionsById.get(message.executionId) : undefined;
    return {...message, stopReason: message.role === "assistant"
      ? execution?.status === "failed" ? "error" : ["cancelled", "interrupted"].includes(execution?.status ?? "") ? "aborted" : "stop"
      : undefined, errorMessage: execution?.error, attachments: message.attachments?.map(a => ({...a, mediaType: a.mediaType ?? "file"}))};
  });
  $: transcript = [...committedTranscript, ...(view?.executions ?? []).filter(e => ["failed", "interrupted", "cancelled"].includes(e.status) && !view?.messages.some(m => m.executionId === e.id)).map((e): TranscriptMessage => ({id: `execution:${e.id}`, role: "assistant", content: e.partialText, authorAgentId: e.agentId, authorName: agents.find(a => a.id === e.agentId)?.name ?? e.agentId, createdAt: e.createdAt, stopReason: e.status === "failed" ? "error" : "aborted", errorMessage: e.error, activities: executionActivities[e.id] ?? []}))].sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
  $: liveResponses = active.map(execution => ({id: execution.id, authorAgentId: execution.agentId, onStop: () => void action("stop", execution), assistantName: agents.find(a => a.id === execution.agentId)?.name ?? execution.agentId, streamingText: execution.partialText, activity: words[execution.status], activities: executionActivities[execution.id] ?? []}));
  $: attachmentActions = makeAttachmentActions(transcript, mediaUrls, mediaLoading, mediaFailed);
  function clearMedia() { for (const url of mediaUrls.values()) URL.revokeObjectURL(url); mediaUrls = new Map(); mediaLoading = new Set(); mediaFailed = new Set(); }
  function makeAttachmentActions(messages: TranscriptMessage[], urls: Map<string, string>, loading: Set<string>, failed: Set<string>): TranscriptAttachmentActions {
    const filesByLocal = new Map(messages.flatMap(message => (message.attachments ?? []).filter(a => a.local).map(a => [a.local!, {...a, id: a.local!, local: a.local!, size: a.size ?? 0, createdAt: message.createdAt ?? ""}] as const)));
    return { filesByLocal, mediaUrls: urls, mediaLoading: loading, mediaFailed: failed, loadMedia: file => {
      const current = generation; const roomId = selected;
      mediaLoading = new Set([...mediaLoading, file.local]);
      void fetchDesktopRoomFileBlob(endpoint, roomId, file.local).then(blob => {
        if (!destroyed && current === generation) mediaUrls = new Map([...mediaUrls, [file.local, URL.createObjectURL(blob)]]);
      }).catch(() => { if (current === generation) mediaFailed = new Set([...mediaFailed, file.local]); })
        .finally(() => { if (current === generation) mediaLoading = new Set([...mediaLoading].filter(local => local !== file.local)); });
    }, canPreview: () => false, preview: () => {}, download: file => {
      void fetchDesktopRoomFileBlob(endpoint, selected, file.local).then(blob => saveBlobAsFile(blob, file.original)).catch(cause => error = String(cause));
    } };
  }
  function copyMessage(message: TranscriptMessage) { void navigator.clipboard.writeText(message.content).then(() => copiedId = message.id ?? ""); }
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
  $: primaryOptions = memberOptions.length ? memberOptions : [{ value: "", label: words.chooseMembers }];
  $: selectedMembers = enabled.filter(a => members.includes(a.id));
  $: projectOptions = [{ value: "", label: words.regular }, ...projects.map(p => ({ value: p.id, label: p.name }))];
  $: modeOptions = [{ value: "", label: words.inherit }, ...["plan", "manual", "accept_edits", "auto"].map(value => ({ value, label: ({ plan: copy.permissionModePlan, manual: copy.permissionModeManual, accept_edits: copy.permissionModeAcceptEdits, auto: copy.permissionModeAuto } as Record<string, string>)[value] ?? value }))];
  $: participants = enabled.filter(a => view?.room.participants.some(p => p.agentId === a.id && p.active));
  $: explicitRecipients = [...new Set([...targets, ...mentioned])];
  $: recipients = explicitRecipients.length ? explicitRecipients : [view?.messages.find(m => m.id === replyToId)?.authorAgentId ?? view?.room.primaryAgentId ?? ""];
  $: inheritedKeys = recipients.map(id => view?.memberModelKeys?.[id] ?? "");
  $: effectiveModelKey = modelKey || (new Set(inheritedKeys).size === 1 ? inheritedKeys[0] : "");
  $: activeModel = modelOptions.find(option => option.key === effectiveModelKey);
  $: activeModelLabel = activeModel?.alias || (activeModel ? humanizeModelOption(activeModel.label, activeModel.key).label.split(" · ").at(-1) ?? activeModel.label : words.memberModels);
  $: roomModelOptions = [{ key: "", label: words.memberModels }, ...modelOptions];
  $: thinkingOptions = activeModel?.thinkingLevels ?? DESKTOP_THINKING_LEVELS;
  $: effectiveThinking = resolveComposerThinking(thinking ?? defaultThinking, thinkingOptions);
  $: thinkingLabel = thinkingSelectionLabel(copy, effectiveThinking);
  $: if (view && selected && !editing) {
    const key = sessionDraftKey("room", selectedSession);
    if (key !== activeDraftKey) {
      activeDraftKey = key;
      if (draftStore.has(key)) {
        const draft = draftStore.get(key);
        input = draft.text; files = draft.files; thinking = draft.thinkingLevel; modelKey = draft.modelKey ?? "";
      }
    }
  } else activeDraftKey = "";
  $: if (view && !editing && activeDraftKey === sessionDraftKey("room", selectedSession)) {
    draftStore.update(activeDraftKey, { text: input, files, thinkingLevel: thinking ?? defaultThinking, modelKey });
  }
  $: sessionOptions = (view?.sessions ?? []).map((session, index, sessions) => ({ value: session.id,
    label: session.title || `${words.conversation} ${sessions.length - index}` }));
  $: reply = view?.messages.find(m => m.id === replyToId);
  $: active = view?.executions.filter(e => ["running", "waiting_approval", "cancelling", "queued", "paused"].includes(e.status)) ?? [];
  $: if (endpoint && endpoint !== loadedEndpoint) { loadedEndpoint = endpoint; void initialize(); }
  $: if (requestedRoomId !== applied) { applied = requestedRoomId; if (requestedRoomId && endpoint) void open(requestedRoomId); }
  // The sidebar's "+" raises `startInCreate`; a change enters the create form
  // without touching the (now sidebar-owned) room list.
  $: if (startInCreate !== appliedStartInCreate) { appliedStartInCreate = startInCreate; if (startInCreate) beginCreate(); }

  async function initialize() {
    const currentEndpoint = endpoint;
    try {
      const [catalog, p] = await Promise.all([loadDesktopAgents(endpoint), loadDesktopProjects(endpoint)]);
      if (destroyed || currentEndpoint !== endpoint) return;
      agents = catalog.items; projects = p; error = ""; reconnecting = false;
      if (requestedRoomId) await open(requestedRoomId);
    } catch (e) {
      if (destroyed || currentEndpoint !== endpoint) return;
      error = String(e); reconnecting = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (!destroyed && currentEndpoint === endpoint) void initialize(); }, 2000);
    }
  }
  function closeStream() { generation++; reloadPending = false; reloadAgain = false; abort?.abort(); if (retryTimer) clearTimeout(retryTimer); }
  async function reload(id = selected) {
    if (!id) return;
    const current = generation;
    const sessionId = selectedSession;
    const fresh = await loadDesktopRoom(endpoint, id, sessionId);
    if (current === generation && selected === id && selectedSession === sessionId && !destroyed) { view = fresh; error = ""; }
    return fresh;
  }
  function savedSession(id: string): string {
    try { return JSON.parse(localStorage.getItem(selectionStorageKey) || "{}")[id] ?? ""; } catch { return ""; }
  }
  function rememberSession(id: string, sessionId: string) {
    try { const saved = JSON.parse(localStorage.getItem(selectionStorageKey) || "{}"); saved[id] = sessionId;
      localStorage.setItem(selectionStorageKey, JSON.stringify(saved)); } catch { /* Selection persistence is optional. */ }
  }
  async function open(id: string, sessionId = savedSession(id)) {
    if (activeDraftKey) draftStore.update(activeDraftKey, { text: input, files, thinkingLevel: thinking ?? defaultThinking, modelKey });
    selectedSession = sessionId;
    closeStream(); clearMedia(); executionActivities = {}; selected = id; applied = id; onSelectRoom(id); editing = false; error = ""; targets = []; replyToId = ""; input = ""; files = []; pendingSend = undefined; view = null; cursor = 0; modelKey = ""; thinking = undefined;
    const runGeneration = generation;
    try { const fresh = await loadDesktopRoom(endpoint, id, sessionId); if (runGeneration === generation) { selectedSession = fresh.session.id; rememberSession(id, selectedSession); modelKey = fresh.composerSelection?.modelKey ?? ""; thinking = fresh.composerSelection?.thinkingLevel; view = fresh; void watch(id, runGeneration); } }
    catch (e) { if (runGeneration === generation) { error = String(e); void watch(id, runGeneration); } }
  }
  async function watch(id: string, current: number) {
    abort = new AbortController();
    try {
      reconnecting = false;
      await streamDesktopRoom(endpoint, id, cursor, abort.signal, event => {
        if (current !== generation || event.sequence <= cursor) return;
        cursor = event.sequence;
        if (event.sessionId && event.sessionId !== selectedSession) return;
        if (event.type === "activity" && event.executionId) {
          const activity = event.payload as DesktopActivityEntry;
          const previous = executionActivities[event.executionId] ?? [];
          executionActivities = {...executionActivities, [event.executionId]: [...previous.filter(item => item.key !== activity.key), activity]};
        }
        if (event.type === "text" && view) view = { ...view, executions: view.executions.map(e => e.id === event.executionId ? { ...e, partialText: String(event.payload) } : e) };
        else {
          reloadAgain = true;
          if (!reloadPending) void refreshEvents(id, current);
        }
      });
    } catch (e) { if (current === generation) reconnecting = true; }
    if (!destroyed && current === generation) {
      reconnecting = true;
      retryTimer = setTimeout(() => { void reload(id).catch(e => { if (current === generation) error = String(e); }).finally(() => { if (current === generation && !destroyed) void watch(id, current); }); }, 2000);
    }
  }
  async function refreshEvents(id: string, current: number) {
    reloadPending = true;
    try {
      while (reloadAgain && current === generation) { reloadAgain = false; await reload(id); }
    } catch (e) { if (current === generation) error = String(e); }
    finally { if (current === generation) reloadPending = false; }
  }
  function setup(room?: AgentRoom) {
    editing = true; title = room?.title ?? ""; members = room?.participants.filter(p => p.active).map(p => p.agentId) ?? [];
    primary = room?.primaryAgentId ?? ""; projectId = room?.projectId ?? ""; permission = room?.permissionMode ?? "";
  }
  function beginCreate() { closeStream(); clearMedia(); selected = ""; view = null; editing = false; targets = []; replyToId = ""; input = ""; files = []; setup(); }
  function cancelEdit() { editing = false; if (!selected) onExit(); }
  function toggle(id: string, checked: boolean) { members = checked ? [...members, id] : members.filter(x => x !== id); if (!members.includes(primary)) primary = members[0] ?? ""; }
  async function save() {
    submitting = true; error = "";
    try {
      const result = await actOnDesktopRoom(endpoint, { action: selected ? "update" : "create", roomId: selected, title, agentIds: members, primaryAgentId: primary, projectId: projectId || undefined, permissionMode: permission || undefined });
      onSessionChanged();
      if (result.room) await open(result.room.id);
    } catch (e) { error = String(e); } finally { submitting = false; }
  }
  async function newConversation() {
    if (submitting) return;
    const roomId = selected; const current = generation;
    submitting = true; error = "";
    try {
      const result = await actOnDesktopRoom(endpoint, { action: "new_session", roomId });
      if (current === generation && result.session) await open(roomId, result.session.id);
      onSessionChanged();
    } catch (cause) { if (current === generation) error = String(cause); }
    finally { submitting = false; }
  }
  async function action(action: string, e?: RoomExecution) {
    const current = generation;
    error = "";
    try {
      const result = await actOnDesktopRoom(endpoint, { action, roomId: selected, sessionId: selectedSession, executionId: e?.id, submissionId: crypto.randomUUID(), text: input });
      if (current !== generation) return;
      if (action === "steer" && !result.delivered) throw new Error("Execution cannot accept steering");
      if (action === "steer") input = "";
      await reload();
    } catch (e) { if (current === generation) error = String(e); }
  }
  async function send() {
    if ((!input.trim() && !files.length) || submitting) return;
    const draft = { endpoint, roomId: selected, sessionId: selectedSession, text: input, targets: [...explicitRecipients], replyToId, files: [...files], modelKey, thinkingLevel: effectiveThinking, generation };
    const key = JSON.stringify([draft.roomId, draft.sessionId, draft.text, draft.targets, draft.replyToId, draft.files.map(f => [f.name, f.size, f.lastModified]), draft.modelKey, draft.thinkingLevel]);
    const isCurrent = () => !destroyed && generation === draft.generation && selected === draft.roomId && selectedSession === draft.sessionId && endpoint === draft.endpoint;
    submitting = true; error = "";
    try {
      let submission = pendingSend?.key === key ? pendingSend : undefined;
      if (!submission) {
        const uploaded = draft.files.length ? await uploadDesktopRoomFiles(draft.endpoint, draft.roomId, draft.files) : { attachments: [] };
        submission = { key, submissionId: crypto.randomUUID(), attachmentIds: uploaded.attachments.map(a => a.id) };
        if (isCurrent()) pendingSend = submission;
      }
      await actOnDesktopRoom(draft.endpoint, { action: "send", modelKey: draft.modelKey || undefined, thinkingLevel: draft.thinkingLevel, attachmentIds: submission.attachmentIds, roomId: draft.roomId, sessionId: draft.sessionId, submissionId: submission.submissionId, text: draft.text, agentIds: draft.targets.length ? draft.targets : undefined, replyToId: draft.replyToId || undefined });
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
    try { await actOnDesktopRoom(endpoint, { action: "delete", roomId: selected }); closeStream(); selected = ""; view = null; onSessionChanged(); onExit(); }
    catch (e) { error = String(e); }
  }
  function back() { closeStream(); selected = ""; applied = ""; onSelectRoom(""); view = null; editing = false; onExit(); }
  onDestroy(() => { destroyed = true; closeStream(); clearMedia(); });
</script>

<section class="room-workspace" class:room-setting={editing} class:chat-content={Boolean(selected && !editing)} data-theme-region="chat">
  {#if selected && !editing}
    <ChatHeader title={view?.room.title ?? words.title} subtitle={` · ${reconnecting ? words.reconnecting : participants.map(agent => agent.name).join(" · ")}`}>
      <svelte:fragment slot="actions">
        <div class="room-session-picker"><SelectControl value={selectedSession} options={sessionOptions} ariaLabel={words.conversations}
          disabled={submitting || !view} onChange={sessionId => { if (sessionId !== selectedSession) void open(selected, sessionId); }} /></div>
        <Button class="secondary-button" disabled={submitting || !view} onclick={() => void newConversation()}>{words.newConversation}</Button>
        <OverflowMenu label={words.title}>
        <button type="button" class="overflow-menu-item" onclick={back}>{words.back}</button>
        <button type="button" class="overflow-menu-item" onclick={() => view && setup(view.room)}>{words.edit}</button>
        <button type="button" class="overflow-menu-item danger" onclick={() => void remove()}>{words.remove}</button>
      </OverflowMenu></svelte:fragment>
    </ChatHeader>
  {:else}
  <header class="room-header" data-tauri-drag-region>
    <div class="room-heading" data-tauri-drag-region>{#if editing}<span class="room-eyebrow" data-tauri-drag-region>{words.title}</span>{/if}<h2 data-tauri-drag-region>{editing ? (selected ? words.editTitle : words.createTitle) : view?.room.title ?? words.title}</h2>{#if editing}<p data-tauri-drag-region>{words.setupDescription}</p>{/if}</div>
    <div class="room-actions">
      {#if editing}<Button class="secondary-button" onclick={cancelEdit}>{words.cancel}</Button>
      {:else if selected}<Button class="secondary-button" onclick={back}>{words.back}</Button><Button class="secondary-button" onclick={() => view && setup(view.room)}>{words.edit}</Button><Button class="secondary-button" danger onclick={() => void remove()}>{words.remove}</Button>{/if}
    </div>
  </header>
  {/if}
  {#if error && (editing || !selected || !view)}<p class="onboarding-error" role="alert">{error}</p>{/if}
  {#if editing}
    <div class="room-setup">
      <SettingGroup title={words.basics} description={words.basicsDescription}>
        <SettingRow title={words.name} stacked>
          <label class="settings-field room-name-field"><input aria-label={words.name} placeholder={words.namePlaceholder} bind:value={title} maxlength="120" /></label>
        </SettingRow>
      </SettingGroup>
      <section class="room-members-section" aria-label={words.members}>
        <header class="section-header"><div><h3>{words.members}</h3><p>{words.membersDescription}</p></div><span class="room-member-count">{members.length} {words.selectedCount}</span></header>
        {#if !enabled.length}<p class="room-members-empty">{words.noMembers}</p>{/if}
        <div class="room-member-grid">
          {#each enabled as agent (agent.id)}
            <div class="room-member-card" class:room-member-selected={members.includes(agent.id)}>
              <BotAvatar botId={agent.id} name={agent.name} size={36} />
              <div class="room-member-copy"><strong>{agent.name}</strong><p>{agent.description || words.agentDescription}</p></div>
              <IosSwitch checked={members.includes(agent.id)} ariaLabel={agent.name} onCheckedChange={checked => toggle(agent.id, checked)} />
            </div>
          {/each}
        </div>
      </section>
      <SettingGroup title={words.behavior} description={words.behaviorDescription}>
        <SettingRow title={words.primary} description={words.primaryDescription}><SelectControl value={primary} options={primaryOptions} disabled={!members.length} ariaLabel={words.primary} onChange={value => primary = value} /></SettingRow>
        {#if !selected}<SettingRow title={words.project} description={words.projectDescription}><SelectControl value={projectId} options={projectOptions} ariaLabel={words.project} onChange={value => projectId = value} /></SettingRow>{/if}
        <SettingRow title={words.permission} description={words.permissionDescription}><SelectControl value={permission} options={modeOptions} ariaLabel={words.permission} onChange={value => permission = value} /></SettingRow>
      </SettingGroup>
    </div>
    <div class="settings-footbar room-setup-footbar">
      <div class="room-team-summary"><div class="room-team-avatars">{#each selectedMembers.slice(0, 4) as agent (agent.id)}<BotAvatar botId={agent.id} name={agent.name} size={24} />{/each}</div><span class="settings-footbar-label">{members.length ? `${members.length} ${words.teamReady}` : words.chooseMembers}</span></div>
      <div class="settings-footbar-actions"><Button class="primary-button" variant="primary" disabled={submitting || !title.trim() || !members.length} onclick={() => void save()}>{submitting ? words.saving : selected ? words.save : words.create}</Button></div>
    </div>
  {:else if !selected}
    <div class="room-empty"><p class="room-metadata">{words.empty}</p></div>
  {:else if view}
    <ChatMessagesPane messages={transcript} {copy} {endpoint} stickKey={selectedSession}
      formatTime={value => formatMessageTime(value, copy.groupYesterday)}
      {liveResponses} sending={active.length > 0} emptyTitle={view.room.title} emptyHint={words.placeholder}
      {attachmentActions} messageActions={{copiedId, onCopy: copyMessage, replyLabel: words.reply, executeLabel: words.execute,
        onReply: message => replyToId = message.id ?? "",
        onExecute: message => {targets = message.authorAgentId ? [message.authorAgentId] : []; replyToId = message.id ?? "";}}}>
      {#each view.executions.filter(e => e.status !== "completed") as execution (execution.id)}
        {#if ["failed", "interrupted", "paused"].includes(execution.status) || (execution.status === "running" && input.trim())}<OverflowMenu label={`${agents.find(a => a.id === execution.agentId)?.name ?? execution.agentId} · ${words[execution.status]}`} variant="inline"><svelte:fragment slot="trigger">{agents.find(a => a.id === execution.agentId)?.name ?? execution.agentId} · {words[execution.status]}</svelte:fragment>
          {#if ["running", "waiting_approval", "queued", "paused"].includes(execution.status)}<button type="button" class="overflow-menu-item" onclick={() => void action("stop", execution)}>{words.stop}</button>{/if}
          {#if ["failed", "interrupted", "paused"].includes(execution.status)}<button type="button" class="overflow-menu-item" onclick={() => void action("resume", execution)}>{words.resume}</button>{/if}
          {#if execution.status === "running" && input.trim()}<button type="button" class="overflow-menu-item" onclick={() => void action("steer", execution)}>{words.steer}</button>{/if}
        </OverflowMenu>{/if}
          {#each execution.operations?.filter(op => op.status === "unknown") ?? [] as operation (operation.id)}
            <p class="onboarding-error">{words.unknown} {operation.description}</p>
            {#if ["failed", "interrupted"].includes(execution.status)}
              <div class="room-actions"><Button class="secondary-button" onclick={() => void actOnDesktopRoom(endpoint, { action: "reconcile", roomId: selected, executionId: execution.id, operationId: operation.id, outcome: "completed" }).then(() => reload()).catch(e => { error = String(e); })}>{locale === "zh-CN" ? "已核对：操作已完成" : "Verified: operation completed"}</Button><Button class="secondary-button" onclick={() => void actOnDesktopRoom(endpoint, { action: "reconcile", roomId: selected, executionId: execution.id, operationId: operation.id, outcome: "failed" }).then(() => reload()).catch(e => { error = String(e); })}>{locale === "zh-CN" ? "已核对：未完成，可重试" : "Verified: not completed, retry allowed"}</Button></div>
            {/if}
          {/each}
        {#if execution.status === "waiting_approval"}
          <ApprovalCard cardId={execution.approvalId ?? execution.id} title={copy.approvalTitle} subtitle={execution.approval?.displayName ?? execution.agentId}
            reasonLabel={copy.approvalReason} command={execution.approval?.command ?? ""} reason={execution.approval?.reason ?? ""} payload={undefined}
            options={[{id:"approve_once", label:words.approve}, {id:"reject", label:words.reject}]} defaultOptionId="approve_once"
            waitingLabel={copy.approvalWaiting} secondsLabel={copy.approvalWaitingSeconds} minutesLabel={copy.approvalWaitingMinutes}
            onResolve={decision => void approve(execution, decision === "reject" ? "reject" : "approve_once")} />
        {/if}
      {/each}
    </ChatMessagesPane>
    <input type="file" multiple hidden bind:this={fileInput} onchange={() => { addFiles(Array.from(fileInput.files ?? [])); fileInput.value = ""; }} />
    <ChatInputArea floating={true} {mentionSuggestions} {copy} {locale} {endpoint} projectId={view.room.projectId ?? ""} bind:value={input}
      pendingFiles={files} {pendingAudioUrls} {inferAttachmentKind} {recording} {recordingSeconds} {recordingError}
      {onToggleRecording} {onFinishRecording} {onDismissRecordingError} {onOpenSettings}
      modelOptions={roomModelOptions} activeModelKey={modelKey} {activeModelLabel}
      activeModelTitle={activeModel?.label || words.memberModels} thinkingLevel={effectiveThinking} thinkingLevelOptions={thinkingOptions} thinkingLevelLabel={thinkingLabel} {autoAvailable}
      onChangeModel={value => modelKey = value} onChangeThinking={value => thinking = value}
      canSend={Boolean(input.trim() || files.length) && !submitting} disabled={submitting}
      sending={active.some(e => e.status === "running" || e.status === "waiting_approval")}
      fileToolDisabled={submitting} recordingToolDisabled={submitting} placeholder={words.placeholder}
      onSend={() => void send()} onStop={() => void action("stop")}
      onKeydown={event => { if (shouldSubmitComposer(event)) { event.preventDefault(); void send(); } }}
      onPasteFiles={addFiles} onPickFiles={() => fileInput?.click()} onRemoveFile={index => files = files.filter((_, i) => i !== index)}
      onRemoveQueued={() => {}} {error} onDismissError={() => error = ""}>
      <svelte:fragment slot="mention">
        <BotMention mode="select" bots={participants.map(agent => ({id: agent.id, name: agent.name, subtitle: agent.description}))}
          selectedId={recipients[0] ?? view.room.primaryAgentId} onSelect={id => targets = [id]}
          labels={{chooseHint: words.primary, lockedHint: words.primary}} />
      </svelte:fragment>
      {#if recipients.length > 1}<div class="composer-edit-banner" title={words.limits}><span>{recipients.map(id => agents.find(a => a.id === id)?.name ?? id).join(" · ")} · {words.discussion}</span></div>{/if}
      {#if reply}<div class="composer-edit-banner"><span class="room-quote">{reply.content.slice(0, 160)}</span><Button class="secondary-button" onclick={() => replyToId = ""}>{words.cancelReply}</Button></div>{/if}
    </ChatInputArea>
  {/if}
</section>
