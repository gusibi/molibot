<script lang="ts">
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import { piExtensionsCopy } from "../i18n";
  import { loadDesktopPiExtensions, runDesktopPiExtensionAction, type DesktopPiExtension, type DesktopPiExtensionAction } from "../api";
  import { notifySettingsChanged } from "../stores/session.svelte";

  let { endpoint, locale }: { endpoint: string; locale: string } = $props();
  let copy = $derived(piExtensionsCopy[locale === "zh-CN" ? "zh-CN" : "en"]);
  let extensions = $state<DesktopPiExtension[]>([]);
  let masterEnabled = $state(true);
  let mode = $state<"server" | "native">("server");
  let masterDraft = $state<boolean | undefined>(undefined);
  let toggleDrafts = $state<Record<string, boolean>>({});
  let loading = $state(false);
  let busy = $state(false);
  let error = $state("");
  let message = $state("");
  let input = $state("");
  let search = $state("");
  let preview = $state<{ input: string; description: string } | null>(null);
  let removing = $state<string | null>(null);
  let ready = $state(false);
  let generation = 0;
  let filtered = $derived(extensions.filter((extension) =>
    `${extension.name} ${extension.id} ${extension.description ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ));

  async function load(target: string, current: number): Promise<void> {
    loading = true;
    error = "";
    try {
      const result = await loadDesktopPiExtensions(target);
      if (current !== generation) return;
      extensions = result.extensions ?? [];
      masterEnabled = result.masterEnabled !== false;
      mode = result.mode ?? "server";
      ready = true;
    } catch (cause) {
      if (current === generation) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (current === generation) loading = false;
    }
  }

  $effect(() => {
    const target = endpoint;
    const current = ++generation;
    ready = false;
    extensions = [];
    busy = false;
    removing = null;
    preview = null;
    masterDraft = undefined;
    toggleDrafts = {};
    message = "";
    if (target) void load(target, current);
    return () => { generation++; };
  });

  async function act(action: DesktopPiExtensionAction): Promise<void> {
    if (!endpoint || busy || loading) return;
    const target = endpoint;
    const current = generation;
    busy = true;
    error = "";
    message = "";
    try {
      const result = await runDesktopPiExtensionAction(target, action);
      if (current !== generation) return;
      if (action.action === "resolve") {
        preview = { input: action.input, description: result.description ?? action.input };
        return;
      }
      if (result.extensions) extensions = result.extensions;
      if (result.masterEnabled !== undefined) masterEnabled = result.masterEnabled;
      if (result.mode !== undefined) mode = result.mode;
      if (action.action === "install") {
        input = "";
        preview = null;
        message = copy.installed;
      } else if (action.action === "uninstall") {
        removing = null;
        message = copy.removed;
      } else if (action.action === "reload") message = copy.refreshed;
      notifySettingsChanged();
    } catch (cause) {
      if (current === generation) error = cause instanceof Error ? cause.message : copy.installFailed;
    } finally {
      if (current === generation) busy = false;
    }
  }

  async function toggle(enabled: boolean, id?: string): Promise<void> {
    const current = generation;
    if (id) toggleDrafts[id] = enabled;
    else masterDraft = enabled;
    try {
      await act(id ? { action: "toggle", id, enabled } : { action: "setMaster", enabled });
    } finally {
      if (current === generation) {
        if (id) delete toggleDrafts[id];
        else masterDraft = undefined;
      }
    }
  }
</script>

<SettingGroup title={copy.title} description={copy.description}>
  <svelte:fragment slot="action">
    <button class="secondary-button" type="button" disabled={!endpoint || busy || loading} onclick={() => ready ? act({ action: "reload" }) : load(endpoint, generation)}>{busy ? copy.busy : copy.reload}</button>
  </svelte:fragment>
  <SettingRow title={copy.master} description={copy.masterHint}>
    <IosSwitch checked={masterDraft ?? masterEnabled} ariaLabel={copy.master} disabled={!ready || busy || loading} onCheckedChange={(enabled) => toggle(enabled)} />
  </SettingRow>
  <SettingRow title={copy.mode} description={copy.modeHint}>
    <SelectControl value={mode} options={[{value:"native",label:copy.nativeMode},{value:"server",label:copy.serverMode}]} disabled={!ready || busy || loading} ariaLabel={copy.mode} onChange={(value) => act({action:"setMode",mode:value === "native" ? "native" : "server"})} />
  </SettingRow>
  <div class="pi-extensions-content">
    <form class="pi-install-form" onsubmit={(event) => { event.preventDefault(); void act({ action: "resolve", input: input.trim() }); }}>
      <label for="pi-extension-source">{copy.source}</label>
      <div class="pi-source-row">
        <input id="pi-extension-source" class="text-input" placeholder={copy.placeholder} bind:value={input} disabled={busy} oninput={() => { preview = null; }} />
        <button class="secondary-button" type="submit" disabled={!ready || busy || loading || !input.trim()}>{copy.inspect}</button>
      </div>
    </form>
    {#if preview && preview.input === input.trim()}
      <div class="pi-install-preview">
        <p>{preview.description}</p>
        <p class="pi-secondary">{copy.installNotice}</p>
        <button class="primary-button" type="button" disabled={busy || loading} onclick={() => preview && act({ action: "install", input: preview.input })}>{busy ? copy.busy : copy.install}</button>
      </div>
    {/if}
    {#if error}<p class="pi-error" role="alert">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if loading}<p class="pi-secondary" role="status">{copy.loading}</p>
    {:else if ready && extensions.length === 0}<p class="pi-secondary">{copy.empty}</p>
    {:else if ready}
      <input class="text-input" type="search" aria-label={copy.search} placeholder={copy.search} bind:value={search} />
      {#if filtered.length === 0}<p class="pi-secondary">{copy.noMatch}</p>{/if}
      {#each filtered as extension (extension.id)}
        <article class="pi-extension-row" aria-label={extension.name}>
          <div class="pi-extension-heading">
            <div class="pi-extension-identity"><strong>{extension.name}</strong>{#if extension.version !== "unknown"}<span class="pi-secondary">v{extension.version}</span>{/if}</div>
            <IosSwitch checked={toggleDrafts[extension.id] ?? extension.enabled} ariaLabel={extension.name} disabled={busy || loading} onCheckedChange={(enabled) => toggle(enabled, extension.id)} />
          </div>
          <p class="pi-secondary">{extension.error ? copy.error : !masterEnabled ? copy.paused : extension.enabled ? copy.enabled : copy.disabled}{extension.disabledBots.length ? ` · ${copy.restricted}` : ""}</p>
          {#if extension.description}<p>{extension.description}</p>{/if}
          <details>
            <summary>{copy.tools}: {extension.toolNames.length} · {copy.commands}: {extension.commandNames.length} · {copy.events}: {extension.eventNames.length}</summary>
            {#if extension.toolNames.length}<p>{copy.tools}: {extension.toolNames.join(", ")}</p>{/if}
            {#if extension.commandNames.length}<p>{copy.commands}: {extension.commandNames.map((name) => `/${name}`).join(", ")}</p>{/if}
            {#if extension.eventNames.length}<p>{copy.events}: {extension.eventNames.join(", ")}</p>{/if}
            {#if extension.unsupported.length}<p>{copy.unsupported}: {extension.unsupported.join(", ")}</p>{/if}
          </details>
          {#if extension.error}<p class="pi-error">{extension.error}</p>{/if}
          <div class="pi-row-actions">
            {#if removing === extension.id}
              <span>{copy.confirmUninstall}</span>
              <button class="secondary-button" type="button" disabled={busy} onclick={() => removing = null}>{copy.cancel}</button>
              <button class="danger-button" type="button" disabled={busy} onclick={() => act({ action: "uninstall", id: extension.id })}>{copy.uninstall}</button>
            {:else}<button class="tertiary-button" type="button" disabled={busy} onclick={() => removing = extension.id}>{copy.uninstall}</button>{/if}
          </div>
        </article>
      {/each}
    {/if}
    <p class="pi-secondary">{copy.boundary}</p>
  </div>
</SettingGroup>

<style>
  .pi-extensions-content { display: grid; gap: 16px; padding: 16px; min-width: 0; }
  .pi-install-form { display: grid; gap: 8px; }
  .pi-source-row, .pi-extension-heading, .pi-row-actions { display: flex; align-items: center; gap: 12px; }
  .pi-source-row input { flex: 1; min-width: 0; }
  .pi-extension-heading { justify-content: space-between; }
  .pi-extension-identity { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
  .pi-extension-row { border-top: 1px solid var(--separator); padding-top: 16px; display: grid; gap: 8px; min-width: 0; }
  .pi-row-actions { justify-content: flex-end; flex-wrap: wrap; }
  .pi-install-preview { display: grid; justify-items: start; gap: 8px; }
  p { margin: 0; overflow-wrap: anywhere; }
  .pi-secondary { color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .pi-error { color: var(--danger); white-space: pre-wrap; }
  summary { cursor: pointer; font-size: var(--fs-meta); line-height: var(--lh-meta); overflow-wrap: anywhere; }
  @media (max-width: 520px) { .pi-source-row { align-items: stretch; flex-direction: column; } }
</style>
