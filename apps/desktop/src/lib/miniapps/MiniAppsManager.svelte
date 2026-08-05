<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { session } from "../stores/session.svelte";
  import MiniAppIcon from "./MiniAppIcon.svelte";
  import {
    miniAppsStore,
    loadMiniApps,
    toggleMiniApp,
    uninstallMiniApp,
    updateMiniApp,
    installMiniApp
  } from "../stores/miniapps.svelte";
  import type { DesktopMiniAppItem, DesktopMiniAppSource } from "@molibot/desktop-contract";

  /**
   * The Mini App management surface: install, inspect, enable/disable, uninstall.
   *
   * Mounted both as the sidebar's Mini Apps destination and inside Settings ›
   * Plugins, so the two entry points cannot drift apart.
   *
   * Every control here commits immediately through its own route — a toggle
   * must never also submit unsaved fields belonging to the Plugins editor.
   */
  let { onOpenApp }: { onOpenApp?: (appId: string) => void } = $props();

  type InstallTab = "directory" | "zip" | "github";

  let lastEndpoint = $state("");
  let installTab = $state<InstallTab>("directory");
  let githubRepo = $state("");
  let githubRef = $state("");

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== lastEndpoint) {
      lastEndpoint = session.endpoint;
      void loadMiniApps(session.endpoint);
    }
  });

  function statusLabel(app: DesktopMiniAppItem): string {
    if (app.status === "error") return session.text.miniAppErrorStatus;
    if (!app.enabled || app.status === "disabled") return session.text.pluginDisabled;
    return session.text.pluginEnabled;
  }

  function statusState(app: DesktopMiniAppItem): "ready" | "error" | "disconnected" {
    if (app.status === "error") return "error";
    return app.enabled && app.status === "active" ? "ready" : "disconnected";
  }

  /** Human-readable provenance. Empty for a hand-placed local directory. */
  function sourceLabel(source: DesktopMiniAppSource): string {
    if (source.kind === "builtin") return session.text.miniAppBuiltinBadge;
    if (source.kind === "github") return `GitHub · ${source.repo}${source.ref && source.ref !== "HEAD" ? ` @ ${source.ref}` : ""}`;
    if (source.kind === "zip") return source.label ? `ZIP · ${source.label}` : "ZIP";
    return source.label ? `${session.text.miniAppSourceDirectory} · ${source.label}` : session.text.miniAppSourceDirectory;
  }

  /**
   * A Mini App's server code runs inside Molibot with no sandbox, so installing
   * one is handing it the owner's privileges. That is stated before the install,
   * not after — and for a remote source it must be accepted explicitly.
   */
  function confirmInstall(description: string): boolean {
    return window.confirm(`${session.text.miniAppInstallTrustWarning}\n\n${description}`);
  }

  async function installFromDirectory(): Promise<void> {
    const picked = await invoke<string | null>("pick_project_directory").catch(() => null);
    if (!picked) return;
    if (!confirmInstall(picked)) return;
    await installMiniApp({ source: "directory", path: picked });
  }

  async function installFromZip(): Promise<void> {
    const picked = await invoke<string | null>("pick_miniapp_archive").catch(() => null);
    if (!picked) return;
    if (!confirmInstall(picked)) return;
    await installMiniApp({ source: "zip", path: picked });
  }

  async function installFromGithub(): Promise<void> {
    const repo = githubRepo.trim();
    if (!repo) return;
    const ref = githubRef.trim();
    if (!confirmInstall(`${repo}${ref ? ` @ ${ref}` : ""}`)) return;
    const installed = await installMiniApp({ source: "github", repo, ...(ref ? { ref } : {}) });
    if (installed) {
      githubRepo = "";
      githubRef = "";
    }
  }

  function confirmUninstall(app: DesktopMiniAppItem, deleteData: boolean): void {
    const template = deleteData
      ? session.text.miniAppDeleteDataConfirm
      : session.text.miniAppUninstallConfirm;
    if (!window.confirm(template.replace("{name}", app.name))) return;
    void uninstallMiniApp(app.id, deleteData);
  }

  const installedCount = $derived(miniAppsStore.items.length);
  const activeCount = $derived(
    miniAppsStore.items.filter((app) => app.enabled && app.status === "active").length
  );
  const errorCount = $derived(miniAppsStore.items.filter((app) => app.status === "error").length);
</script>

<section class="miniapps-manager">
  <div class="miniapps-manager-head">
    <div>
      <h2>{session.text.miniAppsSettingsTitle}</h2>
      <p>{session.text.miniAppsSettingsHint}</p>
    </div>
  </div>

  <div class="miniapps-install">
    <div class="miniapps-install-head">
      <span aria-hidden="true"><i class="ph ph-plus-circle"></i></span>
      <strong>{session.text.miniAppInstallTitle}</strong>
    </div>
    <div class="miniapps-install-tabs" role="tablist" aria-label={session.text.miniAppInstallTitle}>
      {#each [["directory", session.text.miniAppInstallDirectory], ["zip", session.text.miniAppInstallZip], ["github", session.text.miniAppInstallGithub]] as [value, label] (value)}
        <button
          type="button"
          role="tab"
          aria-selected={installTab === value}
          class:active={installTab === value}
          onclick={() => (installTab = value as InstallTab)}
        >{label}</button>
      {/each}
    </div>

    <div class="miniapps-install-body">
      {#if installTab === "github"}
        <div class="miniapps-install-row">
          <input
            class="miniapps-install-input"
            bind:value={githubRepo}
            placeholder="owner/repo"
            aria-label={session.text.miniAppInstallGithub}
            onkeydown={(event) => { if (event.key === "Enter") void installFromGithub(); }}
          />
          <input
            class="miniapps-install-ref"
            bind:value={githubRef}
            placeholder={session.text.miniAppInstallRefPlaceholder}
            aria-label={session.text.miniAppInstallRefPlaceholder}
            onkeydown={(event) => { if (event.key === "Enter") void installFromGithub(); }}
          />
          <button
            class="primary-button"
            type="button"
            disabled={miniAppsStore.installing || githubRepo.trim().length === 0}
            onclick={() => void installFromGithub()}
          >{miniAppsStore.installing ? session.text.miniAppInstalling : session.text.miniAppInstallAction}</button>
        </div>
      {:else}
        <div class="miniapps-install-row">
          <p class="miniapps-install-hint">
            {installTab === "directory" ? session.text.miniAppInstallDirectoryHint : session.text.miniAppInstallZipHint}
          </p>
          <button
            class="primary-button"
            type="button"
            disabled={miniAppsStore.installing}
            onclick={() => void (installTab === "directory" ? installFromDirectory() : installFromZip())}
          >{miniAppsStore.installing ? session.text.miniAppInstalling : session.text.miniAppInstallChoose}</button>
        </div>
      {/if}

      <p class="miniapps-trust"><i class="ph ph-shield-warning" aria-hidden="true"></i><span>{session.text.miniAppInstallTrustWarning}</span></p>
    </div>
  </div>

  {#if miniAppsStore.restartRequired}
    <p class="miniapps-restart" role="status">{session.text.miniAppRestartRequired}</p>
  {/if}

  <section class="miniapps-library" aria-labelledby="miniapps-library-title">
    <div class="miniapps-library-head">
      <strong id="miniapps-library-title">{session.text.miniAppsSection}</strong>
      <p class="miniapps-counts">
        {session.text.miniAppCountInstalled.replace("{n}", String(installedCount))}
        · {session.text.miniAppCountActive.replace("{n}", String(activeCount))}
        {#if errorCount > 0}· <span class="miniapps-error">{session.text.miniAppCountError.replace("{n}", String(errorCount))}</span>{/if}
      </p>
    </div>

    {#if miniAppsStore.loading && miniAppsStore.items.length === 0}
      <p class="miniapps-note">{session.text.loading}</p>
    {:else if miniAppsStore.items.length === 0}
      <p class="miniapps-note">{session.text.miniAppsEmpty}</p>
    {:else}
      <ul class="miniapps-settings-list">
        {#each miniAppsStore.items as app (app.id)}
          <li class="miniapps-settings-row">
            <MiniAppIcon src={app.iconDataUri} label={app.name} />

            <div class="miniapps-settings-info">
              <strong>
                {app.name}
                <span class="miniapps-version">{app.version}</span>
                {#if app.updateAvailable}
                  <span class="miniapps-update-badge">
                    {session.text.miniAppUpdateAvailable.replace("{version}", app.availableVersion)}
                  </span>
                {/if}
              </strong>
              {#if app.description}<p>{app.description}</p>{/if}
              <p class="miniapps-provenance">{sourceLabel(app.source)}</p>
              {#if app.toolNames.length > 0}
                <p class="miniapps-tools">
                  {session.text.miniAppToolsLabel}: {app.toolNames.map((tool) => `${app.id}.${tool}`).join(", ")}
                </p>
              {/if}
              {#if app.error}<p class="miniapps-error">{app.error}</p>{/if}
            </div>

            <div class="settings-row-actions">
              <StatusBadge label={statusLabel(app)} state={statusState(app)} />
              <IosSwitch
                checked={app.enabled}
                ariaLabel={`${app.name}: ${session.text.pluginEnabled}`}
                onCheckedChange={(checked) => void toggleMiniApp(app.id, checked)}
              />
              {#if app.updateAvailable}
                <button
                  class="secondary-button"
                  type="button"
                  disabled={miniAppsStore.busyId.length > 0}
                  onclick={() => void updateMiniApp(app.id)}
                >
                  {miniAppsStore.busyId === app.id ? session.text.miniAppUpdating : session.text.miniAppUpdate}
                </button>
              {/if}
              {#if app.enabled && app.status === "active" && onOpenApp}
                <button class="secondary-button" type="button" onclick={() => onOpenApp?.(app.id)}>
                  {session.text.miniAppOpen}
                </button>
              {/if}
              <OverflowMenu label={session.text.miniAppUninstall}>
                <button role="menuitem" type="button" onclick={() => confirmUninstall(app, false)}>
                  <i class="ph ph-archive" aria-hidden="true"></i>{session.text.miniAppUninstallKeepData}
                </button>
                <button role="menuitem" type="button" class="danger-action" onclick={() => confirmUninstall(app, true)}>
                  <i class="ph ph-trash" aria-hidden="true"></i>{session.text.miniAppUninstallDeleteData}
                </button>
              </OverflowMenu>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if miniAppsStore.actionMessage}
    <p class="miniapps-note" role="status">{miniAppsStore.actionMessage}</p>
  {/if}
</section>
