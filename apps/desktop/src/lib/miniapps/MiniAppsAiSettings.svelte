<script lang="ts">
  import SelectControl from "../components/ui/SelectControl.svelte";
  import { session } from "../stores/session.svelte";
  import type {
    DesktopMiniAppAiSettings,
    DesktopMiniAppAiUsage,
    DesktopModelOption
  } from "@molibot/desktop-contract";
  import { loadDesktopMiniAppAi, loadDesktopModels, saveDesktopMiniAppAiSettings } from "../api";

  /**
   * Which host models Mini Apps may use, plus their recent spend.
   *
   * Lives in Settings rather than on the Mini Apps page: this is one global
   * decision about the owner's own model configuration, not something you tune
   * while browsing installed apps. The Mini Apps page links here instead of
   * repeating the controls, so there is exactly one place the value is edited
   * and no chance of two surfaces disagreeing.
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
      ...options.map((model) => ({ value: model.key, label: model.alias || model.label }))
    ];
  }
</script>

<section class="settings-card miniapps-ai-settings" aria-labelledby="miniapps-ai-title">
  <div class="settings-row">
    <div>
      <strong id="miniapps-ai-title">{session.text.miniAppAiTitle}</strong>
      <p>{session.text.miniAppAiHint}</p>
    </div>
  </div>
  <div class="settings-form">
    <label class="settings-field">
      <span>{session.text.miniAppAiTextModel}</span>
      <SelectControl
        value={settings.textModelKey}
        ariaLabel={session.text.miniAppAiTextModel}
        disabled={busy}
        options={modelOptions(textModels)}
        onChange={(value) => void updateSetting("textModelKey", value)}
      />
    </label>
    <label class="settings-field">
      <span>{session.text.miniAppAiTranscriptionModel}</span>
      <SelectControl
        value={settings.transcriptionModelKey}
        ariaLabel={session.text.miniAppAiTranscriptionModel}
        disabled={busy}
        options={modelOptions(transcriptionModels)}
        onChange={(value) => void updateSetting("transcriptionModelKey", value)}
      />
    </label>
  </div>
  <p class="miniapps-trust"><i class="ph ph-coins" aria-hidden="true"></i><span>{session.text.miniAppAiCostWarning}</span></p>
  <div class="miniapps-ai-usage">
    <strong>{session.text.miniAppAiUsageTitle}</strong>
    {#if usage.length === 0}
      <p>{session.text.miniAppAiUsageEmpty}</p>
    {:else}
      <ul>
        {#each usage as row (row.appId)}
          <li>
            <span><strong>{row.appId}</strong><small>{row.successes} ✓ · {row.failures} ✕</small></span>
            <span>{session.text.miniAppAiUsageRequests.replace("{n}", String(row.requests))} · {session.text.miniAppAiUsageTokens.replace("{n}", String(row.totalTokens))} · {session.text.miniAppAiUsageAudio.replace("{n}", row.audioSeconds.toFixed(1))}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
