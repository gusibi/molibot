<script lang="ts">
  import type { DesktopMemoryCandidate, DesktopMemoryItem } from "@molibot/desktop-contract";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import type { Translation } from "../i18n";
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
    saveMemoryItem,
    restoreMemoryState
  } from "../stores/memory.svelte";
  import { compactMemoryText, memoryTopicFor, projectMemoryCenter, splitPendingCandidates, type MemoryTopicId } from "./memoryCenter";

  type MemoryCenterTab = "overview" | "topics" | "all";

  let activeTab = $state<MemoryCenterTab>("overview");
  let selectedTopic = $state<MemoryTopicId>("projects");
  let allTopicFilter = $state<MemoryTopicId | null>(null);
  let showAllCandidates = $state(false);
  let agentCandidatesOpen = $state(false);
  let advancedOpen = $state(false);

  const center = $derived(projectMemoryCenter(memoryStore.items, memoryStore.candidates, memoryStore.profile));
  const selectedTopicData = $derived(center.topics.find((topic) => topic.id === selectedTopic) ?? center.topics[0]);
  const candidateGroups = $derived(splitPendingCandidates(center.pendingCandidates));
  const visibleOwnerCandidates = $derived(showAllCandidates ? candidateGroups.aboutOwner : candidateGroups.aboutOwner.slice(0, 3));
  const filteredAllItems = $derived(allTopicFilter ? memoryStore.items.filter((item) => memoryTopicFor(item) === allTopicFilter) : memoryStore.items);
  const filteredMemoryRejections = $derived(
    memoryStore.rejections.filter((item) => !memoryStore.rejectionQuery.trim() || [item.reason, item.content, item.channel, item.externalUserId, item.tags.join(",")].join("\n").toLowerCase().includes(memoryStore.rejectionQuery.trim().toLowerCase()))
  );
  const topicCopy = $derived<Record<MemoryTopicId, { label: string; description: string; icon: string }>>({
    projects: { label: session.text.memoryTopicProjects, description: session.text.memoryTopicProjectsHint, icon: "briefcase" },
    technology: { label: session.text.memoryTopicTechnology, description: session.text.memoryTopicTechnologyHint, icon: "code" },
    design: { label: session.text.memoryTopicDesign, description: session.text.memoryTopicDesignHint, icon: "pencil-simple" },
    wellness: { label: session.text.memoryTopicWellness, description: session.text.memoryTopicWellnessHint, icon: "heart" },
    content: { label: session.text.memoryTopicContent, description: session.text.memoryTopicContentHint, icon: "notebook" },
    habits: { label: session.text.memoryTopicHabits, description: session.text.memoryTopicHabitsHint, icon: "calendar-check" }
  });

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== memoryStore.endpoint) void loadMemory(session.endpoint);
  });

  $effect(() => {
    const memoryId = localStorage.getItem("molibot-desktop-memory-focus") ?? "";
    if (!memoryId || memoryStore.items.length === 0) return;
    const item = memoryStore.items.find((candidate) => candidate.id === memoryId);
    localStorage.removeItem("molibot-desktop-memory-focus");
    if (!item) return;
    activeTab = "all";
    void beginMemoryEdit(item);
  });

  function replaceCount(template: string, count: number): string {
    return template.replace("{count}", String(count));
  }

  function profileMetaText(): string {
    const meta = center.profileMeta?.stablePreferences;
    if (!meta) return replaceCount(session.text.memoryUnderstandingMeta, center.summarySourceCount);
    return session.text.memoryUnderstandingMeta
      .replace("{count}", String(meta.selectedCount))
      .replace("{scanned}", String(meta.scannedCount))
      .replace("{excluded}", String(meta.excludedCount))
      .replace("{truncated}", meta.truncated ? session.text.yes : session.text.no);
  }

  function formatMemoryDate(value: string | undefined, locale: string): string {
    if (!value) return session.text.unavailable;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
    if (days === 0) return session.text.memoryToday;
    if (days === 1) return session.text.memoryYesterday;
    if (days < 7) return replaceCount(session.text.memoryDaysAgo, days);
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  }

  function confidenceLabel(item: DesktopMemoryItem, copy: Translation): string {
    if (typeof item.confidence === "number") return item.confidence >= 0.8 ? copy.memoryConfidenceHigh : item.confidence >= 0.55 ? copy.memoryConfidenceMedium : copy.memoryConfidenceLow;
    const sourceCount = item.sources?.length ?? 0;
    return sourceCount > 1 ? replaceCount(copy.memorySourcesCount, sourceCount) : copy.memoryStoredFact;
  }

  function factIcon(item: DesktopMemoryItem): string {
    if (item.type === "task") return "target";
    if (item.type === "skill") return "stack";
    if (item.type === "event") return "flag";
    if (item.type === "user_preference") return "heart";
    return "bookmark-simple";
  }

  function openTopicMemories(topic: MemoryTopicId): void {
    allTopicFilter = topic;
    activeTab = "all";
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.memoryUnavailable}</p></div></div>
{:else if memoryStore.loading || !memoryStore.memory}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <section class="memory-center-shell" aria-label={session.text.memory}>
    <div class="memory-center-toolbar">
      <nav class="memory-center-tabs" aria-label={session.text.memoryCenterViews}>
        <button type="button" class:active={activeTab === "overview"} aria-current={activeTab === "overview" ? "page" : undefined} onclick={() => activeTab = "overview"}>{session.text.memoryOverview}</button>
        <button type="button" class:active={activeTab === "topics"} aria-current={activeTab === "topics" ? "page" : undefined} onclick={() => activeTab = "topics"}>{session.text.memoryTopics}</button>
        <button type="button" class:active={activeTab === "all"} aria-current={activeTab === "all" ? "page" : undefined} onclick={() => activeTab = "all"}>{session.text.memoryAll}</button>
      </nav>
      <span class="memory-runtime-state" data-enabled={memoryStore.memory.enabled}>
        <i class={memoryStore.memory.enabled ? "ph-fill ph-check-circle" : "ph ph-warning-circle"} aria-hidden="true"></i>
        {memoryStore.memory.enabled ? session.text.memoryEnabledStatus : session.text.memoryDisabledStatus}
      </span>
      <button class="secondary-button memory-advanced-button" type="button" onclick={() => advancedOpen = true}>
        <i class="ph ph-sliders-horizontal" aria-hidden="true"></i>{session.text.memoryAdvanced}
      </button>
    </div>

    {#if activeTab === "overview"}
      <div class="memory-overview" data-memory-view="overview">
        <header class="memory-profile-intro">
          <i class="ph ph-user-circle" aria-hidden="true"></i>
          <div class="memory-profile-copy">
            <div>
              <p class="memory-eyebrow">{session.text.memoryUnderstandingEyebrow}</p>
              <h3>{session.text.memoryUnderstandingTitle}</h3>
            </div>
            <p>{center.summary || session.text.memoryUnderstandingEmpty}</p>
            <span><i class="ph ph-chat-circle-dots" aria-hidden="true"></i>{profileMetaText()}</span>
          </div>
        </header>

        <div class="memory-overview-grid">
          <section class="memory-overview-panel">
            <header><div><i class="ph ph-crosshair" aria-hidden="true"></i><h4>{session.text.memoryCurrentFocus}</h4></div></header>
            {#if center.currentFocus.length === 0}
              <p class="memory-panel-empty">{session.text.memoryNoCurrentFocus}</p>
            {:else}
              <ul class="memory-reading-list">
                {#each center.currentFocus as item (item.id)}
                  <li><button type="button" onclick={() => void beginMemoryEdit(item)}>{compactMemoryText(item.content, 92)}<i class="ph ph-caret-right" aria-hidden="true"></i></button></li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="memory-overview-panel">
            <header><div><i class="ph ph-warning-circle" aria-hidden="true"></i><h4>{session.text.memoryNeedsAttention}</h4></div></header>
            {#if center.attentionItems.length === 0}
              <p class="memory-panel-empty">{session.text.memoryNoAttention}</p>
            {:else}
              <ul class="memory-reading-list">
                {#each center.attentionItems as item (item.id)}
                  <li><button type="button" onclick={() => void beginMemoryEdit(item)}>{compactMemoryText(item.content, 72)}</button>{#if (item.state === "disputed" || item.state === "dormant") && !item.privacySuppressed}<button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void restoreMemoryState(item)}>{session.text.memoryRestoreState}</button>{/if}</li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="memory-overview-panel">
            <header><div><i class="ph ph-clock-counter-clockwise" aria-hidden="true"></i><h4>{session.text.memoryRecent}</h4></div><button type="button" onclick={() => activeTab = "all"}>{session.text.memoryViewAll}</button></header>
            {#if center.recentItems.length === 0}
              <p class="memory-panel-empty">{session.text.memoryNoRecent}</p>
            {:else}
              <ol class="memory-recent-list">
                {#each center.recentItems as item (item.id)}
                  <li><button type="button" onclick={() => void beginMemoryEdit(item)}><span>{compactMemoryText(item.content, 70)}</span><time>{formatMemoryDate(item.updatedAt, session.locale)}</time></button></li>
                {/each}
              </ol>
            {/if}
          </section>

          <section class="memory-overview-panel">
            <header><div><i class="ph ph-heart" aria-hidden="true"></i><h4>{session.text.memoryStablePreferences}</h4></div></header>
            {#if center.stablePreferences.length === 0}
              <p class="memory-panel-empty">{session.text.memoryNoStablePreferences}</p>
            {:else}
              <dl class="memory-preference-list">
                {#each center.stablePreferences as item (item.id)}
                  <div><dt>{item.subject || item.type || session.text.memoryStoredFact}</dt><dd>{compactMemoryText(item.content, 76)}</dd></div>
                {/each}
              </dl>
            {/if}
          </section>

          <section class="memory-overview-panel memory-pending-panel">
            {#snippet candidateRow(candidate: DesktopMemoryCandidate)}
              <article>
                <button class="memory-candidate-copy" type="button" onclick={() => beginCandidateEdit(candidate)}>
                  <strong>{compactMemoryText(candidate.value, 92)}</strong>
                  <span>{session.text.memoryRecordedAt} {formatMemoryDate(candidate.updatedAt, session.locale)}</span>
                </button>
                <div>
                  <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void confirmMemoryCandidate(candidate)}>{candidate.skillDraftSuggestion ? session.text.memorySkillDraftConfirm : session.text.memoryCandidateConfirm}</button>
                  <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void ignoreMemoryCandidate(candidate)}>{session.text.memoryCandidateInaccurate}</button>
                </div>
              </article>
            {/snippet}
            <header><div><i class="ph ph-tray" aria-hidden="true"></i><h4>{session.text.memoryPendingReview}</h4><span>{center.pendingCandidates.length}</span></div>{#if candidateGroups.aboutOwner.length > 3}<button type="button" onclick={() => showAllCandidates = !showAllCandidates}>{showAllCandidates ? session.text.memoryViewLess : session.text.memoryViewAll}</button>{/if}</header>
            {#if center.pendingCandidates.length === 0}
              <p class="memory-panel-empty">{session.text.memoryNoCandidates}</p>
            {:else}
              {#if candidateGroups.aboutOwner.length > 0}
                {#if candidateGroups.agentLearnings.length > 0}
                  <p class="memory-candidate-group-label">{session.text.memoryCandidateGroupOwner}</p>
                {/if}
                <div class="memory-candidate-list">
                  {#each visibleOwnerCandidates as candidate (candidate.id)}
                    {@render candidateRow(candidate)}
                  {/each}
                </div>
              {/if}
              {#if candidateGroups.agentLearnings.length > 0}
                <button class="memory-candidate-group-toggle" type="button" aria-expanded={agentCandidatesOpen} onclick={() => agentCandidatesOpen = !agentCandidatesOpen}>
                  <i class={`ph ph-caret-${agentCandidatesOpen ? "down" : "right"}`} aria-hidden="true"></i>
                  <span>{session.text.memoryCandidateGroupAgent}</span>
                  <small>{candidateGroups.agentLearnings.length}</small>
                </button>
                {#if agentCandidatesOpen}
                  <div class="memory-candidate-list">
                    {#each candidateGroups.agentLearnings as candidate (candidate.id)}
                      {@render candidateRow(candidate)}
                    {/each}
                  </div>
                {/if}
              {/if}
            {/if}
          </section>
        </div>
      </div>
    {:else if activeTab === "topics"}
      <div class="memory-topic-workspace" data-memory-view="topics">
        <aside class="memory-topic-list" aria-label={session.text.memoryTopics}>
          {#each center.topics as topic (topic.id)}
            <button type="button" class:active={selectedTopic === topic.id} aria-current={selectedTopic === topic.id ? "true" : undefined} onclick={() => selectedTopic = topic.id}>
              <i class={`ph ph-${topicCopy[topic.id].icon}`} aria-hidden="true"></i>
              <span><strong>{topicCopy[topic.id].label}</strong><small>{replaceCount(session.text.memoryTopicCount, topic.items.length)} · {formatMemoryDate(topic.updatedAt, session.locale)}</small></span>
            </button>
          {/each}
        </aside>

        <section class="memory-topic-detail">
          <header class="memory-topic-heading">
            <div><p>{session.text.memoryTopicEyebrow}</p><h3>{topicCopy[selectedTopic].label}</h3><span>{topicCopy[selectedTopic].description}</span></div>
            {#if selectedTopicData}<button class="secondary-button" type="button" disabled={selectedTopicData.items.length === 0} onclick={() => openTopicMemories(selectedTopic)}>{session.text.memoryViewUnderlying}</button>{/if}
          </header>

          {#if !selectedTopicData || selectedTopicData.items.length === 0}
            <div class="memory-topic-empty"><i class={`ph ph-${topicCopy[selectedTopic].icon}`} aria-hidden="true"></i><strong>{session.text.memoryNoTopicMemories}</strong><p>{session.text.memoryNoTopicMemoriesHint}</p></div>
          {:else}
            <section class="memory-agent-summary">
              <h4>{session.text.memoryAgentSummary}</h4>
              <p>{selectedTopicData.items.slice(0, 3).map((item) => compactMemoryText(item.content, 100)).join("；")}</p>
            </section>
            <section class="memory-key-facts">
              <header><h4>{session.text.memoryKeyFacts}</h4><span>{replaceCount(session.text.memoryTopicCount, selectedTopicData.items.length)}</span></header>
              <div>
                {#each selectedTopicData.items.slice(0, 5) as item (item.id)}
                  <button class="memory-fact-row" type="button" onclick={() => void beginMemoryEdit(item)}>
                    <i class={`ph ph-${factIcon(item)}`} aria-hidden="true"></i>
                    <span class="memory-fact-kind">{item.subject || item.type || session.text.memoryStoredFact}</span>
                    <strong>{compactMemoryText(item.content, 108)}</strong>
                    <span class="memory-fact-trust" data-level={typeof item.confidence === "number" && item.confidence < 0.55 ? "low" : typeof item.confidence === "number" && item.confidence < 0.8 ? "medium" : "high"}><i aria-hidden="true"></i>{confidenceLabel(item, session.text)}</span>
                    <time>{formatMemoryDate(item.updatedAt, session.locale)}</time>
                    <i class="ph ph-caret-right" aria-hidden="true"></i>
                  </button>
                {/each}
              </div>
              <button class="memory-view-topic" type="button" onclick={() => openTopicMemories(selectedTopic)}>{replaceCount(session.text.memoryViewTopicMemories, selectedTopicData.items.length)}<i class="ph ph-arrow-right" aria-hidden="true"></i></button>
            </section>
            {#if selectedTopicData.relatedEntities.length > 0}
              <section class="memory-related-entities">
                <header><h4>{session.text.memoryRelatedEntities}</h4></header>
                <div>
                  {#each selectedTopicData.relatedEntities as entity (entity.label)}
                    <article>
                      <i class="ph ph-tag" aria-hidden="true"></i>
                      <span><strong>{entity.label}</strong><small>{entity.detail}</small></span>
                      <em>{replaceCount(session.text.memoryRelatedCount, entity.count)}</em>
                    </article>
                  {/each}
                </div>
              </section>
            {/if}
          {/if}
        </section>
      </div>
    {:else}
      <div class="memory-all-view" data-memory-view="all">
        <div class="memory-all-toolbar">
          <div><strong>{session.text.memoryRecords}</strong><span>{filteredAllItems.length}</span></div>
          <div class="memory-all-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input aria-label={session.text.memorySearch} bind:value={memoryStore.query} placeholder={session.text.memorySearchHint} onkeydown={(event) => event.key === "Enter" && void refreshMemoryRecords()} /><button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void refreshMemoryRecords()}>{session.text.memorySearchButton}</button></div>
        </div>
        {#if allTopicFilter}
          <div class="memory-filter-chip"><span>{session.text.memoryTopicFilter}: {topicCopy[allTopicFilter].label}</span><button type="button" aria-label={session.text.memoryClearFilter} onclick={() => allTopicFilter = null}><i class="ph ph-x" aria-hidden="true"></i></button></div>
        {/if}
        <div class="memory-all-list">
          {#if filteredAllItems.length === 0}
            <p class="memory-panel-empty">{session.text.memoryNoRecords}</p>
          {:else}
            {#each filteredAllItems as item (item.id)}
              <article class="memory-record">
                <button class="memory-record-main" type="button" onclick={() => void beginMemoryEdit(item)}>
                  <strong>{item.content}</strong>
                  <span>{item.domain ?? "chat"} · {item.type ?? item.layer}{item.hasConflict ? ` · ${session.text.memoryConflict}` : ""}{item.pinned ? ` · ${session.text.memoryPinned}` : ""}</span>
                  <span>{item.allowInjection === false ? session.text.memoryInjectionDisabled : session.text.memoryInjectionEnabled} · {formatMemoryDate(item.updatedAt, session.locale)}</span>
                  {#if item.tags.length}<span class="memory-record-tags">{#each item.tags as tag}<em>{tag}</em>{/each}</span>{/if}
                </button>
                <div class="memory-record-actions"><button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void beginMemoryEdit(item)}>{session.text.channelEdit}</button><button class="secondary-button danger-action" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void deleteMemoryItem(item)}>{session.text.channelDelete}</button></div>
              </article>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </section>

  {#if memoryStore.candidateEdit}
    <Dialog
      open={Boolean(memoryStore.candidateEdit)}
      busy={Boolean(memoryStore.busyAction)}
      contentClass="memory-detail-modal"
      labelledBy="memory-candidate-edit-title"
      onOpenChange={(next) => { if (!next) memoryStore.candidateEdit = null; }}
    >
      <form class="memory-detail-form" onsubmit={(event) => { event.preventDefault(); if (memoryStore.candidateEdit) void confirmMemoryCandidate(memoryStore.candidateEdit); }}>
        <header class="entity-editor-head"><div><strong id="memory-candidate-edit-title">{session.text.memoryCandidateEdit}</strong><p>{memoryStore.candidateEdit.createdAt.replace("T", " ").slice(0, 19)}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (memoryStore.candidateEdit = null)}><i class="ph ph-x"></i></button></header>
        <div class="modal-body settings-form">
          <label class="settings-field settings-field-wide"><span>{session.text.memoryContent}</span><textarea rows="6" bind:value={memoryStore.candidateEdit.value}></textarea></label>
          <label class="settings-field"><span>{session.text.memoryCandidateNamespace}</span><input bind:value={memoryStore.candidateEdit.namespace} /></label>
          <label class="settings-field"><span>{session.text.memoryCandidateDomain}</span><input bind:value={memoryStore.candidateEdit.domain} /></label>
          <label class="settings-field"><span>{session.text.memoryCandidateType}</span><input bind:value={memoryStore.candidateEdit.type} /></label>
          <label class="settings-field"><span>{session.text.memoryCandidateSubject}</span><input bind:value={memoryStore.candidateEdit.subject} /></label>
          <label class="settings-field settings-field-wide"><span>{session.text.memoryCandidateReason}</span><input bind:value={memoryStore.candidateEdit.reason} /></label>
          {#if memoryStore.candidateEdit.skillDraftSuggestion}
            <div class="settings-field settings-field-wide">
              <span>{session.text.memorySkillDraftReview}</span>
              <p>{memoryStore.candidateEdit.skillDraftSuggestion.description}</p>
              <p>{session.text.memorySkillDraftInputs}: {memoryStore.candidateEdit.skillDraftSuggestion.inputs.join("; ")}</p>
              <p>{session.text.memorySkillDraftOutputs}: {memoryStore.candidateEdit.skillDraftSuggestion.outputs.join("; ")}</p>
              <p>{session.text.memorySkillDraftBoundaries}: {memoryStore.candidateEdit.skillDraftSuggestion.boundaries.join("; ")}</p>
            </div>
          {/if}
        </div>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={() => (memoryStore.candidateEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(memoryStore.busyAction) || !memoryStore.candidateEdit.value.trim()}>{memoryStore.candidateEdit.skillDraftSuggestion ? session.text.memorySkillDraftConfirm : session.text.memoryCandidateConfirm}</button></footer>
      </form>
    </Dialog>
  {/if}

  {#if memoryStore.memoryEdit}
    <Dialog
      open={Boolean(memoryStore.memoryEdit)}
      busy={Boolean(memoryStore.busyAction)}
      contentClass="memory-detail-modal"
      labelledBy="memory-edit-title"
      onOpenChange={(next) => { if (!next) memoryStore.memoryEdit = null; }}
    >
      <form id="desktop-memory-form" class="memory-detail-form" aria-label={session.text.memory} onsubmit={(event) => { event.preventDefault(); if (memoryStore.memoryEdit) void saveMemoryItem(memoryStore.memoryEdit); }}>
        <header class="entity-editor-head"><div><strong id="memory-edit-title">{session.text.memory}</strong><p>{memoryStore.memoryEdit.channel}:{memoryStore.memoryEdit.externalUserId}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={Boolean(memoryStore.busyAction)} onclick={() => (memoryStore.memoryEdit = null)}><i class="ph ph-x"></i></button></header>
        <div class="modal-body memory-detail-body">
          <div class="settings-form">
            <label class="settings-field settings-field-wide"><span>{session.text.memoryContent}</span><textarea rows="7" bind:value={memoryStore.memoryEdit.content}></textarea></label>
            <label class="settings-field"><span>{session.text.memoryTags}</span><input value={memoryStore.memoryEdit.tags.join(",")} oninput={(event) => { if (memoryStore.memoryEdit) memoryStore.memoryEdit = { ...memoryStore.memoryEdit, tags: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean) }; }} /></label>
            <label class="settings-field"><span>{session.text.memoryExpires}</span><input bind:value={memoryStore.memoryEdit.expiresAt} /></label>
          </div>
          <div class="settings-row"><strong>{session.text.memoryPinned}</strong><IosSwitch
  checked={Boolean(memoryStore.memoryEdit.pinned)}
  ariaLabel={session.text.memoryPinned}
  onCheckedChange={(checked) => { if (memoryStore.memoryEdit) memoryStore.memoryEdit.pinned = checked; }}
/></div>
          <div class="settings-row"><div class="profile-info"><strong>{session.text.memoryAllowInjection}</strong><p>{session.text.memoryAllowInjectionHint}</p></div><IosSwitch
  checked={memoryStore.memoryEdit.allowInjection !== false}
  ariaLabel={session.text.memoryAllowInjection}
  onCheckedChange={(checked) => { if (memoryStore.memoryEdit) memoryStore.memoryEdit.allowInjection = checked; }}
/></div>
          {#if memoryStore.memoryEdit.reason}<div class="settings-row"><div class="profile-info"><strong>{session.text.memoryReason}</strong><p>{memoryStore.memoryEdit.reason}</p></div></div>{/if}
          {#if memoryStore.memoryEdit.sources?.length}<div class="settings-row"><div class="profile-info"><strong>{session.text.memorySources}</strong>{#each memoryStore.memoryEdit.sources as source}<p>{source.channel} · {source.sessionId} · {source.conversationMessageId} <button class="secondary-button" type="button" onclick={() => void openMemorySource(source)}>{session.text.memoryOpenSource}</button></p>{/each}</div></div>{/if}
          <div class="settings-row"><div class="profile-info"><strong>{session.text.memoryVersions} · {memoryStore.memoryVersions.length}</strong>{#each memoryStore.memoryVersions as version}<p>{version.updatedAt.replace("T", " ").slice(0, 19)} · {version.content}</p>{/each}</div></div>
        </div>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => (memoryStore.memoryEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(memoryStore.busyAction) || !memoryStore.memoryEdit.content.trim()}>{memoryStore.busyAction ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
      </form>
    </Dialog>
  {/if}

  {#if memoryStore.sourcePreview}
    <Dialog
      open={Boolean(memoryStore.sourcePreview)}
      contentClass="memory-detail-modal"
      labelledBy="memory-source-preview-title"
      onOpenChange={(next) => { if (!next) memoryStore.sourcePreview = null; }}
    >
      <header class="entity-editor-head"><div><strong id="memory-source-preview-title">{session.text.memorySourcePreview}</strong><p>{memoryStore.sourcePreview.sessionId}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (memoryStore.sourcePreview = null)}><i class="ph ph-x"></i></button></header><div class="modal-body memory-source-list">{#each memoryStore.sourcePreview.messages as message}<article><strong>{message.role} · {message.createdAt.replace("T", " ").slice(0, 19)}{message.selected ? " · ←" : ""}</strong><p>{message.content}</p></article>{/each}</div>
    </Dialog>
  {/if}

  {#if advancedOpen}
    <Dialog
      open={advancedOpen}
      busy={Boolean(memoryStore.busyAction)}
      contentClass="memory-advanced-modal"
      labelledBy="memory-advanced-title"
      describedBy="memory-advanced-hint"
      onOpenChange={(next) => { if (!next) advancedOpen = false; }}
    >
      <header class="entity-editor-head"><div><strong id="memory-advanced-title">{session.text.memoryAdvanced}</strong><p id="memory-advanced-hint">{session.text.memoryAdvancedHint}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => advancedOpen = false}><i class="ph ph-x"></i></button></header>
        <div class="modal-body memory-advanced-body">
          <section class="settings-card">
            <div class="settings-row"><strong>{session.text.memoryRuntimeEnabled}</strong><span class="status-badge" data-state={memoryStore.memory.enabled ? "ready" : "disconnected"}>{memoryStore.memory.enabled ? session.text.yes : session.text.no}</span></div>
            <div class="settings-row"><strong>{session.text.memoryConfigEnabled}</strong><span class="status-badge" data-state={memoryStore.memory.configEnabled ? "ready" : "disconnected"}>{memoryStore.memory.configEnabled ? session.text.yes : session.text.no}</span></div>
            <div class="settings-row"><strong>{session.text.memoryBackend}</strong><span class="diag-value">{memoryStore.memory.backend || session.text.unavailable}</span></div>
          </section>
          <section class="settings-card">
            <div class="settings-row"><strong>{session.text.memoryCapHybrid}</strong><span>{memoryStore.memory.capabilities.hybridSearch ? session.text.yes : session.text.no}</span></div>
            <div class="settings-row"><strong>{session.text.memoryCapVector}</strong><span>{memoryStore.memory.capabilities.vectorSearch ? session.text.yes : session.text.no}</span></div>
            <div class="settings-row"><strong>{session.text.memoryCapFlush}</strong><span>{memoryStore.memory.capabilities.incrementalFlush ? session.text.yes : session.text.no}</span></div>
            <div class="settings-row"><strong>{session.text.memoryCapLayered}</strong><span>{memoryStore.memory.capabilities.layeredMemory ? session.text.yes : session.text.no}</span></div>
          </section>
          <section class="settings-card provider-editor">
            <div class="provider-editor-toolbar"><strong>{session.text.memoryOperations}</strong></div>
            <div class="settings-form">
              <label class="settings-field"><span>{session.text.memoryChannel}</span><input bind:value={memoryStore.channel} placeholder={session.text.memoryChannelPlaceholder} /></label>
              <label class="settings-field"><span>{session.text.memoryUserId}</span><input bind:value={memoryStore.userId} placeholder={session.text.memoryUserIdPlaceholder} /></label>
              <label class="settings-field settings-field-wide"><span>{session.text.memorySearch}</span><input bind:value={memoryStore.query} placeholder={session.text.memorySearchHint} /></label>
            </div>
            <div class="settings-row"><strong>{session.text.memoryAllScopes}</strong><IosSwitch
  checked={memoryStore.allScopes}
  ariaLabel={session.text.memoryAllScopes}
  onCheckedChange={(checked) => { memoryStore.allScopes = checked; }}
/></div>
            <div class="provider-inline-options">
              <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void refreshMemoryRecords()}>{session.text.memorySearchButton}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("sync")}>{session.text.memorySync}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("flush")}>{session.text.memoryFlush}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("compact")}>{session.text.memoryCompact}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("backfill-embeddings")}>{session.text.memoryBackfill}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryStore.busyAction)} onclick={() => void runMemoryMaintenance("migrate-json-file")}>{session.text.memoryMigrate}</button>
            </div>
          </section>
          <section class="settings-card provider-editor">
            <div class="provider-editor-toolbar"><strong>{session.text.memoryRejections} · {memoryStore.rejections.length}</strong></div>
            <label class="settings-field settings-field-wide memory-rejection-search"><span>{session.text.memoryRejectionSearch}</span><input bind:value={memoryStore.rejectionQuery} /></label>
            {#if filteredMemoryRejections.length === 0}<div class="settings-row"><p>{session.text.memoryNoRejections}</p></div>{:else}{#each filteredMemoryRejections as item, index (`${item.createdAt}:${index}`)}<article class="memory-rejection-item"><strong>{item.action} · {item.channel}:{item.externalUserId}</strong><span>{item.createdAt?.replace("T", " ").slice(0, 19)} · {item.reason}</span><p>{item.content || session.text.unavailable}</p></article>{/each}{/if}
          </section>
          {#if memoryStore.actionMessage}<p class="settings-action-message">{memoryStore.actionMessage}</p>{/if}
        </div>
    </Dialog>
  {/if}
{/if}
