<script lang="ts">
  import Dialog from "./ui/Dialog.svelte";
  import Button from "./ui/Button.svelte";
  import X from "reicon-svelte/icons/X";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import StatusBadge from "./ui/StatusBadge.svelte";
  import {
    updaterStore,
    downloadAndInstallUpdate,
    relaunchApp,
    closeUpdateDialog,
    checkForUpdates
  } from "../stores/updater.svelte";
  import { translator, type Locale } from "../i18n";

  let {
    locale = "zh-CN"
  }: {
    locale?: Locale;
  } = $props();

  let text = $derived(translator(locale));

  function handleOpenChange(open: boolean): void {
    if (!open && !updaterStore.downloading) {
      closeUpdateDialog();
    }
  }

  function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }
</script>

<Dialog
  open={updaterStore.showDialog}
  contentClass="update-dialog-content"
  labelledBy="update-dialog-title"
  busy={updaterStore.downloading}
  onOpenChange={handleOpenChange}
>
  <div class="update-dialog">
    <header class="update-dialog-header">
      <div class="update-header-title">
        <h2 id="update-dialog-title" class="update-title">
          {#if updaterStore.checking}
            {text.checkingUpdates}
          {:else if updaterStore.readyToRestart}
            {text.updateReady}
          {:else if updaterStore.downloading}
            {text.downloadingUpdate}
          {:else if updaterStore.available}
            {text.updateAvailable}
          {:else if updaterStore.error}
            {text.updateFailed}
          {:else}
            {text.updateUpToDate}
          {/if}
        </h2>
      </div>
      {#if !updaterStore.downloading}
        <button
          type="button"
          class="update-close-button"
          aria-label={text.later}
          onclick={closeUpdateDialog}
        >
          <X size={16} aria-hidden="true" />
        </button>
      {/if}
    </header>

    <div class="update-dialog-body">
      {#if updaterStore.checking}
        <div class="update-state-center">
          <div class="update-spinner" aria-hidden="true"></div>
          <p class="update-state-text">{text.checkingUpdates}</p>
        </div>
      {:else if updaterStore.isTranslocated}
        <div class="update-warning-box">
          <div class="update-warning-icon">
            <TriangleWarning size={20} aria-hidden="true" />
          </div>
          <div class="update-warning-content">
            <strong>App Translocation</strong>
            <p>{text.translocationWarning}</p>
          </div>
        </div>
      {:else if updaterStore.error}
        <div class="update-error-box">
          <p class="update-error-message">{updaterStore.error}</p>
        </div>
      {:else if updaterStore.readyToRestart}
        <div class="update-ready-box">
          <StatusBadge label={text.updateReady} state="ready" />
          <p class="update-ready-desc">
            {text.currentVersion}: <code>v{updaterStore.currentVersion}</code> → {text.newVersion}: <code>v{updaterStore.newVersion}</code>
          </p>
          <p class="update-ready-hint">
            {text.softwareUpdateHint}
          </p>
        </div>
      {:else if updaterStore.downloading}
        <div class="update-progress-box">
          <div class="update-progress-bar-bg">
            <div
              class="update-progress-bar-fill"
              style={`width: ${updaterStore.downloadProgress}%`}
            ></div>
          </div>
          <div class="update-progress-meta">
            <span>{updaterStore.downloadProgress}%</span>
            {#if updaterStore.totalBytes > 0}
              <span>{formatBytes(updaterStore.downloadedBytes)} / {formatBytes(updaterStore.totalBytes)}</span>
            {/if}
          </div>
        </div>
      {:else if updaterStore.available}
        <div class="update-info-box">
          <div class="update-version-row">
            <span class="update-version-badge">v{updaterStore.newVersion}</span>
            <span class="update-version-current">({text.currentVersion}: v{updaterStore.currentVersion})</span>
            {#if updaterStore.releaseDate}
              <span class="update-release-date">{new Date(updaterStore.releaseDate).toLocaleDateString()}</span>
            {/if}
          </div>

          {#if updaterStore.releaseNotes}
            <div class="update-notes-section">
              <span class="update-notes-title">{text.releaseNotes}:</span>
              <div class="update-notes-body">
                <pre class="update-notes-content">{updaterStore.releaseNotes}</pre>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="update-state-center">
          <StatusBadge label={text.updateUpToDate} state="ready" />
          <p class="update-state-text">Molibot v{updaterStore.currentVersion}</p>
        </div>
      {/if}
    </div>

    <footer class="update-dialog-footer">
      {#if updaterStore.checking}
        <Button variant="secondary" onclick={closeUpdateDialog}>
          {text.later}
        </Button>
      {:else if updaterStore.isTranslocated}
        <Button variant="primary" onclick={closeUpdateDialog}>
          {text.later}
        </Button>
      {:else if updaterStore.error}
        <Button variant="secondary" onclick={closeUpdateDialog}>
          {text.later}
        </Button>
        <Button variant="primary" onclick={() => checkForUpdates(true)}>
          {text.retry}
        </Button>
      {:else if updaterStore.readyToRestart}
        <Button variant="secondary" onclick={closeUpdateDialog}>
          {text.later}
        </Button>
        <Button variant="primary" onclick={relaunchApp}>
          {text.restartToUpdate}
        </Button>
      {:else if updaterStore.downloading}
        <span class="update-downloading-hint">{text.downloadingUpdate}</span>
      {:else if updaterStore.available}
        <Button variant="secondary" onclick={closeUpdateDialog}>
          {text.later}
        </Button>
        <Button variant="primary" onclick={downloadAndInstallUpdate}>
          {text.downloadAndInstall}
        </Button>
      {:else}
        <Button variant="primary" onclick={closeUpdateDialog}>
          {text.continueAction}
        </Button>
      {/if}
    </footer>
  </div>
</Dialog>

<style>
  :global(.update-dialog-content) {
    width: min(480px, calc(100vw - 32px));
    max-height: min(520px, calc(100vh - 48px));
  }

  .update-dialog {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .update-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--separator);
  }

  .update-header-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .update-title {
    margin: 0;
    font-size: var(--fs-title);
    line-height: var(--lh-title);
    font-weight: 600;
    color: var(--label-primary);
  }

  .update-close-button {
    border: none;
    background: transparent;
    padding: 4px;
    cursor: pointer;
    color: var(--label-secondary);
    border-radius: var(--rounded-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--duration-instant) var(--ease-standard);
  }

  .update-close-button:hover {
    background: var(--fill-hover);
    color: var(--label-primary);
  }

  .update-dialog-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .update-state-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 16px;
    gap: 12px;
    text-align: center;
  }

  .update-state-text {
    margin: 0;
    font-size: var(--fs-body);
    color: var(--label-secondary);
  }

  .update-spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--hairline);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: update-spin 800ms linear infinite;
  }

  @keyframes update-spin {
    to { transform: rotate(360deg); }
  }

  .update-warning-box {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
    color: var(--label-primary);
  }

  .update-warning-icon {
    color: var(--warning);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .update-warning-content strong {
    display: block;
    font-size: var(--fs-body);
    margin-bottom: 4px;
  }

  .update-warning-content p {
    margin: 0;
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    color: var(--label-secondary);
  }

  .update-error-box {
    padding: 14px 16px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  }

  .update-error-message {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--danger);
    word-break: break-word;
  }

  .update-ready-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 0;
  }

  .update-ready-desc {
    margin: 0;
    font-size: var(--fs-body);
    color: var(--label-primary);
  }

  .update-ready-desc code {
    padding: 2px 6px;
    border-radius: var(--rounded-sm);
    background: var(--surface-secondary);
    font-family: var(--font-mono, monospace);
  }

  .update-ready-hint {
    margin: 0;
    font-size: var(--fs-meta);
    color: var(--label-secondary);
  }

  .update-progress-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0;
  }

  .update-progress-bar-bg {
    width: 100%;
    height: 8px;
    background: var(--surface-secondary);
    border-radius: var(--rounded-full);
    overflow: hidden;
  }

  .update-progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--rounded-full);
    transition: width 200ms ease-out;
  }

  .update-progress-meta {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-meta);
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }

  .update-info-box {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .update-version-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .update-version-badge {
    padding: 3px 8px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    border-radius: var(--radius-control);
    font-weight: 600;
    font-size: var(--fs-label);
  }

  .update-version-current {
    font-size: var(--fs-meta);
    color: var(--label-secondary);
  }

  .update-release-date {
    font-size: var(--fs-meta);
    color: var(--label-tertiary);
    margin-left: auto;
  }

  .update-notes-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .update-notes-title {
    font-size: var(--fs-meta);
    font-weight: 600;
    color: var(--label-secondary);
  }

  .update-notes-body {
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--separator);
    border-radius: var(--radius-control);
    background: var(--surface-secondary);
    padding: 10px 12px;
  }

  .update-notes-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    color: var(--label-primary);
  }

  .update-dialog-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    border-top: 1px solid var(--separator);
    background: var(--card-bg);
  }

  .update-downloading-hint {
    font-size: var(--fs-meta);
    color: var(--label-secondary);
  }
</style>
