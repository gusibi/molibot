<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import AngleUp from "reicon-svelte/icons/AngleUp";
  import Code from "reicon-svelte/icons/Code";
  import Cpu from "reicon-svelte/icons/Cpu";
  import FileText from "reicon-svelte/icons/FileText";
  import InfoCircle from "reicon-svelte/icons/InfoCircle";
  import MagicWand from "reicon-svelte/icons/MagicWand";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Palette from "reicon-svelte/icons/Palette";
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import Dialog from "../components/ui/Dialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import { skillsStore, loadSkills, toggleSkill, updateBuiltinSkill } from "../stores/skills.svelte";
  import type { DesktopSkillItem } from "@molibot/desktop-contract";

  let { copy, serviceEndpoint, serviceReady }: {
    copy: Translation;
    serviceEndpoint: string | null;
    serviceReady: boolean;
  } = $props();

  type SkillCategory = "all" | "builtin" | "workspace" | "agent";

  let loadedEndpoint = $state("");
  let query = $state("");
  let selectedCategory = $state<SkillCategory>("all");
  let expandedIds = $state(new Set<string>());
  let inspectedSkill = $state<DesktopSkillItem | null>(null);

  $effect(() => {
    if (serviceReady && serviceEndpoint && serviceEndpoint !== loadedEndpoint) {
      loadedEndpoint = serviceEndpoint;
      void loadSkills(serviceEndpoint);
    }
  });

  function scopeLabel(scope: "global" | "bot" | "chat" | "project"): string {
    if (scope === "project") return copy.skillScopeProject;
    if (scope === "bot") return copy.skillScopeBot;
    if (scope === "chat") return copy.skillScopeChat;
    return copy.skillScopeGlobal;
  }

  const builtinMap = $derived(
    new Map(skillsStore.skills?.builtins?.map((b) => [b.id, b]) ?? [])
  );

  function isBuiltin(skill: DesktopSkillItem): boolean {
    return builtinMap.has(skill.id);
  }

  function isAgent(skill: DesktopSkillItem): boolean {
    return skill.scope === "bot" || skill.scope === "chat" || Boolean(skill.botId) || Boolean(skill.chatId);
  }

  function isWorkspace(skill: DesktopSkillItem): boolean {
    return !isBuiltin(skill) && !isAgent(skill);
  }

  const categoryCounts = $derived.by(() => {
    const items = skillsStore.skills?.items ?? [];
    let builtin = 0;
    let workspace = 0;
    let agent = 0;
    for (const item of items) {
      if (isBuiltin(item)) builtin++;
      else if (isAgent(item)) agent++;
      else workspace++;
    }
    return { all: items.length, builtin, workspace, agent };
  });

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let filteredSkills = $derived(
    skillsStore.skills?.items.filter((skill) => {
      if (selectedCategory === "builtin" && !isBuiltin(skill)) return false;
      if (selectedCategory === "workspace" && !isWorkspace(skill)) return false;
      if (selectedCategory === "agent" && !isAgent(skill)) return false;
      if (!normalizedQuery) return true;
      return [skill.name, skill.description, skill.scope, skill.botId, skill.chatId, skill.id]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery);
    }) ?? []
  );

  function toggleDescription(id: string): void {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedIds = next;
  }

  function getSkillVisual(skill: DesktopSkillItem): {
    icon: typeof Code;
    tone: "code" | "doc" | "design" | "agent" | "default";
  } {
    const text = `${skill.id} ${skill.name}`.toLowerCase();
    if (/code|git|review|refactor|terminal|bash|debug|lint|branch|test/.test(text)) {
      return { icon: Code, tone: "code" };
    }
    if (/doc|prose|markdown|reading|book|writing|standards|audit|trim/.test(text)) {
      return { icon: FileText, tone: "doc" };
    }
    if (/design|taste|ui|theme|css|style|frontend|minimalist|color|visual/.test(text)) {
      return { icon: Palette, tone: "design" };
    }
    if (/agent|runtime|subagent|workflow|schedule|cron|steer|co-founder/.test(text)) {
      return { icon: Cpu, tone: "agent" };
    }
    return { icon: MagicWand, tone: "default" };
  }
</script>

{#if !serviceReady}
  <div class="workspace-empty"><p>{copy.skillsUnavailable}</p></div>
{:else if skillsStore.loading}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if skillsStore.error && !skillsStore.skills}
  <div class="workspace-empty" role="alert"><p>{copy.workspaceLoadFailed}</p><small>{skillsStore.error}</small><button class="secondary-button" type="button" onclick={() => serviceEndpoint && void loadSkills(serviceEndpoint)}>{copy.retryLoading}</button></div>
{:else if !skillsStore.skills}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if skillsStore.skills.items.length === 0}
  <div class="workspace-empty"><p>{copy.skillsEmpty}</p></div>
{:else}
  <div class="installed-skills-categories">
    <div class="automation-category-tabs" role="tablist" aria-label={copy.skillsSquare}>
      {#each [
        ["all", copy.searchScopeAll || "全部", categoryCounts.all],
        ["builtin", copy.skillBuiltins || "内置 Skill", categoryCounts.builtin],
        ["workspace", copy.taskScopeWorkspace || "工作区", categoryCounts.workspace],
        ["agent", copy.skillScopeBot || "Agent", categoryCounts.agent]
      ] as [category, label, count] (category)}
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === category}
          class:active={selectedCategory === category}
          onclick={() => (selectedCategory = category as SkillCategory)}
        >
          <span>{label}</span>
          <small>{count}</small>
        </button>
      {/each}
    </div>
  </div>

  <div class="installed-skills-toolbar">
    <label class="installed-skills-search">
      <Magnifier size={14} aria-hidden="true" />
      <input
        bind:value={query}
        autocomplete="off"
        spellcheck="false"
        aria-label={copy.skillsFilter}
        placeholder={copy.skillsFilterHint}
      />
    </label>
    <div class="installed-skills-summary">
      <span>{copy.skillsTotal} <strong>{skillsStore.skills.counts.total}</strong></span>
      <span>{copy.agentsEnabledCount} <strong>{skillsStore.skills.counts.enabled}</strong></span>
    </div>
  </div>

  {#if filteredSkills.length === 0}
    <div class="workspace-empty compact"><p>{copy.skillsNoMatches}</p></div>
  {:else}
    <div class="installed-skills-grid">
      {#each filteredSkills as skill (skill.id)}
        {@const visual = getSkillVisual(skill)}
        {@const Icon = visual.icon}
        {@const builtinState = builtinMap.get(skill.id)}
        <article class="installed-skill-card" class:disabled={!skill.enabled}>
          <div class="installed-skill-header">
            <div class="installed-skill-icon" data-tone={visual.tone} aria-hidden="true">
              <Icon weight="Filled" size={18} />
            </div>

            <div class="installed-skill-header-info">
              <div class="installed-skill-title">
                <strong>{skill.name}</strong>
              </div>
              <div class="installed-skill-meta">
                {#if isBuiltin(skill)}
                  <span class="installed-skill-meta-pill builtin">{copy.skillBuiltins}</span>
                {:else}
                  <span class="installed-skill-meta-pill">{scopeLabel(skill.scope)}</span>
                {/if}
                {#if skill.botId}<span class="installed-skill-meta-pill">{skill.botId}</span>{/if}
                {#if skill.chatId}<span class="installed-skill-meta-pill">{skill.chatId}</span>{/if}
                {#if skill.mcpServerCount > 0}<span class="installed-skill-meta-pill mcp">{copy.skillMcpServers}: {skill.mcpServerCount}</span>{/if}
              </div>
            </div>

            <div class="installed-skill-header-controls">
              <IosSwitch
                checked={skill.enabled}
                ariaLabel={`${skill.name}: ${skill.enabled ? copy.providerEnabled : copy.providerDisabled}`}
                disabled={Boolean(skillsStore.savingId)}
                onCheckedChange={(checked) => void toggleSkill(skill.id, checked)}
              />
            </div>
          </div>

          <div class="installed-skill-copy">
            {#if skill.description}
              <p class:expanded={expandedIds.has(skill.id)}>{skill.description}</p>
            {/if}
            {#if skill.description}
              <button
                class="installed-skill-expand"
                type="button"
                aria-expanded={expandedIds.has(skill.id)}
                onclick={() => toggleDescription(skill.id)}
              >
                {expandedIds.has(skill.id) ? copy.skillsShowLess : copy.skillsShowMore}
                {#if expandedIds.has(skill.id)}<AngleUp size={12} aria-hidden="true" />{:else}<AngleDown size={12} aria-hidden="true" />{/if}
              </button>
            {/if}
          </div>

          <div class="installed-skill-foot">
            <span class="installed-skill-id-badge" title={skill.id}>{skill.id}</span>
            <div class="installed-skill-actions">
              {#if builtinState?.updateAvailable}
                <button
                  class="primary-button compact"
                  type="button"
                  disabled={Boolean(skillsStore.updatingBuiltinId)}
                  onclick={() => void updateBuiltinSkill(skill.id)}
                >
                  {skillsStore.updatingBuiltinId === skill.id ? copy.miniAppUpdating : copy.miniAppUpdate}
                </button>
              {/if}
              <button
                class="secondary-button installed-skill-detail-btn"
                type="button"
                onclick={() => (inspectedSkill = skill)}
              >
                <InfoCircle size={13} aria-hidden="true" />
                <span>{copy.logsDetails}</span>
              </button>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
{/if}

{#if inspectedSkill}
  <Dialog
    open={Boolean(inspectedSkill)}
    contentClass="installed-skill-dialog"
    labelledBy="skill-dialog-title"
    onOpenChange={(open) => { if (!open) inspectedSkill = null; }}
  >
    <header class="modal-head">
      <div>
        <strong id="skill-dialog-title">{inspectedSkill.name}</strong>
        <p class="installed-skill-id-badge">{inspectedSkill.id}</p>
      </div>
      <button class="modal-close" type="button" aria-label={copy.dialogClose} onclick={() => (inspectedSkill = null)}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>

    <div class="modal-body">
      <div class="installed-skill-dialog-section">
        <strong>{copy.projectCommandDescriptionLabel}</strong>
        <p>{inspectedSkill.description || "-"}</p>
      </div>

      <dl class="installed-skill-dialog-props">
        <dt>{copy.hostBashColScope}</dt>
        <dd>{scopeLabel(inspectedSkill.scope)}</dd>

        {#if inspectedSkill.botId}
          <dt>Bot</dt>
          <dd>{inspectedSkill.botId}</dd>
        {/if}

        {#if inspectedSkill.chatId}
          <dt>{copy.skillScopeChat}</dt>
          <dd>{inspectedSkill.chatId}</dd>
        {/if}

        {#if inspectedSkill.mcpServerCount > 0}
          <dt>{copy.skillMcpServers}</dt>
          <dd>{inspectedSkill.mcpServerCount}</dd>
        {/if}

        {#if isBuiltin(inspectedSkill)}
          {@const builtinInfo = builtinMap.get(inspectedSkill.id)}
          <dt>{copy.skillBuiltins}</dt>
          <dd>
            v{builtinInfo?.installedVersion ?? "1.0.0"}
            {#if builtinInfo?.updateAvailable}
              · <span class="miniapps-update-badge">{copy.miniAppUpdateAvailable?.replace("{version}", builtinInfo.version) ?? "Update"}</span>
            {/if}
          </dd>
        {/if}

        <dt>{copy.logsStatus}</dt>
        <dd>
          <span class="status-badge" data-state={inspectedSkill.enabled ? "ready" : "disconnected"}>
            {inspectedSkill.enabled ? copy.providerEnabled : copy.providerDisabled}
          </span>
        </dd>
      </dl>
    </div>
  </Dialog>
{/if}
