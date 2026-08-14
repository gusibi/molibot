<script lang="ts">
  import { onDestroy } from "svelte";
  import { parseMiniAppBridgeMessage, type MiniAppComposerInsertMode } from "@molibot/shared/miniappBridge";
  import {
    MINIAPP_HOST_CAPABILITY_PROTOCOL,
    miniAppHostCapabilityResult,
    parseMiniAppHostCapabilityMessage
  } from "@molibot/shared/miniappHostCapability";
  import { miniAppPanelUrl } from "../api";
  import { miniAppsStore } from "../stores/miniapps.svelte";
  import {
    miniAppAudioCaptureStatus,
    pauseMiniAppAudioCapture,
    resumeMiniAppAudioCapture,
    startMiniAppAudioCapture,
    stopMiniAppAudioCapture
  } from "./audioCaptureCoordinator";

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
    copy,
    deepLinkPath = "",
    onComposerInsert,
    onComposerAttach,
    onOpenSession
  }: {
    appId: string;
    locale: string;
    theme: "light" | "dark";
    copy: Record<string, string>;
    /**
     * App-defined locator from a `molibot://miniapp/<id>/<path>` deep link.
     *
     * Passed to the iframe as a URL hint exactly like locale/theme, and opaque
     * here on purpose: its meaning belongs to the app (roadmap §2.4).
     */
    deepLinkPath?: string;
    onComposerInsert: (text: string, mode: MiniAppComposerInsertMode) => void;
    onComposerAttach: (path: string, name: string) => void;
    onOpenSession: (sessionId: string) => void;
  } = $props();

  let frame = $state<HTMLIFrameElement | null>(null);

  const app = $derived(miniAppsStore.items.find((item) => item.id === appId) ?? null);

  // Reloading on locale/theme change is intentional: the app reads both as URL
  // hints at startup, which avoids a postMessage bridge for two display values.
  const frameUrl = $derived(miniAppPanelUrl(appId, locale, theme, deepLinkPath));
  const unavailableReason = $derived(
    !app
      ? copy.miniAppMissing
      : !app.enabled
        ? copy.miniAppDisabledPanel
        : app.status === "error"
          ? app.error || copy.miniAppLoadFailed
          : ""
  );

  async function handleHostCapability(event: MessageEvent): Promise<void> {
    const parsed = parseMiniAppHostCapabilityMessage(event.data);
    if (!parsed.ok) {
      console.warn("[miniapp-host-capability] message rejected", { appId, reason: parsed.reason });
      return;
    }
    const request = parsed.value;
    if (!app?.hostCapabilities.includes("audioCapture")) {
      frame?.contentWindow?.postMessage(miniAppHostCapabilityResult(request.requestId, {
        ok: false,
        error: "This Mini App is not allowed to capture audio."
      }), "*");
      return;
    }
    try {
      const payload = request.action === "audio.start"
        ? await startMiniAppAudioCapture(appId, request.meetingId, request.trackId)
        : request.action === "audio.pause"
          ? await pauseMiniAppAudioCapture(appId)
          : request.action === "audio.resume"
            ? await resumeMiniAppAudioCapture(appId)
        : request.action === "audio.stop"
          ? await stopMiniAppAudioCapture(appId)
          : await miniAppAudioCaptureStatus(appId);
      frame?.contentWindow?.postMessage(miniAppHostCapabilityResult(request.requestId, {
        ok: true,
        payload: payload ? { ...payload } : { active: false }
      }), "*");
    } catch (cause) {
      frame?.contentWindow?.postMessage(miniAppHostCapabilityResult(request.requestId, {
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause)
      }), "*");
    }
  }

  function onMessage(event: MessageEvent): void {
    // The primary check: the message must come from *this* panel's iframe, which
    // binds it to this appId in a way nothing on the page can forge.
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
    if ((event.data as { protocol?: unknown } | null)?.protocol === MINIAPP_HOST_CAPABILITY_PROTOCOL) {
      void handleHostCapability(event);
      return;
    }
    const parsed = parseMiniAppBridgeMessage(event.data);
    if (!parsed.ok) {
      console.warn("[miniapp-bridge] message rejected", { appId, reason: parsed.reason });
      return;
    }
    // Every branch hands off through an injected callback; this component never
    // imports a composer or conversation module, so it stays usable outside a
    // Chat host (pitfall #7).
    switch (parsed.value.action) {
      case "composer.insert":
        onComposerInsert(parsed.value.text, parsed.value.mode);
        return;
      case "composer.attach":
        onComposerAttach(parsed.value.path, parsed.value.name);
        return;
      case "chat.openSession":
        onOpenSession(parsed.value.sessionId);
        return;
      default: {
        // Labelled rather than silent: an action the parser accepted but the
        // panel forgot to route would otherwise look like the App misbehaving
        // (pitfall #26a).
        const unhandled: never = parsed.value;
        console.warn("[miniapp-bridge] action not handled by this host", { appId, action: (unhandled as { action: string }).action });
      }
    }
  }

  window.addEventListener("message", onMessage);
  onDestroy(() => window.removeEventListener("message", onMessage));
</script>

{#if unavailableReason}
  <div class="miniapp-panel-state" role="status">
    <p>{unavailableReason}</p>
    <small>{copy.miniAppManageHint}</small>
  </div>
{:else}
  {#key frameUrl}
    <iframe
      bind:this={frame}
      class="miniapp-frame"
      title={app?.name ?? appId}
      src={frameUrl}
      sandbox="allow-scripts allow-forms allow-same-origin"
      referrerpolicy="no-referrer"
    ></iframe>
  {/key}
{/if}
