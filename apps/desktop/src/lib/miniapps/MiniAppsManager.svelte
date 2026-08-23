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
    installMiniApp,
    installBuiltinMiniApp
  } from "../stores/miniapps.svelte";
  import type {
    DesktopMiniAppBuiltinItem,
    DesktopMiniAppItem,
    DesktopMiniAppSource
  } from "@molibot/desktop-contract";

  /**
   * The Mini App management surface: install, inspect, enable/disable, uninstall.
   *
   * Mounted both as the sidebar's Mini Apps destination and inside Settings ›
   * Plugins, so the two entry points cannot drift apart.
   *
   * Every control here commits immediately through its own route — a toggle
   * must never also submit unsaved fields belonging to the Plugins editor.
   */
  let {
    onOpenApp,
    onOpenAiSettings
  }: {
    onOpenApp?: (appId: string) => void;
    /**
     * Opens Settings at the Mini App AI section. Absent on the Settings mount,
     * where that section is already on screen.
     */
    onOpenAiSettings?: () => void;
  } = $props();

  type InstallTab = "builtin" | "directory" | "zip" | "github";

  let lastEndpoint = $state("");
  // Built-ins first: they are the apps this build can install with one click,
  // and the tab answers "do I have it, and is there a newer one?".
  let installTab = $state<InstallTab>("builtin");
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

  function confirmUninstall(app: { id: string; name: string }, deleteData: boolean): void {
    const template = deleteData
      ? session.text.miniAppDeleteDataConfirm
      : session.text.miniAppUninstallConfirm;
    if (!window.confirm(template.replace("{name}", app.name))) return;
    void uninstallMiniApp(app.id, deleteData);
  }

  /**
   * What a built-in row says about itself, in one sentence: the owner's two
   * questions on this tab are "do I have it?" and "is there a newer one?".
   */
  function builtinStateLabel(app: DesktopMiniAppBuiltinItem): string {
    if (!app.installed) {
      return app.removedByOwner
        ? session.text.miniAppBuiltinRemoved
        : session.text.miniAppBuiltinNotInstalled;
    }
    if (app.status === "error") return session.text.miniAppErrorStatus;
    if (app.updateAvailable) {
      return session.text.miniAppUpdateAvailable.replace("{version}", app.availableVersion);
    }
    return session.text.miniAppBuiltinUpToDate;
  }

  function builtinStateTone(app: DesktopMiniAppBuiltinItem): "ready" | "error" | "disconnected" {
    if (!app.installed) return "disconnected";
    if (app.status === "error") return "error";
    return app.updateAvailable ? "disconnected" : "ready";
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
      {#each [["builtin", session.text.miniAppInstallBuiltin], ["directory", session.text.miniAppInstallDirectory], ["zip", session.text.miniAppInstallZip], ["github", session.text.miniAppInstallGithub]] as [value, label] (value)}
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
      {#if installTab === "builtin"}
        <p class="miniapps-install-hint">{session.text.miniAppInstallBuiltinHint}</p>
        {#if miniAppsStore.builtin.length === 0}
          <p class="miniapps-note">{session.text.miniAppBuiltinEmpty}</p>
        {:else}
          <ul class="miniapps-builtin-list">
            {#each miniAppsStore.builtin as app (app.id)}
              <li class="miniapps-builtin-row">
                <MiniAppIcon src={app.iconDataUri} label={app.name} />

                <div class="miniapps-settings-info">
                  <strong>
                    {app.name}
                    <span class="miniapps-version">
                      {app.installed ? `v${app.installedVersion}` : `v${app.availableVersion}`}
                    </span>
                    {#if app.installed && app.updateAvailable}
                      <span class="miniapps-update-badge">
                        {session.text.miniAppUpdateAvailable.replace("{version}", app.availableVersion)}
                      </span>
                    {/if}
                  </strong>
                  {#if app.description}<p>{app.description}</p>{/if}
                  {#if app.error}<p class="miniapps-error">{app.error}</p>{/if}
                </div>

                <div class="settings-row-actions">
                  <StatusBadge label={builtinStateLabel(app)} state={builtinStateTone(app)} />
                  {#if !app.installed}
                    <button
                      class="primary-button"
                      type="button"
                      disabled={miniAppsStore.busyId.length > 0}
                      onclick={() => void installBuiltinMiniApp(app.id)}
                    >
                      {miniAppsStore.busyId === app.id
                        ? session.text.miniAppInstalling
                        : session.text.miniAppInstallAction}
                    </button>
                  {:else}
                    {#if app.updateAvailable}
                      <button
                        class="primary-button"
                        type="button"
                        disabled={miniAppsStore.busyId.length > 0}
                        onclick={() => void updateMiniApp(app.id)}
                      >
                        {miniAppsStore.busyId === app.id
                          ? session.text.miniAppUpdating
                          : session.text.miniAppUpdate}
                      </button>
                    {/if}
                    <OverflowMenu label={session.text.miniAppUninstall}>
                      <button
                        role="menuitem"
                        type="button"
                        onclick={() => void installBuiltinMiniApp(app.id)}
                      >
                        <i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>{session.text.miniAppBuiltinReinstall}
                      </button>
                      <button role="menuitem" type="button" onclick={() => confirmUninstall(app, false)}>
                        <i class="ph ph-archive" aria-hidden="true"></i>{session.text.miniAppUninstallKeepData}
                      </button>
                      <button role="menuitem" type="button" class="danger-action" onclick={() => confirmUninstall(app, true)}>
                        <i class="ph ph-trash" aria-hidden="true"></i>{session.text.miniAppUninstallDeleteData}
                      </button>
                    </OverflowMenu>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if installTab === "github"}
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

      {#if installTab !== "builtin"}
        <!-- The trust warning is about running code from somewhere else. A
             built-in shipped inside the app the owner is already running, so
             repeating it there would only teach people to ignore it. -->
        <p class="miniapps-trust"><i class="ph ph-shield-warning" aria-hidden="true"></i><span>{session.text.miniAppInstallTrustWarning}</span></p>
      {/if}
    </div>
  </div>

  {#if onOpenAiSettings}
    <!--
      The AI capability settings themselves live in Settings › Models (one
      global decision about the owner's model configuration, edited in one
      place, next to every other route). This row is only a signpost, and it is
      rendered ONLY when a caller injects a way to get there, so the component
      needs no "am I inside Settings?" branch (pitfall #7).
    -->
    <button type="button" class="miniapps-ai-link" onclick={onOpenAiSettings}>
      <span aria-hidden="true"><i class="ph ph-sliders-horizontal"></i></span>
      <span class="miniapps-ai-link-text">
        <strong>{session.text.miniAppAiTitle}</strong>
        <small>{session.text.miniAppAiHint}</small>
      </span>
      <i class="ph ph-arrow-right miniapps-ai-link-arrow" aria-hidden="true"></i>
    </button>
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
              {#if app.aiCapabilities.length > 0}
                <p class="miniapps-tools">{session.text.miniAppAiCapabilities}: {app.aiCapabilities.join(", ")}</p>
                <!--
                  Availability comes from the shared store, not a second fetch:
                  this warning and the model selector in Settings must never
                  disagree about what is configured.
                -->
                {#if (app.aiCapabilities.includes("text") && !miniAppsStore.aiAvailability.text) || (app.aiCapabilities.includes("transcription") && !miniAppsStore.aiAvailability.transcription)}
                  <p class="miniapps-error">{session.text.miniAppAiUnavailable}</p>
                {/if}
              {/if}
              {#if app.hostCapabilities.length > 0}
                <p class="miniapps-tools">
                  {session.text.miniAppHostCapabilities}: {app.hostCapabilities.map((capability) => capability === "audioCapture" ? session.text.miniAppAudioCaptureCapability : capability === "fileSave" ? session.text.miniAppFileSaveCapability : capability).join(", ")}
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
