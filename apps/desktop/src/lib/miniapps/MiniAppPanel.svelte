<script lang="ts">
  import { miniAppPanelUrl } from "../api";
  import { miniAppsStore } from "../stores/miniapps.svelte";

  /**
   * The Mini App iframe frame - the body of a Mini App tab in the Artifact Panel.
   *
   * Deliberately knows nothing about any individual app's domain: no per-app
   * branching of any kind. Everything it shows comes from the catalog entry, and
   * everything else happens inside the iframe.
   *
   * The iframe loads from `molibot-miniapp://<app-id>/`, a fixed origin the
   * build-time CSP can name, which the Tauri transport forwards to the runtime
   * service port. It never points at a loopback URL.
   */
  let {
    appId,
    locale,
    theme,
    copy
  }: {
    appId: string;
    locale: string;
    theme: "light" | "dark";
    copy: Record<string, string>;
  } = $props();

  const app = $derived(miniAppsStore.items.find((item) => item.id === appId) ?? null);

  // Reloading on locale/theme change is intentional: the app reads both as URL
  // hints at startup, which avoids a postMessage bridge for two display values.
  const frameUrl = $derived(miniAppPanelUrl(appId, locale, theme));
  const unavailableReason = $derived(
    !app
      ? copy.miniAppMissing
      : !app.enabled
        ? copy.miniAppDisabledPanel
        : app.status === "error"
          ? app.error || copy.miniAppLoadFailed
          : ""
  );
</script>

{#if unavailableReason}
  <div class="miniapp-panel-state" role="status">
    <p>{unavailableReason}</p>
    <small>{copy.miniAppManageHint}</small>
  </div>
{:else}
  {#key frameUrl}
    <iframe
      class="miniapp-frame"
      title={app?.name ?? appId}
      src={frameUrl}
      sandbox="allow-scripts allow-forms allow-same-origin"
      referrerpolicy="no-referrer"
    ></iframe>
  {/key}
{/if}
