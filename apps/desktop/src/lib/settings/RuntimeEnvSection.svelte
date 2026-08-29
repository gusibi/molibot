<script lang="ts">
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { runtimeEnvStore, loadRuntimeEnv } from "../stores/runtimeEnv.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== runtimeEnvStore.endpoint) {
      void loadRuntimeEnv(session.endpoint);
    }
  });
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.unavailable} icon="shield-warning" /></SettingGroup>
{:else if runtimeEnvStore.loading || !runtimeEnvStore.runtimeEnv}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.runtimeEnv}>
    <SettingRow title={`${session.text.runtimeDepStatusInstalled}: ${runtimeEnvStore.runtimeEnv.counts.installed}`}>
      <span class="diag-value">{session.text.runtimeDepStatusMissing}: {runtimeEnvStore.runtimeEnv.counts.missing} · {runtimeEnvStore.runtimeEnv.counts.total} {session.text.runtimeDepTotal}</span>
    </SettingRow>
  </SettingGroup>
  <SettingGroup title={session.text.runtimeEnv} description={session.text.runtimeDepInstallDeferred}>
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
  </SettingGroup>
{/if}
