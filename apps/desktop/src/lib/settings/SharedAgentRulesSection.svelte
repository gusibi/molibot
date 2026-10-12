<script lang="ts">
  import Button from "../components/ui/Button.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import { loadDesktopSharedAgentRules, saveDesktopSharedAgentRules } from "../api";
  import { session, notifySettingsChanged } from "../stores/session.svelte";
  let { onClose }: { onClose: () => void } = $props();
  let rules = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let loaded = $state(false);
  let error = $state("");
  let retry = $state(0);
  const zh = $derived(session.locale === "zh-CN");
  $effect(() => {
    const endpoint = session.endpoint;
    retry;
    if (!endpoint) return;
    let active = true;
    loading = true;
    loaded = false;
    error = "";
    loadDesktopSharedAgentRules(endpoint).then(value => { if (active) { rules = value; loaded = true; } })
      .catch(cause => { if (active) error = String(cause); })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });
  async function save() {
    if (!session.endpoint || !loaded || loading || saving) return;
    saving = true;
    error = "";
    try {
      await saveDesktopSharedAgentRules(session.endpoint, rules);
      notifySettingsChanged();
      onClose();
    } catch (cause) { error = String(cause); }
    finally { saving = false; }
  }
</script>

<form onsubmit={event => { event.preventDefault(); void save(); }}>
  <SettingGroup title={zh ? "共享规则" : "Shared rules"} description={zh ? "对所有 Agent 生效。Agent 自己的规则继续保留，并在共享规则之后参与提示词；身份、模型及技能选择仍可按 Agent 单独配置。当前共享规则与 Momo 的 AGENTS.md 使用同一文件。保存后在下一轮对话读取。" : "Applies to every Agent. Agent rules remain and follow shared rules in the prompt. Identity, models and skills can still be configured per Agent. This baseline uses the same AGENTS.md as Momo. Read on the next turn after saving."}>
    <div class="shared-agent-rules-editor">
      {#if error}<p class="agent-settings-error" role="alert">{error}</p>{/if}
      {#if loading}<p>{session.text.loading}</p>
      {:else}
        <label class="settings-field"><span>AGENTS.md</span><textarea rows="16" bind:value={rules} spellcheck="false" disabled={saving}></textarea></label>
        {#if error}<Button disabled={saving} onclick={() => retry++}>{zh ? "重新加载" : "Reload"}</Button>{/if}
      {/if}
    </div>
  </SettingGroup>
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{zh ? "共享规则 · 所有 Agent" : "Shared rules · All Agents"}</span>
    <div class="settings-footbar-actions">
      <Button disabled={saving} onclick={onClose}>{session.text.cancel}</Button>
      <Button variant="primary" type="submit" disabled={!loaded || loading || saving}>{saving ? session.text.onboardingProviderSaving : session.text.save}</Button>
    </div>
  </footer>
</form>
