<script lang="ts">
  import { session } from "../stores/session.svelte";
  import { runtimeEnvStore, loadRuntimeEnv } from "../stores/runtimeEnv.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== runtimeEnvStore.endpoint) {
      void loadRuntimeEnv(session.endpoint);
    }
  });
</script>

<p class="settings-section-hint">{session.text.runtimeEnvHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.unavailable}</p></div></div>
{:else if runtimeEnvStore.loading || !runtimeEnvStore.runtimeEnv}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row">
      <strong>{session.text.runtimeDepStatusInstalled}: {runtimeEnvStore.runtimeEnv.counts.installed}</strong>
      <span class="diag-value">{session.text.runtimeDepStatusMissing}: {runtimeEnvStore.runtimeEnv.counts.missing} · {runtimeEnvStore.runtimeEnv.counts.total} {session.text.runtimeDepTotal}</span>
    </div>
  </div>
  <div class="settings-card">
    {#each runtimeEnvStore.runtimeEnv.dependencies as dep (dep.id)}
      <div class="settings-row runtime-dep-row">
        <div class="profile-info">
          <strong>{dep.name}</strong>
          <span class="status-badge" data-state={dep.status === "installed" ? "ready" : dep.status === "missing" ? "error" : "incompatible"}>
            {dep.status === "installed" ? session.text.runtimeDepStatusInstalled : dep.status === "missing" ? session.text.runtimeDepStatusMissing : session.text.runtimeDepStatusUnknown}
          </span>
          <p>{session.text.runtimeDepPurpose}: {dep.purpose}</p>
          <p>{session.text.runtimeDepVersion}: {dep.version || "—"} · {session.text.runtimeDepSource}: {dep.source} · {session.text.runtimeDepSize}: {dep.estimatedSize}</p>
          {#if dep.installCommand}
            <p class="runtime-install-command"><code>{dep.installCommand}</code></p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  <p class="settings-section-hint">{session.text.runtimeDepInstallDeferred}</p>
{/if}
