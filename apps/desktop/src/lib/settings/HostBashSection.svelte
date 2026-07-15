<script lang="ts">
  import { session } from "../stores/session.svelte";
  import { hostBashStore, loadHostBash, toggleHostBashWhitelist } from "../stores/hostBash.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== hostBashStore.endpoint) {
      void loadHostBash(session.endpoint);
    }
  });
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.hostBashUnavailable}</p></div></div>
{:else if hostBashStore.loading || !hostBashStore.hostBash}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.hostBashPending}</strong><span class="diag-value">{hostBashStore.hostBash.counts.pending}</span></div>
    <div class="settings-row"><strong>{session.text.hostBashWhitelist}</strong><span class="diag-value">{hostBashStore.hostBash.counts.whitelistEnabled}/{hostBashStore.hostBash.counts.whitelist} {session.text.hostBashEnabled}</span></div>
    <div class="settings-row"><strong>{session.text.hostBashHistory}</strong><span class="diag-value">{hostBashStore.hostBash.counts.history}</span></div>
  </div>
  {#if hostBashStore.hostBash.whitelist.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.hostBashWhitelistEmpty}</p></div></div>
  {:else}
    <div class="settings-card">
      {#each hostBashStore.hostBash.whitelist as item (item.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{item.displayName || item.toolId}</strong>
            <p>{item.toolId} · {item.approvalMode} · {session.text.hostBashFs}: {item.permissions.filesystem} · {session.text.hostBashNet}: {item.permissions.network} · {session.text.hostBashEnv}: {item.permissions.envAllowlist}</p>
            {#if item.reason}<p>{item.reason}</p>{/if}
          </div>
          <button
            class:active={item.enabled}
            class="switch"
            type="button"
            role="switch"
            aria-label={item.displayName || item.toolId}
            aria-checked={item.enabled}
            disabled={hostBashStore.togglingId === item.id}
            onclick={() => void toggleHostBashWhitelist(item.id, !item.enabled)}
          >
            <span></span>
          </button>
        </div>
      {/each}
    </div>
  {/if}
{/if}
