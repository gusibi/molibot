<script lang="ts">
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Code from "reicon-svelte/icons/Code";
  import Folder from "reicon-svelte/icons/Folder";
  import Globe from "reicon-svelte/icons/Globe";
  import Hashtag from "reicon-svelte/icons/Hashtag";
  import History from "reicon-svelte/icons/History";
  import Hourglass from "reicon-svelte/icons/Hourglass";
  import Refresh from "reicon-svelte/icons/Refresh";
  import ShieldCheck from "reicon-svelte/icons/ShieldCheck";
  import Trash from "reicon-svelte/icons/Trash";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import X from "reicon-svelte/icons/X";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { session } from "../stores/session.svelte";
  import {
    hostBashStore,
    loadHostBash,
    refreshHostBash,
    toggleHostBashWhitelist,
    deleteHostBashWhitelist,
    deleteHostBashHistory,
    type HostBashTab,
    type HostBashStatusFilter,
    type HostBashModeFilter
  } from "../stores/hostBash.svelte";
  import type { DesktopHostBashPendingRecord, DesktopHostBashWhitelistEntry } from "../api";

  let deletingWhitelistItem = $state<DesktopHostBashWhitelistEntry | null>(null);
  let deletingHistoryItem = $state<DesktopHostBashPendingRecord | null>(null);

  $effect(() => {
    if (session.serviceReady && session.endpoint) {
      if (session.endpoint !== hostBashStore.endpoint || !hostBashStore.data) {
        void loadHostBash(session.endpoint);
      }
    }
  });

  const counts = $derived(hostBashStore.data?.counts ?? {
    pending: 0,
    whitelist: 0,
    whitelistEnabled: 0,
    history: 0
  });

  const pendingList = $derived(hostBashStore.data?.pending ?? []);
  const whitelistList = $derived(hostBashStore.data?.whitelist ?? []);
  const historyList = $derived(hostBashStore.data?.history ?? []);

  function formatTime(isoStr?: string): string {
    if (!isoStr) return "-";
    try {
      const date = new Date(isoStr);
      return Number.isNaN(date.getTime()) ? isoStr : date.toLocaleString(session.locale);
    } catch {
      return isoStr;
    }
  }

  function statusTone(status: string): "ready" | "error" | "warning" | "disconnected" {
    if (status === "approved" || status === "executed") return "ready";
    if (status === "rejected" || status === "failed") return "error";
    if (status === "pending") return "warning";
    return "disconnected";
  }

  function statusLabel(status: string): string {
    if (status === "approved") return session.text.hostBashStatusApproved;
    if (status === "rejected") return session.text.hostBashStatusRejected;
    if (status === "executed") return session.text.hostBashStatusExecuted;
    if (status === "failed") return session.text.hostBashStatusFailed;
    if (status === "pending") return session.text.hostBashPending;
    return status;
  }

  function modeLabel(mode: string): string {
    if (mode === "persistent") return session.text.hostBashModePersistent;
    if (mode === "session") return session.text.hostBashModeSession;
    if (mode === "ephemeral") return session.text.hostBashModeEphemeral;
    return mode;
  }

  function categoryLabel(cat?: string): string {
    if (cat === "mcp") return session.text.hostBashCategoryMcp;
    if (cat === "file_write") return session.text.hostBashCategoryFile;
    if (cat === "miniapp") return session.text.hostBashCategoryMiniApp;
    return session.text.hostBashCategoryBash;
  }

  function onFilterChange(): void {
    void refreshHostBash();
  }

  async function handleConfirmDeleteWhitelist(): Promise<void> {
    if (!deletingWhitelistItem) return;
    const id = deletingWhitelistItem.id;
    deletingWhitelistItem = null;
    await deleteHostBashWhitelist(id);
  }

  async function handleConfirmDeleteHistory(): Promise<void> {
    if (!deletingHistoryItem) return;
    const id = deletingHistoryItem.id;
    deletingHistoryItem = null;
    await deleteHostBashHistory(id);
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.hostBashUnavailable}</p></div></div>
{:else if hostBashStore.loading && !hostBashStore.data}
  <div class="settings-card"><div class="settings-row"><SkeletonRows count={4} /></div></div>
{:else}
  <div class="host-bash-section">
    <!-- 4 Stat Summary Cards (Direct Tab Filters) -->
    <div class="host-bash-stats-grid">
      <button
        type="button"
        class="host-bash-stat-card"
        class:active={hostBashStore.activeTab === "pending"}
        onclick={() => (hostBashStore.activeTab = hostBashStore.activeTab === "pending" ? "all" : "pending")}
      >
        <div class="host-bash-stat-header">
          <span class="host-bash-stat-label">{session.text.hostBashPending}</span>
          <span class="host-bash-stat-icon warning"><Hourglass size={14} aria-hidden="true" /></span>
        </div>
        <div class="host-bash-stat-value">{counts.pending}</div>
        <div class="host-bash-stat-sub">{session.text.hostBashPendingSub}</div>
      </button>

      <button
        type="button"
        class="host-bash-stat-card"
        class:active={hostBashStore.activeTab === "whitelist"}
        onclick={() => (hostBashStore.activeTab = hostBashStore.activeTab === "whitelist" ? "all" : "whitelist")}
      >
        <div class="host-bash-stat-header">
          <span class="host-bash-stat-label">{session.text.hostBashWhitelist}</span>
          <span class="host-bash-stat-icon accent"><ShieldCheck size={14} aria-hidden="true" /></span>
        </div>
        <div class="host-bash-stat-value">{counts.whitelist}</div>
        <div class="host-bash-stat-sub">{session.text.hostBashWhitelistSub}</div>
      </button>

      <button
        type="button"
        class="host-bash-stat-card"
        class:active={hostBashStore.activeTab === "whitelist"}
        onclick={() => (hostBashStore.activeTab = hostBashStore.activeTab === "whitelist" ? "all" : "whitelist")}
      >
        <div class="host-bash-stat-header">
          <span class="host-bash-stat-label">{session.text.hostBashEnabled}</span>
          <span class="host-bash-stat-icon online"><CheckCircle size={14} aria-hidden="true" /></span>
        </div>
        <div class="host-bash-stat-value">{counts.whitelistEnabled}</div>
        <div class="host-bash-stat-sub">{session.text.hostBashEnabledSub}</div>
      </button>

      <button
        type="button"
        class="host-bash-stat-card"
        class:active={hostBashStore.activeTab === "history"}
        onclick={() => (hostBashStore.activeTab = hostBashStore.activeTab === "history" ? "all" : "history")}
      >
        <div class="host-bash-stat-header">
          <span class="host-bash-stat-label">{session.text.hostBashHistory}</span>
          <span class="host-bash-stat-icon info"><History size={14} aria-hidden="true" /></span>
        </div>
        <div class="host-bash-stat-value">{counts.history}</div>
        <div class="host-bash-stat-sub">{session.text.hostBashHistorySub}</div>
      </button>
    </div>

    <!-- Filters Bar (Single Row) -->
    <div class="host-bash-filter-bar">
      <div class="host-bash-search-wrap">
        <SearchField
          value={hostBashStore.query}
          label={session.text.hostBashSearchPlaceholder}
          placeholder={session.text.hostBashSearchPlaceholder}
          onInput={(val) => { hostBashStore.query = val; onFilterChange(); }}
        />
      </div>

      <div class="host-bash-select-filter">
        <SelectControl
          value={hostBashStore.categoryFilter}
          ariaLabel={session.text.hostBashCategoryAll}
          options={[
            { value: "all", label: session.text.hostBashCategoryAll },
            { value: "bash", label: session.text.hostBashCategoryBash },
            { value: "mcp", label: session.text.hostBashCategoryMcp },
            { value: "file_write", label: session.text.hostBashCategoryFile },
            { value: "miniapp", label: session.text.hostBashCategoryMiniApp }
          ]}
          onChange={(val) => { hostBashStore.categoryFilter = val as any; onFilterChange(); }}
        />
      </div>

      <div class="host-bash-select-filter">
        <SelectControl
          value={hostBashStore.statusFilter}
          ariaLabel={session.text.hostBashStatusAll}
          options={[
            { value: "all", label: session.text.hostBashStatusAll },
            { value: "approved", label: session.text.hostBashStatusApproved },
            { value: "rejected", label: session.text.hostBashStatusRejected },
            { value: "executed", label: session.text.hostBashStatusExecuted },
            { value: "failed", label: session.text.hostBashStatusFailed },
            { value: "expired", label: session.text.hostBashStatusExpired }
          ]}
          onChange={(val) => { hostBashStore.statusFilter = val as HostBashStatusFilter; onFilterChange(); }}
        />
      </div>

      <div class="host-bash-select-filter">
        <SelectControl
          value={hostBashStore.modeFilter}
          ariaLabel={session.text.hostBashModeAll}
          options={[
            { value: "all", label: session.text.hostBashModeAll },
            { value: "persistent", label: session.text.hostBashModePersistent },
            { value: "ephemeral", label: session.text.hostBashModeEphemeral },
            { value: "session", label: session.text.hostBashModeSession }
          ]}
          onChange={(val) => { hostBashStore.modeFilter = val as HostBashModeFilter; onFilterChange(); }}
        />
      </div>

      {#if hostBashStore.activeTab !== "all"}
        <button
          type="button"
          class="secondary-button host-bash-clear-tab-btn"
          title={session.text.hostBashTabAll}
          onclick={() => (hostBashStore.activeTab = "all")}
        >
          <X size={14} aria-hidden="true" />
          <span>{session.text.hostBashTabAll}</span>
        </button>
      {/if}

      <button
        type="button"
        class="secondary-button host-bash-refresh-btn"
        title={session.text.hostBashRefresh}
        aria-label={session.text.hostBashRefresh}
        onclick={() => void refreshHostBash()}
      >
        <Refresh size={16} aria-hidden="true" />
      </button>
    </div>

    <!-- Section: Pending Approvals -->
    {#if hostBashStore.activeTab === "all" || hostBashStore.activeTab === "pending"}
      <div class="host-bash-group">
        <div class="host-bash-group-header">
          <h3>{session.text.hostBashTabPending}</h3>
          <span class="host-bash-count-badge">{pendingList.length}</span>
        </div>

        {#if pendingList.length === 0}
          <div class="settings-card">
            <EmptyState
              title={session.text.hostBashNoPending}
              icon="check-circle"
            />
          </div>
        {:else}
          <div class="settings-card">
            {#each pendingList as item (item.id)}
              <div class="host-bash-row">
                <div class="host-bash-row-main">
                  <div class="host-bash-row-head">
                    <span class="host-bash-category-tag" class:cat-mcp={item.category === "mcp"} class:cat-file={item.category === "file_write"} class:cat-miniapp={item.category === "miniapp"}>
                      {categoryLabel(item.category)}
                    </span>
                    <span class="host-bash-tool-tag">{item.displayName || item.toolId}</span>
                    <StatusBadge state="warning" label={session.text.hostBashPending} />
                    <span class="host-bash-mode-badge">{modeLabel(item.approvalMode)}</span>
                    <span class="host-bash-time">{formatTime(item.requestedAt)}</span>
                  </div>

                  <div class="host-bash-command-box">
                    <code>{item.command || item.toolId}</code>
                  </div>

                  {#if item.reason}
                    <p class="host-bash-reason">{item.reason}</p>
                  {/if}

                  <div class="host-bash-permissions-bar">
                    <span class="host-bash-perm-tag"><Folder size={12} aria-hidden="true" />{session.text.hostBashFs}: {item.permissions?.filesystem ?? "-"}</span>
                    <span class="host-bash-perm-tag"><Globe size={12} aria-hidden="true" />{session.text.hostBashNet}: {item.permissions?.network ?? "-"}</span>
                    <span class="host-bash-perm-tag"><Code size={12} aria-hidden="true" />{session.text.hostBashEnv}: {item.permissions?.envAllowlist?.length ?? 0}</span>
                    {#if item.scopeId}
                      <span class="host-bash-perm-tag"><Hashtag size={12} aria-hidden="true" />{session.text.hostBashColScope}: {item.scopeId}</span>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Section: Whitelist Management -->
    {#if hostBashStore.activeTab === "all" || hostBashStore.activeTab === "whitelist"}
      <div class="host-bash-group">
        <div class="host-bash-group-header">
          <h3>{session.text.hostBashTabWhitelist}</h3>
          <span class="host-bash-count-badge">{whitelistList.length}</span>
        </div>

        {#if whitelistList.length === 0}
          <div class="settings-card">
            <EmptyState
              title={session.text.hostBashWhitelistEmpty}
              icon="shield-slash"
            />
          </div>
        {:else}
          <div class="settings-card">
            {#each whitelistList as item (item.id)}
              <div class="host-bash-row">
                <div class="host-bash-row-main">
                  <div class="host-bash-row-head">
                    <span class="host-bash-category-tag" class:cat-mcp={item.category === "mcp"} class:cat-file={item.category === "file_write"} class:cat-miniapp={item.category === "miniapp"}>
                      {categoryLabel(item.category)}
                    </span>
                    <span class="host-bash-tool-tag primary">{item.displayName || item.toolId}</span>
                    <StatusBadge
                      state={item.enabled ? "ready" : "disconnected"}
                      label={item.enabled ? session.text.hostBashEnabled : session.text.providerDisabled}
                    />
                    <span class="host-bash-time">{session.text.hostBashColApprovedAt}: {formatTime(item.approvedAt)}</span>
                  </div>

                  {#if item.command && item.command !== item.toolId}
                    <div class="host-bash-command-box">
                      <code>{item.command}</code>
                    </div>
                  {/if}

                  {#if item.reason}
                    <p class="host-bash-reason">{item.reason}</p>
                  {/if}

                  <div class="host-bash-permissions-bar">
                    <span class="host-bash-perm-tag"><Folder size={12} aria-hidden="true" />{session.text.hostBashFs}: {item.permissions?.filesystem ?? "-"}</span>
                    <span class="host-bash-perm-tag"><Globe size={12} aria-hidden="true" />{session.text.hostBashNet}: {item.permissions?.network ?? "-"}</span>
                    <span class="host-bash-perm-tag"><Code size={12} aria-hidden="true" />{session.text.hostBashEnv}: {item.permissions?.envAllowlist?.length ?? 0}</span>
                    {#if item.scopeId}
                      <span class="host-bash-perm-tag"><Hashtag size={12} aria-hidden="true" />{session.text.hostBashColScope}: {item.scopeId}</span>
                    {/if}
                  </div>
                </div>

                <div class="host-bash-row-actions">
                  <IosSwitch
                    checked={item.enabled}
                    ariaLabel={item.displayName || item.toolId}
                    disabled={hostBashStore.togglingId === item.id}
                    onCheckedChange={(checked) => void toggleHostBashWhitelist(item.id, checked)}
                  />
                  <button
                    type="button"
                    class="host-bash-action-btn danger"
                    title={session.text.hostBashDeleteWhitelist}
                    aria-label={session.text.hostBashDeleteWhitelist}
                    disabled={hostBashStore.deletingId === item.id}
                    onclick={() => (deletingWhitelistItem = item)}
                  >
                    <Trash size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Section: History Records -->
    {#if hostBashStore.activeTab === "all" || hostBashStore.activeTab === "history"}
      <div class="host-bash-group">
        <div class="host-bash-group-header">
          <h3>{session.text.hostBashTabHistory}</h3>
          <span class="host-bash-count-badge">{historyList.length}</span>
        </div>

        {#if historyList.length === 0}
          <div class="settings-card">
            <EmptyState
              title={session.text.hostBashNoHistory}
              icon="clock-countdown"
            />
          </div>
        {:else}
          <div class="settings-card">
            {#each historyList as item (item.id)}
              <div class="host-bash-row">
                <div class="host-bash-row-main">
                  <div class="host-bash-row-head">
                    <span class="host-bash-category-tag" class:cat-mcp={item.category === "mcp"} class:cat-file={item.category === "file_write"} class:cat-miniapp={item.category === "miniapp"}>
                      {categoryLabel(item.category)}
                    </span>
                    <span class="host-bash-tool-tag">{item.displayName || item.toolId}</span>
                    <StatusBadge state={statusTone(item.status)} label={statusLabel(item.status)} />
                    <span class="host-bash-mode-badge">{modeLabel(item.approvalMode)}</span>
                    <span class="host-bash-time">{formatTime(item.resolvedAt || item.requestedAt)}</span>
                  </div>

                  <div class="host-bash-command-box">
                    <code>{item.command || item.toolId}</code>
                  </div>

                  {#if item.errorText}
                    <p class="host-bash-error-text"><TriangleWarning size={14} aria-hidden="true" />{item.errorText}</p>
                  {:else if item.reason}
                    <p class="host-bash-reason">{item.reason}</p>
                  {/if}

                  <div class="host-bash-permissions-bar">
                    <span class="host-bash-perm-tag"><Folder size={12} aria-hidden="true" />{session.text.hostBashFs}: {item.permissions?.filesystem ?? "-"}</span>
                    <span class="host-bash-perm-tag"><Globe size={12} aria-hidden="true" />{session.text.hostBashNet}: {item.permissions?.network ?? "-"}</span>
                    <span class="host-bash-perm-tag"><Code size={12} aria-hidden="true" />{session.text.hostBashEnv}: {item.permissions?.envAllowlist?.length ?? 0}</span>
                    {#if item.scopeId}
                      <span class="host-bash-perm-tag"><Hashtag size={12} aria-hidden="true" />{session.text.hostBashColScope}: {item.scopeId}</span>
                    {/if}
                  </div>
                </div>

                <div class="host-bash-row-actions">
                  <button
                    type="button"
                    class="host-bash-action-btn danger"
                    title={session.text.hostBashDeleteHistory}
                    aria-label={session.text.hostBashDeleteHistory}
                    disabled={hostBashStore.deletingId === item.id}
                    onclick={() => (deletingHistoryItem = item)}
                  >
                    <Trash size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Delete Whitelist Confirmation Dialog -->
  {#if deletingWhitelistItem}
    <AlertDialog
      open={Boolean(deletingWhitelistItem)}
      contentClass="confirm-dialog"
      labelledBy="delete-whitelist-title"
      describedBy="delete-whitelist-description"
      onOpenChange={(next) => { if (!next) deletingWhitelistItem = null; }}
    >
      <header class="modal-head">
        <div>
          <strong id="delete-whitelist-title">{session.text.hostBashDeleteWhitelist}</strong>
          <p id="delete-whitelist-description">{session.text.hostBashDeleteWhitelistConfirm}</p>
        </div>
      </header>
      <footer class="entity-editor-foot">
        <button class="secondary-button" type="button" onclick={() => (deletingWhitelistItem = null)}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" onclick={handleConfirmDeleteWhitelist}>{session.text.delete}</button>
      </footer>
    </AlertDialog>
  {/if}

  <!-- Delete History Record Confirmation Dialog -->
  {#if deletingHistoryItem}
    <AlertDialog
      open={Boolean(deletingHistoryItem)}
      contentClass="confirm-dialog"
      labelledBy="delete-history-title"
      describedBy="delete-history-description"
      onOpenChange={(next) => { if (!next) deletingHistoryItem = null; }}
    >
      <header class="modal-head">
        <div>
          <strong id="delete-history-title">{session.text.hostBashDeleteHistory}</strong>
          <p id="delete-history-description">{session.text.hostBashDeleteHistoryConfirm}</p>
        </div>
      </header>
      <footer class="entity-editor-foot">
        <button class="secondary-button" type="button" onclick={() => (deletingHistoryItem = null)}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" onclick={handleConfirmDeleteHistory}>{session.text.delete}</button>
      </footer>
    </AlertDialog>
  {/if}
{/if}

<style>
  .host-bash-section {
    width: var(--settings-col);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .host-bash-stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    width: 100%;
  }

  @media (max-width: 680px) {
    .host-bash-stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .host-bash-stat-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px 14px;
    border: 1px solid var(--separator);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
    color: var(--label-primary);
    text-align: left;
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
  }

  .host-bash-stat-card:hover {
    border-color: var(--accent);
    background: var(--fill-hover);
  }

  .host-bash-stat-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .host-bash-stat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .host-bash-stat-label {
    font-size: var(--fs-meta);
    font-weight: 500;
    color: var(--label-secondary);
  }

  .host-bash-stat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }

  .host-bash-stat-icon.warning { color: var(--warning); }
  .host-bash-stat-icon.accent { color: var(--accent); }
  .host-bash-stat-icon.online { color: var(--online); }
  .host-bash-stat-icon.info { color: var(--label-secondary); }

  .host-bash-stat-value {
    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--label-primary);
  }

  .host-bash-stat-sub {
    font-size: 11px;
    color: var(--label-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  .host-bash-filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .host-bash-search-wrap {
    flex: 1 1 180px;
    min-width: 160px;
  }

  .host-bash-search-wrap :global(.search-field) {
    height: 32px;
    width: 100%;
  }

  .host-bash-select-filter {
    width: 130px;
  }

  .host-bash-select-filter :global(.select-control) {
    width: 100%;
  }

  .host-bash-select-filter :global(.select-control-trigger) {
    height: 32px;
    font-size: var(--fs-meta);
    padding: 0 8px 0 10px;
  }

  .host-bash-clear-tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius-small);
    font-size: var(--fs-meta);
    color: var(--label-secondary);
  }

  .host-bash-refresh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: var(--radius-small);
  }

  .host-bash-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .host-bash-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 2px 2px;
  }

  .host-bash-group-header h3 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--label-secondary);
  }

  .host-bash-count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--surface-secondary);
    color: var(--label-secondary);
    font-size: 11px;
    font-weight: 600;
  }

  .host-bash-section .settings-card {
    width: 100%;
    margin: 0;
    border: 1px solid var(--separator);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
    overflow: hidden;
  }

  .host-bash-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
  }

  .host-bash-row + .host-bash-row {
    border-top: 0.5px solid var(--separator);
  }

  .host-bash-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .host-bash-row-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .host-bash-category-tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: var(--radius-small);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
  }

  .host-bash-category-tag.cat-mcp {
    background: color-mix(in srgb, #a855f7 16%, transparent);
    color: #a855f7;
  }

  .host-bash-category-tag.cat-file {
    background: color-mix(in srgb, #10b981 16%, transparent);
    color: #10b981;
  }

  .host-bash-category-tag.cat-miniapp {
    background: color-mix(in srgb, #f59e0b 16%, transparent);
    color: #f59e0b;
  }

  .host-bash-tool-tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: var(--radius-small);
    background: var(--surface-secondary);
    color: var(--label-primary);
    font-size: var(--fs-meta);
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .host-bash-tool-tag.primary {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  .host-bash-mode-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: var(--radius-small);
    border: 1px solid var(--separator);
    font-size: 11px;
    color: var(--label-secondary);
  }

  .host-bash-time {
    margin-left: auto;
    font-size: 11px;
    color: var(--label-tertiary);
  }

  .host-bash-command-box {
    padding: 6px 10px;
    border-radius: var(--radius-small);
    background: var(--surface-secondary);
    border: 1px solid var(--separator);
    overflow-x: auto;
  }

  .host-bash-command-box code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--label-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .host-bash-reason {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--label-secondary);
    line-height: 1.4;
  }

  .host-bash-error-text {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--danger);
  }

  .host-bash-permissions-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }

  .host-bash-perm-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: var(--radius-small);
    background: var(--fill);
    color: var(--label-tertiary);
    font-size: 11px;
  }

  .host-bash-row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .host-bash-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-small);
    background: transparent;
    color: var(--label-tertiary);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
  }

  .host-bash-action-btn.danger:hover:not(:disabled) {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .host-bash-action-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
