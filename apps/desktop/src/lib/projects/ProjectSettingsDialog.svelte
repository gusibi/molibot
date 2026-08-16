<script lang="ts">
  import {
    DESKTOP_THINKING_LEVELS,
    type DesktopModelOption,
    type DesktopThinkingLevel
  } from "@molibot/desktop-contract";
  import type { DesktopProject, DesktopProjectCustomCommand } from "../api";
  import type { Translation } from "../i18n";
  import { saveProjectSettings, projectsStore } from "../stores/projects.svelte";
  import { modelOptionCopy } from "../presentation";
  import Dialog from "../components/ui/Dialog.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import TasksSection from "../settings/TasksSection.svelte";

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
  let customCommands: DesktopProjectCustomCommand[] = (project.customCommands ?? []).map((command) => ({ ...command }));
  let saved = false;
  let commandError = "";
  let activeTab: "general" | "automations" = "general";

  /**
   * The same slug rule the Project store applies before persisting. Normalizing
   * as the owner types keeps the field honest: what the row shows is what `/`
   * will actually list, instead of the server quietly rewriting (or rejecting)
   * the name after a save that reported success.
   */
  function normalizeCommandName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /** A row the owner added but never filled in — dropping it is not data loss. */
  function isBlankCommand(command: DesktopProjectCustomCommand): boolean {
    return !command.name.trim() && !command.content.trim() && !command.description?.trim();
  }

  function addCustomCommand(): void {
    customCommands = [...customCommands, { name: "", content: "", description: "" }];
  }

  function removeCustomCommand(index: number): void {
    customCommands = customCommands.filter((_, i) => i !== index);
  }

  function updateCustomCommand(index: number, patch: Partial<DesktopProjectCustomCommand>): void {
    customCommands = customCommands.map((command, i) => (i === index ? { ...command, ...patch } : command));
  }
  $: thinkingLevelOptions = modelKey
    ? modelOptions.find((model) => model.key === modelKey)?.thinkingLevels ?? DESKTOP_THINKING_LEVELS
    : DESKTOP_THINKING_LEVELS;

  function thinkingLabel(level: DesktopThinkingLevel): string {
    return {
      off: copy.thinkingOff,
      minimal: copy.thinkingMinimal,
      low: copy.thinkingLow,
      medium: copy.thinkingMedium,
      high: copy.thinkingHigh,
      xhigh: copy.thinkingXHigh,
      max: copy.thinkingMax
    }[level];
  }

  async function save(): Promise<void> {
    // A half-filled command must never be dropped in silence: the store's
    // sanitizer discards any command without a body or with a name that slugs
    // to nothing, so saving "succeeded" while the row vanished on reopen.
    // Refuse the save and say which row needs what instead (issue #28).
    const pending = customCommands.filter((command) => !isBlankCommand(command));
    const invalid = pending.find((command) => !normalizeCommandName(command.name));
    if (invalid) {
      commandError = copy.projectCommandInvalidName;
      return;
    }
    const empty = pending.find((command) => !command.content.trim());
    if (empty) {
      commandError = copy.projectCommandEmptyContent.replace("{name}", normalizeCommandName(empty.name));
      return;
    }
    commandError = "";
    const ok = await saveProjectSettings(project.id, {
      name,
      instructions,
      modelKey: modelKey || null,
      thinkingLevel: thinkingLevel || null,
      sandboxEnabled: sandboxEnabled === "" ? null : sandboxEnabled === "on",
      toolProgress: (toolProgress || null) as DesktopProject["toolProgress"] | null,
      showReasoning: (showReasoning || null) as DesktopProject["showReasoning"] | null,
      runLogNotice: runLogNotice === "" ? null : runLogNotice === "on",
      customCommands: pending.map((command) => ({
        name: normalizeCommandName(command.name),
        content: command.content,
        description: command.description?.trim() || undefined
      }))
    });
    if (ok) { saved = true; onClose(); }
  }
</script>

<Dialog open={true} busy={Boolean(projectsStore.busy)} contentClass="project-settings-modal" labelledBy="project-settings-title" describedBy="project-settings-hint" onOpenChange={(next) => { if (!next) onClose(); }}>
  <header class="modal-head"><div><strong id="project-settings-title">{copy.projectSettings}</strong><p id="project-settings-hint">{copy.projectSettingsHint}</p></div><button class="modal-close" type="button" aria-label={copy.cancel} disabled={Boolean(projectsStore.busy)} onclick={onClose}><i class="ph ph-x"></i></button></header>
  <div class="project-settings-tabs" role="tablist" aria-label={copy.projectSettings}>
    <button class:active={activeTab === "general"} type="button" role="tab" aria-selected={activeTab === "general"} onclick={() => activeTab = "general"}>{copy.projectGeneralTab}</button>
    <button class:active={activeTab === "automations"} type="button" role="tab" aria-selected={activeTab === "automations"} onclick={() => activeTab = "automations"}>{copy.projectAutomationsTab}</button>
  </div>
  {#if activeTab === "general"}<form class="project-settings-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <div class="modal-body project-settings-body">
      <div class="settings-form">
        <label class="settings-field"><span>{copy.projectName}</span><input bind:value={name} required /></label>
        <label class="settings-field"><span>{copy.projectPath}</span><input value={project.rootPath} readonly /></label>
        <label class="settings-field settings-field-wide"><span>{copy.projectInstructions}</span><textarea rows="5" bind:value={instructions} placeholder={copy.projectInstructionsHint}></textarea></label>
        <label class="settings-field"><span>{copy.projectDefaultModel}</span><SelectControl value={modelKey} ariaLabel={copy.projectDefaultModel} options={[{ value: "", label: copy.projectFollowGlobal }, ...modelOptions.map((model) => ({ value: model.key, label: modelOptionCopy(model).name }))]} onChange={(value) => modelKey = value} /></label>
        <label class="settings-field"><span>{copy.projectDefaultThinking}</span><SelectControl value={thinkingLevel} ariaLabel={copy.projectDefaultThinking} options={[{ value: "", label: copy.projectFollowGlobal }, ...thinkingLevelOptions.map((level) => ({ value: level, label: thinkingLabel(level) }))]} onChange={(value) => thinkingLevel = value as "" | DesktopThinkingLevel} /></label>
        <label class="settings-field"><span>{copy.projectSandbox}</span><SelectControl value={sandboxEnabled} ariaLabel={copy.projectSandbox} options={[{ value: "", label: copy.projectFollowGlobal }, { value: "on", label: copy.profileSandboxOn }, { value: "off", label: copy.profileSandboxOff }]} onChange={(value) => sandboxEnabled = value} /><small>{copy.projectSandboxHint}</small></label>
        <label class="settings-field"><span>{copy.projectToolProgress}</span><SelectControl value={toolProgress} ariaLabel={copy.projectToolProgress} options={[{ value: "", label: copy.projectFollowGlobal }, { value: "off", label: copy.projectDisplayOff }, { value: "new", label: copy.projectDisplayNew }, { value: "all", label: copy.projectDisplayAll }, { value: "verbose", label: copy.projectDisplayVerbose }]} onChange={(value) => toolProgress = value as typeof toolProgress} /></label>
        <label class="settings-field"><span>{copy.projectReasoning}</span><SelectControl value={showReasoning} ariaLabel={copy.projectReasoning} options={[{ value: "", label: copy.projectFollowGlobal }, { value: "off", label: copy.projectDisplayOff }, { value: "on", label: copy.projectDisplayOn }, { value: "stream", label: copy.projectDisplayStream }, { value: "new", label: copy.projectDisplayNew }]} onChange={(value) => showReasoning = value as typeof showReasoning} /></label>
        <label class="settings-field"><span>{copy.projectRunlogNotice}</span><SelectControl value={runLogNotice} ariaLabel={copy.projectRunlogNotice} options={[{ value: "", label: copy.projectFollowGlobal }, { value: "on", label: copy.projectDisplayOn }, { value: "off", label: copy.projectDisplayOff }]} onChange={(value) => runLogNotice = value} /></label>
        <div class="settings-field settings-field-wide project-commands">
          <span>{copy.projectCommands}</span>
          <small class="project-commands-hint">{copy.projectCommandsHint}</small>
          <div class="project-commands-list">
            {#if customCommands.length === 0}
              <p class="project-commands-empty">{copy.projectCommandsEmpty}</p>
            {/if}
            {#each customCommands as command, index (index)}
              <div class="project-command-row">
                <label class="project-command-label" for={`project-command-name-${index}`}>{copy.projectCommandNameLabel}</label>
                <div class="project-command-slash"><span class="project-command-slash-mark" aria-hidden="true">/</span><input id={`project-command-name-${index}`} class="project-command-name" value={command.name} placeholder={copy.projectCommandNamePlaceholder} spellcheck="false" autocapitalize="off" autocorrect="off" oninput={(event) => updateCustomCommand(index, { name: (event.currentTarget as HTMLInputElement).value })} onblur={(event) => updateCustomCommand(index, { name: normalizeCommandName((event.currentTarget as HTMLInputElement).value) })} /></div>
                <button class="project-command-remove" type="button" aria-label={copy.projectCommandRemove} title={copy.projectCommandRemove} onclick={() => removeCustomCommand(index)}><i class="ph ph-trash" aria-hidden="true"></i></button>
                <label class="project-command-label" for={`project-command-desc-${index}`}>{copy.projectCommandDescriptionLabel}</label>
                <input id={`project-command-desc-${index}`} class="project-command-desc" value={command.description ?? ""} placeholder={copy.projectCommandDescriptionPlaceholder} oninput={(event) => updateCustomCommand(index, { description: (event.currentTarget as HTMLInputElement).value })} />
                <label class="project-command-label project-command-label-top" for={`project-command-content-${index}`}>{copy.projectCommandContentLabel}</label>
                <textarea id={`project-command-content-${index}`} class="project-command-content" rows="3" value={command.content} placeholder={copy.projectCommandContentPlaceholder} oninput={(event) => updateCustomCommand(index, { content: (event.currentTarget as HTMLTextAreaElement).value })}></textarea>
              </div>
            {/each}
          </div>
          <div class="project-commands-foot">
            <button class="secondary-button project-command-add" type="button" onclick={addCustomCommand}><i class="ph ph-plus" aria-hidden="true"></i>{copy.projectCommandAdd}</button>
            {#if commandError}<small class="project-commands-error" role="alert"><i class="ph-fill ph-warning-circle" aria-hidden="true"></i>{commandError}</small>{/if}
          </div>
        </div>
      </div>
    </div>
    <footer class="settings-footbar project-settings-foot"><span class="settings-footbar-label project-settings-foot-label">{saved ? copy.projectSettingsSaved : projectsStore.error}</span><div class="settings-footbar-actions project-settings-foot-actions"><button class="secondary-button" type="button" onclick={onClose}>{copy.cancel}</button><button class="primary-button" type="submit" disabled={!name.trim() || Boolean(projectsStore.busy)}>{copy.save}</button></div></footer>
  </form>{:else}<div class="project-settings-automations"><TasksSection projectId={project.id} presentation="project" /></div>{/if}
</Dialog>
