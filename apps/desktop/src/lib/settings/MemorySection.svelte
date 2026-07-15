<script lang="ts">
  import { session } from "../stores/session.svelte";
  import {
    memoryStore,
    beginCandidateEdit,
    beginMemoryEdit,
    deleteMemoryItem,
    confirmMemoryCandidate,
    ignoreMemoryCandidate,
    openMemorySource,
    loadMemory,
    refreshMemoryRecords,
    runMemoryMaintenance,
    saveMemoryItem
  } from "../stores/memory.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== memoryStore.endpoint) {
      void loadMemory(session.endpoint);
    }
  });

  const filteredMemoryRejections = $derived(
    memoryStore.rejections.filter((item) => !memoryStore.rejectionQuery.trim() || [item.reason, item.content, item.channel, item.externalUserId, item.tags.join(",")].join("\n").toLowerCase().includes(memoryStore.rejectionQuery.trim().toLowerCase()))
  );
</script>

<p class="settings-section-hint">{session.text.memoryHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.memoryUnavailable}</p></div></div>
{:else if memoryStore.loading || !memoryStore.memory}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.memoryRuntimeEnabled}</strong><span class="status-badge" data-state={memoryStore.memory.enabled ? "ready" : "disconnected"}>{memoryStore.memory.enabled ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.memoryConfigEnabled}</strong><span class="status-badge" data-state={memoryStore.memory.configEnabled ? "ready" : "disconnected"}>{memoryStore.memory.configEnabled ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.memoryBackend}</strong><span class="diag-value">{memoryStore.memory.backend || session.text.unavailable}</span></div>
  </div>
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.memoryCapHybrid}</strong><span class="status-badge" data-state={memoryStore.memory.capabilities.hybridSearch ? "ready" : "disconnected"}>{memoryStore.memory.capabilities.hybridSearch ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.memoryCapVector}</strong><span class="status-badge" data-state={memoryStore.memory.capabilities.vectorSearch ? "ready" : "disconnected"}>{memoryStore.memory.capabilities.vectorSearch ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.memoryCapFlush}</strong><span class="status-badge" data-state={memoryStore.memory.capabilities.incrementalFlush ? "ready" : "disconnected"}>{memoryStore.memory.capabilities.incrementalFlush ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.memoryCapLayered}</strong><span class="status-badge" data-state={memoryStore.memory.capabilities.layeredMemory ? "ready" : "disconnected"}>{memoryStore.memory.capabilities.layeredMemory ? session.text.yes : session.text.no}</span></div>
  </div>
  <div class="settings-card provider-editor">
    <div class="provider-editor-toolbar"><strong>{session.text.memoryCandidates} · {memoryStore.candidates.length}</strong></div>
    {#if memoryStore.candidates.length === 0}
      <div class="settings-row"><p>{session.text.memoryNoCandidates}</p></div>
    {:else}
      {#each memoryStore.candidates as candidate (candidate.id)}
        <div class="memory-record">
          <div class="settings-row"><div class="profile-info"><strong>{candidate.domain} · {candidate.type}/{candidate.subject}</strong><p>{candidate.namespace} · {Math.round(candidate.confidence * 100)}%</p><p class="memory-record-preview">{candidate.value}</p><p>{candidate.reason}</p></div><div class="settings-row-actions"><button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => beginCandidateEdit(candidate)}>{session.text.memoryCandidateEdit}</button><button class="secondary-button danger-action" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void ignoreMemoryCandidate(candidate)}>{session.text.memoryCandidateIgnore}</button></div></div>
        </div>
      {/each}
    {/if}
  </div>
  {#if memoryStore.candidateEdit}
    <form class="settings-card provider-editor" aria-label={session.text.memoryCandidateEdit} onsubmit={(event) => { event.preventDefault(); if (memoryStore.candidateEdit) void confirmMemoryCandidate(memoryStore.candidateEdit); }}>
      <header class="entity-editor-head"><div><strong>{session.text.memoryCandidateEdit}</strong><p>{memoryStore.candidateEdit.createdAt.replace("T", " ").slice(0, 19)}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (memoryStore.candidateEdit = null)}><i class="ph ph-x"></i></button></header>
      <div class="settings-form">
        <label class="settings-field settings-field-wide"><span>{session.text.memoryContent}</span><textarea rows="6" bind:value={memoryStore.candidateEdit.value}></textarea></label>
        <label class="settings-field"><span>{session.text.memoryCandidateNamespace}</span><input bind:value={memoryStore.candidateEdit.namespace} /></label>
        <label class="settings-field"><span>{session.text.memoryCandidateDomain}</span><input bind:value={memoryStore.candidateEdit.domain} /></label>
        <label class="settings-field"><span>{session.text.memoryCandidateType}</span><input bind:value={memoryStore.candidateEdit.type} /></label>
        <label class="settings-field"><span>{session.text.memoryCandidateSubject}</span><input bind:value={memoryStore.candidateEdit.subject} /></label>
        <label class="settings-field settings-field-wide"><span>{session.text.memoryCandidateReason}</span><input bind:value={memoryStore.candidateEdit.reason} /></label>
      </div>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={() => (memoryStore.candidateEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(memoryStore.busyAction) || !memoryStore.candidateEdit.value.trim()}>{session.text.memoryCandidateConfirm}</button></footer>
    </form>
  {/if}
  <div class="settings-card provider-editor">
    <div class="provider-editor-toolbar"><strong>{session.text.memoryOperations}</strong></div>
    <div class="settings-form">
      <label class="settings-field"><span>{session.text.memoryChannel}</span><input bind:value={memoryStore.channel} placeholder={session.text.memoryChannelPlaceholder} /></label>
      <label class="settings-field"><span>{session.text.memoryUserId}</span><input bind:value={memoryStore.userId} placeholder={session.text.memoryUserIdPlaceholder} /></label>
      <label class="settings-field settings-field-wide"><span>{session.text.memorySearch}</span><input bind:value={memoryStore.query} placeholder={session.text.memorySearchHint} /></label>
    </div>
    <div class="settings-row"><strong>{session.text.memoryAllScopes}</strong><button class:active={memoryStore.allScopes} class="switch" type="button" role="switch" aria-label={session.text.memoryAllScopes} aria-checked={memoryStore.allScopes} onclick={() => (memoryStore.allScopes = !memoryStore.allScopes)}><span></span></button></div>
    <div class="provider-inline-options">
      <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void refreshMemoryRecords()}>{session.text.memorySearchButton}</button>
      <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("sync")}>{session.text.memorySync}</button>
      <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("flush")}>{session.text.memoryFlush}</button>
      <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("compact")}>{session.text.memoryCompact}</button>
      <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("backfill-embeddings")}>{session.text.memoryBackfill}</button>
      <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("migrate-json-file")}>{session.text.memoryMigrate}</button>
    </div>
  </div>
  <div class="settings-card provider-editor">
    <div class="provider-editor-toolbar"><strong>{session.text.memoryRecords} · {memoryStore.items.length}</strong></div>
    {#if memoryStore.items.length === 0}
      <div class="settings-row"><p>{session.text.memoryNoRecords}</p></div>
    {:else}
      {#each memoryStore.items as item (item.id)}
        <div class="memory-record">
          <div class="settings-row"><div class="profile-info"><strong>{item.channel}:{item.externalUserId}</strong><p>{item.layer} · {item.updatedAt?.replace("T", " ").slice(0, 19)}{item.hasConflict ? ` · ${session.text.memoryConflict}` : ""}{item.pinned ? ` · ${session.text.memoryPinned}` : ""}</p><p>{item.domain ?? "chat"} · {item.type ?? "memory"}/{item.subject ?? item.id}</p><p class="memory-record-preview">{item.content}</p></div><div class="settings-row-actions"><button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void beginMemoryEdit(item)}>{session.text.channelEdit}</button><button class="secondary-button danger-action" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void deleteMemoryItem(item)}>{session.text.channelDelete}</button></div></div>
        </div>
      {/each}
    {/if}
  </div>
  {#if memoryStore.memoryEdit}
    <form id="desktop-memory-form" class="settings-card provider-editor" aria-label={session.text.memory} onsubmit={(event) => { event.preventDefault(); if (memoryStore.memoryEdit) void saveMemoryItem(memoryStore.memoryEdit); }}>
      <header class="entity-editor-head"><div><strong>{session.text.memory}</strong><p>{memoryStore.memoryEdit.channel}:{memoryStore.memoryEdit.externalUserId}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={Boolean(memoryStore.busyAction)} onclick={() => (memoryStore.memoryEdit = null)}><i class="ph ph-x"></i></button></header>
      <div class="settings-form">
        <label class="settings-field settings-field-wide"><span>{session.text.memoryContent}</span><textarea rows="8" bind:value={memoryStore.memoryEdit.content}></textarea></label>
        <label class="settings-field"><span>{session.text.memoryTags}</span><input value={memoryStore.memoryEdit.tags.join(",")} oninput={(event) => { if (memoryStore.memoryEdit) memoryStore.memoryEdit = { ...memoryStore.memoryEdit, tags: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean) }; }} /></label>
        <label class="settings-field"><span>{session.text.memoryExpires}</span><input bind:value={memoryStore.memoryEdit.expiresAt} /></label>
        <label class="settings-field"><span>{session.text.memoryPinned}</span><input type="checkbox" bind:checked={memoryStore.memoryEdit.pinned} /></label>
      </div>
      {#if memoryStore.memoryEdit.reason}<div class="settings-row"><div class="profile-info"><strong>{session.text.memoryReason}</strong><p>{memoryStore.memoryEdit.reason}</p></div></div>{/if}
      {#if memoryStore.memoryEdit.sources?.length}<div class="settings-row"><div class="profile-info"><strong>{session.text.memorySources}</strong>{#each memoryStore.memoryEdit.sources as source}<p>{source.channel} · {source.sessionId} · {source.conversationMessageId} <button class="secondary-button" type="button" onclick={() => void openMemorySource(source)}>{session.text.memoryOpenSource}</button></p>{/each}</div></div>{/if}
      <div class="settings-row"><div class="profile-info"><strong>{session.text.memoryVersions} · {memoryStore.memoryVersions.length}</strong>{#each memoryStore.memoryVersions as version}<p>{version.updatedAt.replace("T", " ").slice(0, 19)} · {version.content}</p>{/each}</div></div>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => (memoryStore.memoryEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(memoryStore.busyAction) || !memoryStore.memoryEdit.content.trim()}>{memoryStore.busyAction ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
  {/if}
  {#if memoryStore.sourcePreview}
    <div class="settings-card provider-editor"><header class="entity-editor-head"><div><strong>{session.text.memorySourcePreview}</strong><p>{memoryStore.sourcePreview.sessionId}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (memoryStore.sourcePreview = null)}><i class="ph ph-x"></i></button></header>{#each memoryStore.sourcePreview.messages as message}<div class="memory-record"><div class="profile-info"><strong>{message.role} · {message.createdAt.replace("T", " ").slice(0, 19)}{message.selected ? " · ←" : ""}</strong><p class="memory-record-preview">{message.content}</p></div></div>{/each}</div>
  {/if}
  <div class="settings-card provider-editor">
    <div class="provider-editor-toolbar"><strong>{session.text.memoryRejections} · {memoryStore.rejections.length}</strong></div>
    <label class="settings-field settings-field-wide"><span>{session.text.memoryRejectionSearch}</span><input bind:value={memoryStore.rejectionQuery} /></label>
    {#if filteredMemoryRejections.length === 0}<div class="settings-row"><p>{session.text.memoryNoRejections}</p></div>{:else}{#each filteredMemoryRejections as item, index (`${item.createdAt}:${index}`)}<div class="memory-record"><div class="settings-row"><div class="profile-info"><strong>{item.action} · {item.channel}:{item.externalUserId}</strong><p>{item.createdAt?.replace("T", " ").slice(0, 19)} · {item.reason}</p></div></div><p class="memory-rejection-content">{item.content || session.text.unavailable}</p>{#if item.tags.length}<p class="settings-section-hint">{item.tags.join(", ")}</p>{/if}</div>{/each}{/if}
  </div>
  {#if memoryStore.actionMessage}<p class="settings-action-message">{memoryStore.actionMessage}</p>{/if}
{/if}
