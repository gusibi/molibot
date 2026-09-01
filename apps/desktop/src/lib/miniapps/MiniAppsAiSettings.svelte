<script lang="ts">
  import Coins from "reicon-svelte/icons/Coins";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import type {
    DesktopMiniAppAiSettings,
    DesktopMiniAppAiUsage,
    DesktopModelOption
  } from "@molibot/desktop-contract";
  import { loadDesktopMiniAppAi, loadDesktopModels, saveDesktopMiniAppAiSettings } from "../api";
  import { groupModelOptions } from "../presentation";

  /**
   * Which host models Mini Apps may use, plus their recent spend.
   *
   * Lives in Settings › Models rather than on the Mini Apps page: this is one
   * global decision about the owner's own model configuration — the same kind
   * of decision as every other route on that screen — not something you tune
   * while browsing installed apps. The Mini Apps page links here instead of
   * repeating the controls, so there is exactly one place the value is edited
   * and no chance of two surfaces disagreeing.
   *
   * It is rendered with the Models page's own `SettingGroup`/`SettingRow`
   * primitives so it reads as part of that screen rather than a transplant.
   *
   * Every control commits immediately through its own route — this is not part
   * of any surrounding settings form, and must never be submitted by one.
   */

  let lastEndpoint = $state("");
  let settings = $state<DesktopMiniAppAiSettings>({ textModelKey: "", transcriptionModelKey: "" });
  let textModels = $state<DesktopModelOption[]>([]);
  let transcriptionModels = $state<DesktopModelOption[]>([]);
  let usage = $state<DesktopMiniAppAiUsage[]>([]);
  let busy = $state(false);

  // Gated on the endpoint actually changing: a bare read would re-fire on every
  // unrelated store tick and refetch the models on each one (pitfall #2).
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== lastEndpoint) {
      lastEndpoint = session.endpoint;
      void Promise.all([
        loadDesktopMiniAppAi(session.endpoint),
        loadDesktopModels(session.endpoint, "text"),
        loadDesktopModels(session.endpoint, "stt")
      ]).then(([ai, text, transcription]) => {
        settings = ai.settings;
        usage = ai.usage;
        textModels = text.options;
        transcriptionModels = transcription.options;
      });
    }
  });

  async function updateSetting(key: keyof DesktopMiniAppAiSettings, value: string): Promise<void> {
    if (!session.endpoint || busy) return;
    busy = true;
    try {
      // The route answers with the saved record, so the control shows what was
      // persisted rather than what was clicked.
      settings = await saveDesktopMiniAppAiSettings(session.endpoint, { ...settings, [key]: value });
    } finally {
      busy = false;
    }
  }

  function modelOptions(options: DesktopModelOption[]) {
    return [
      { value: "", label: session.text.miniAppAiFollowGlobal },
      ...groupModelOptions(options).flatMap((group) => group.options.map(({ option, name }) => ({
        value: option.key,
        label: name,
        group: group.provider
      })))
    ];
  }
</script>

<SettingGroup title={session.text.miniAppAiTitle} description={session.text.miniAppAiHint}>
  <SettingRow title={session.text.miniAppAiTextModel}>
    <SelectControl
      value={settings.textModelKey}
      ariaLabel={session.text.miniAppAiTextModel}
      disabled={busy}
      options={modelOptions(textModels)}
      technicalId={settings.textModelKey}
      technicalLabel={session.text.technicalDetails}
      onChange={(value) => void updateSetting("textModelKey", value)}
    />
  </SettingRow>
  <SettingRow title={session.text.miniAppAiTranscriptionModel}>
    <SelectControl
      value={settings.transcriptionModelKey}
      ariaLabel={session.text.miniAppAiTranscriptionModel}
      disabled={busy}
      options={modelOptions(transcriptionModels)}
      technicalId={settings.transcriptionModelKey}
      technicalLabel={session.text.technicalDetails}
      onChange={(value) => void updateSetting("transcriptionModelKey", value)}
    />
  </SettingRow>
  <p class="miniapps-trust miniapps-ai-note"><Coins size={14} aria-hidden="true" /><span>{session.text.miniAppAiCostWarning}</span></p>
  <div class="miniapps-ai-usage">
    <strong>{session.text.miniAppAiUsageTitle}</strong>
    {#if usage.length === 0}
      <p>{session.text.miniAppAiUsageEmpty}</p>
    {:else}
      <ul>
        {#each usage as row (row.appId)}
          <li>
            <span><strong>{row.appId}</strong><small>{row.successes} ✓ · {row.failures} ✕</small></span>
            <span>{session.text.miniAppAiUsageRequests.replace("{n}", String(row.requests))} · {session.text.miniAppAiUsageTokens.replace("{n}", String(row.totalTokens))} · {session.text.miniAppAiUsageAudio.replace("{n}", new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(row.audioSeconds))}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SettingGroup>
