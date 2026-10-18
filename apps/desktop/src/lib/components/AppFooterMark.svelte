<script lang="ts">
  import { appLogo } from "../stores/appLogo.svelte";
  import type { Translation } from "../i18n";

  // One identity mark shared by every sidebar footer (chat, settings): the app
  // logo carries the service state as a ring dot and the name is the only text.
  // There is no idle status line — the dot colour is the status, and the img alt
  // keeps it accessible wherever the host row is not a labelled control.
  let {
    copy,
    serviceState = "disconnected",
    showName = true
  }: {
    copy: Translation;
    serviceState?: "disconnected" | "ready" | "incompatible" | "error";
    showName?: boolean;
  } = $props();

  const statusLabel = $derived(serviceState === "ready" ? copy.statusOnline : copy.statusOffline);
</script>

<span class="sidebar-footer-logo-wrap" data-state={serviceState}>
  <img class="sidebar-footer-logo" src={appLogo.src} alt={`${copy.appName} · ${statusLabel}`} width="24" height="24" />
</span>
{#if showName}<span class="sidebar-footer-name">{copy.appName}</span>{/if}

<style>
  .sidebar-footer-logo-wrap {
    position: relative;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }
  .sidebar-footer-logo-wrap::after {
    content: "";
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 8px;
    height: 8px;
    border: 2px solid var(--sidebar-bg, #fff);
    border-radius: 50%;
    background: var(--gray-700, #8a8a8a);
  }
  .sidebar-footer-logo-wrap[data-state="ready"]::after { background: var(--online, #28a745); }
  .sidebar-footer-logo-wrap[data-state="error"]::after,
  .sidebar-footer-logo-wrap[data-state="incompatible"]::after { background: var(--danger, #ff453a); }
  .sidebar-footer-logo {
    display: block;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }
  .sidebar-footer-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    font-size: var(--fs-label);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
