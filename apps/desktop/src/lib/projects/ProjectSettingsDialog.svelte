<script lang="ts">
  import type { DesktopModelOption, DesktopThinkingLevel } from "@molibot/desktop-contract";
  import type { DesktopProject } from "../api";
  import type { Translation } from "../i18n";
  import { saveProjectSettings, projectsStore } from "../stores/projects.svelte";

  export let project: DesktopProject;
  export let copy: Translation;
  export let modelOptions: DesktopModelOption[] = [];
  export let onClose: () => void;

  let name = project.name;
  let instructions = project.instructions ?? "";
  let modelKey = project.modelKey ?? "";
  let thinkingLevel: "" | DesktopThinkingLevel = project.thinkingLevel ?? "";
  let sandboxEnabled = project.sandboxEnabled === undefined ? "" : project.sandboxEnabled ? "on" : "off";
  let toolProgress = project.toolProgress ?? "";
  let showReasoning = project.showReasoning ?? "";
  let runLogNotice = project.runLogNotice === undefined ? "" : project.runLogNotice ? "on" : "off";
  let saved = false;

  async function save(): Promise<void> {
    const ok = await saveProjectSettings(project.id, {
      name,
      instructions,
      modelKey: modelKey || null,
      thinkingLevel: thinkingLevel || null,
      sandboxEnabled: sandboxEnabled === "" ? null : sandboxEnabled === "on",
      toolProgress: (toolProgress || null) as DesktopProject["toolProgress"] | null,
      showReasoning: (showReasoning || null) as DesktopProject["showReasoning"] | null,
      runLogNotice: runLogNotice === "" ? null : runLogNotice === "on"
    });
    if (ok) { saved = true; onClose(); }
  }
</script>

<div class="modal-overlay project-settings-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={copy.projectSettings} onclick={(event) => { if (event.target === event.currentTarget && !projectsStore.busy) onClose(); }} onkeydown={(event) => { if (event.key === "Escape" && !projectsStore.busy) onClose(); }}>
  <form class="modal-card project-settings-modal" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <header class="modal-head"><div><strong>{copy.projectSettings}</strong><p>{copy.projectSettingsHint}</p></div><button class="modal-close" type="button" aria-label={copy.cancel} disabled={Boolean(projectsStore.busy)} onclick={onClose}><i class="ph ph-x"></i></button></header>
    <div class="modal-body project-settings-body">
      <div class="settings-form">
        <label class="settings-field"><span>{copy.projectName}</span><input bind:value={name} required /></label>
        <label class="settings-field"><span>{copy.projectPath}</span><input value={project.rootPath} readonly /></label>
        <label class="settings-field settings-field-wide"><span>{copy.projectInstructions}</span><textarea rows="5" bind:value={instructions} placeholder={copy.projectInstructionsHint}></textarea></label>
        <label class="settings-field"><span>{copy.projectDefaultModel}</span><select bind:value={modelKey}><option value="">{copy.projectFollowGlobal}</option>{#each modelOptions as model (model.key)}<option value={model.key}>{model.label}</option>{/each}</select></label>
        <label class="settings-field"><span>{copy.projectDefaultThinking}</span><select bind:value={thinkingLevel}><option value="">{copy.projectFollowGlobal}</option><option value="off">{copy.thinkingOff}</option><option value="low">{copy.thinkingLow}</option><option value="medium">{copy.thinkingMedium}</option><option value="high">{copy.thinkingHigh}</option></select></label>
        <label class="settings-field"><span>{copy.projectSandbox}</span><select bind:value={sandboxEnabled}><option value="">{copy.projectFollowGlobal}</option><option value="on">{copy.profileSandboxOn}</option><option value="off">{copy.profileSandboxOff}</option></select><small>{copy.projectSandboxHint}</small></label>
        <label class="settings-field"><span>{copy.projectToolProgress}</span><select bind:value={toolProgress}><option value="">{copy.projectFollowGlobal}</option><option value="off">{copy.projectDisplayOff}</option><option value="new">{copy.projectDisplayNew}</option><option value="all">{copy.projectDisplayAll}</option><option value="verbose">{copy.projectDisplayVerbose}</option></select></label>
        <label class="settings-field"><span>{copy.projectReasoning}</span><select bind:value={showReasoning}><option value="">{copy.projectFollowGlobal}</option><option value="off">{copy.projectDisplayOff}</option><option value="on">{copy.projectDisplayOn}</option><option value="stream">{copy.projectDisplayStream}</option><option value="new">{copy.projectDisplayNew}</option></select></label>
        <label class="settings-field"><span>{copy.projectRunlogNotice}</span><select bind:value={runLogNotice}><option value="">{copy.projectFollowGlobal}</option><option value="on">{copy.projectDisplayOn}</option><option value="off">{copy.projectDisplayOff}</option></select></label>
      </div>
    </div>
    <footer class="settings-footbar"><span class="settings-footbar-label">{saved ? copy.projectSettingsSaved : projectsStore.error}</span><div class="settings-footbar-actions"><button class="secondary-button" type="button" onclick={onClose}>{copy.cancel}</button><button class="primary-button" type="submit" disabled={!name.trim() || Boolean(projectsStore.busy)}>{copy.save}</button></div></footer>
  </form>
</div>
