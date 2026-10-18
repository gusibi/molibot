<script lang="ts">
  import { flushSync } from "svelte";
  import Code from "../icons/duotone/components/Code.svelte";
  import Cpu from "../icons/duotone/components/Cpu.svelte";
  import FileText from "../icons/duotone/components/FileText.svelte";
  import FolderOpen from "../icons/duotone/components/FolderOpen.svelte";
  import MagicWand from "../icons/duotone/components/MagicWand.svelte";
  import Palette from "../icons/duotone/components/Palette.svelte";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import Copy from "reicon-svelte/icons/Copy";
  import FolderOpenIcon from "reicon-svelte/icons/FolderOpen";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import ChatHeader from "./ChatHeader.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import { renderMarkdown } from "../markdown";
  import { loadDesktopSkillDetail, loadDesktopSkillFile, revealDesktopSkill } from "../api";
  import { captureRectMap, listFlip, listIn, listOut, playLayoutFlip } from "../motion/listMotion";
  import { skillsStore, loadSkills, toggleSkill, updateBuiltinSkill } from "../stores/skills.svelte";
  import type { DesktopSkillDetail, DesktopSkillFileEntry, DesktopSkillItem } from "@molibot/desktop-contract";

  let { copy, serviceEndpoint, serviceReady }: {
    copy: Translation;
    serviceEndpoint: string | null;
    serviceReady: boolean;
  } = $props();

  type SkillCategory = "all" | "builtin" | "workspace" | "agent";

  let loadedEndpoint = $state("");
  let query = $state("");
  let selectedCategory = $state<SkillCategory>("all");
  let selectedSkillId = $state<string | null>(null);
  let gridEl = $state<HTMLElement | null>(null);

  let detail = $state<DesktopSkillDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state("");
  let detailSeq = 0;

  let selectedFile = $state("");
  let filePreview = $state<{ path: string; content: string } | null>(null);
  let fileTruncated = $state(false);
  let fileBinary = $state(false);
  let fileLoading = $state(false);
  let fileError = $state("");
  let fileSeq = 0;

  let copiedPath = $state(false);

  $effect(() => {
    if (serviceReady && serviceEndpoint && serviceEndpoint !== loadedEndpoint) {
      loadedEndpoint = serviceEndpoint;
      void loadSkills(serviceEndpoint);
    }
  });

  function scopeLabel(scope: "global" | "agent" | "chat" | "project"): string {
    if (scope === "project") return copy.skillScopeProject;
    if (scope === "agent") return copy.skillScopeAgent;
    if (scope === "chat") return copy.skillScopeChat;
    return copy.skillScopeGlobal;
  }

  const builtinMap = $derived(
    new Map(skillsStore.skills?.builtins?.map((b) => [b.skillId, b]) ?? [])
  );

  function isBuiltin(skill: DesktopSkillItem): boolean {
    return builtinMap.has(skill.id);
  }

  function isAgent(skill: DesktopSkillItem): boolean {
    return skill.scope === "agent" || skill.scope === "chat" || Boolean(skill.agentId) || Boolean(skill.chatId);
  }

  function isWorkspace(skill: DesktopSkillItem): boolean {
    // Global and built-in are not exclusive: a bundled Skill is materialised
    // into the global skills directory, so it is both. The tabs filter by
    // attribute instead of partitioning the catalogue — excluding built-ins
    // here is what made an installed bundled Skill vanish from 全局.
    return skill.scope === "global";
  }

  const discoveredSkillIds = $derived(new Set(skillsStore.skills?.items.map((skill) => skill.id) ?? []));
  const catalogueSkills = $derived([
    ...(skillsStore.skills?.items ?? []),
    ...(skillsStore.skills?.builtins ?? []).filter((builtin) => !discoveredSkillIds.has(builtin.skillId)).map((builtin): DesktopSkillItem => ({
      id: builtin.skillId,
      name: builtin.id,
      description: "",
      scope: "global",
      enabled: false,
      mcpServerCount: 0,
      agentId: "",
      chatId: ""
    }))
  ]);

  const categoryCounts = $derived.by(() => {
    const items = catalogueSkills;
    let builtin = 0;
    let workspace = 0;
    let agent = 0;
    for (const item of items) {
      if (isBuiltin(item)) builtin++;
      if (isAgent(item)) agent++;
      if (isWorkspace(item)) workspace++;
    }
    return { all: items.length, builtin, workspace, agent };
  });

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let filteredSkills = $derived(
    catalogueSkills.filter((skill) => {
      if (selectedCategory === "builtin" && !isBuiltin(skill)) return false;
      if (selectedCategory === "workspace" && !isWorkspace(skill)) return false;
      if (selectedCategory === "agent" && !isAgent(skill)) return false;
      if (!normalizedQuery) return true;
      return [skill.name, skill.description, skill.scope, skill.agentId, skill.chatId, skill.id]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery);
    })
  );

  const detailOpen = $derived(selectedSkillId !== null);
  /** Live store row for the open Skill, so the header switch reflects toggles. */
  const selectedItem = $derived(catalogueSkills.find((skill) => skill.id === selectedSkillId) ?? null);
  const selectedIsBuiltin = $derived(selectedSkillId ? builtinMap.has(selectedSkillId) : false);
  const selectedEnabled = $derived(selectedItem?.enabled ?? detail?.enabled ?? false);
  const selectedBuiltin = $derived(selectedSkillId ? builtinMap.get(selectedSkillId) : undefined);
  const previewHtml = $derived(filePreview && isMarkdown(filePreview.path) ? renderMarkdown(stripFrontmatter(filePreview.content), copy.copyCode) : "");

  function isMarkdown(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown");
  }

  /**
   * The frontmatter block is already rendered as its own metadata table, so the
   * content preview shows only the body. Without this, markdown turns the YAML
   * `---` fences into a heading and a rule, and the metadata reads as prose.
   */
  function stripFrontmatter(content: string): string {
    return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  }

  function formatBytes(size: number): string {
    if (!size) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatModified(iso: string): string {
    if (!iso) return "—";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }

  function fileDepth(path: string): number {
    return path.split("/").length - 1;
  }

  /**
   * FLIP the card set across a layout change (grid ⇄ vertical list).
   *
   * `animate:listFlip` only fires when the keyed each block reorders; opening
   * the detail pane reshapes the container instead, so the boxes are measured
   * before the state change and animated from their old rects afterwards.
   */
  function flipCards(mutate: () => void): void {
    const cards = gridEl ? Array.from(gridEl.querySelectorAll<HTMLElement>(".installed-skill-card")) : [];
    const before = captureRectMap(cards);
    mutate();
    flushSync();
    playLayoutFlip(before);
  }

  function openSkill(skillId: string): void {
    if (selectedSkillId === skillId) return;
    if (selectedSkillId === null) flipCards(() => { selectedSkillId = skillId; });
    else selectedSkillId = skillId;
    void loadDetail(skillId);
  }

  function openSkillFromEvent(skillId: string, event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest("button, label, input, a")) return;
    openSkill(skillId);
  }

  function skillCardKeydown(skillId: string, event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSkill(skillId);
    }
  }

  function closeSkill(): void {
    if (selectedSkillId === null) return;
    flipCards(() => { selectedSkillId = null; });
    detailSeq += 1;
    fileSeq += 1;
    detail = null;
    detailError = "";
    selectedFile = "";
    filePreview = null;
    fileError = "";
    fileTruncated = false;
    fileBinary = false;
    detailLoading = false;
    fileLoading = false;
  }

  async function loadDetail(skillId: string): Promise<void> {
    const endpoint = serviceEndpoint;
    if (!endpoint) return;
    const seq = ++detailSeq;
    detailLoading = true;
    detailError = "";
    try {
      const next = await loadDesktopSkillDetail(endpoint, skillId);
      if (seq !== detailSeq) return;
      detail = next;
      const skillFile = next.files.find((entry) => entry.kind === "file" && entry.path.toLowerCase() === "skill.md")
        ?? next.files.find((entry) => entry.kind === "file");
      selectedFile = skillFile?.path ?? "";
      if (selectedFile) void loadPreview(selectedFile);
    } catch (cause) {
      if (seq === detailSeq) {
        detail = null;
        detailError = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (seq === detailSeq) detailLoading = false;
    }
  }

  async function loadPreview(path: string): Promise<void> {
    const endpoint = serviceEndpoint;
    const id = selectedSkillId;
    if (!endpoint || !id || !path) return;
    const seq = ++fileSeq;
    fileLoading = true;
    fileError = "";
    try {
      const next = await loadDesktopSkillFile(endpoint, id, path);
      if (seq !== fileSeq) return;
      filePreview = { path: next.path, content: next.content };
      fileTruncated = next.truncated;
      fileBinary = next.binary;
    } catch (cause) {
      if (seq === fileSeq) {
        filePreview = null;
        fileError = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (seq === fileSeq) fileLoading = false;
    }
  }

  function selectFile(entry: DesktopSkillFileEntry): void {
    if (entry.kind !== "file" || entry.path === selectedFile) return;
    selectedFile = entry.path;
    void loadPreview(entry.path);
  }

  async function copyPath(): Promise<void> {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.baseDir);
      copiedPath = true;
      setTimeout(() => (copiedPath = false), 1400);
    } catch {
      detailError = copy.skillDetailFileFailed;
    }
  }

  async function revealDir(): Promise<void> {
    const endpoint = serviceEndpoint;
    if (!endpoint || !selectedSkillId) return;
    try {
      await revealDesktopSkill(endpoint, { id: selectedSkillId });
    } catch (cause) {
      detailError = cause instanceof Error ? cause.message : String(cause);
    }
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

{#snippet headerActions()}
  <div class="workspace-header-tools">
    <WorkspaceSearch value={query} label={copy.skillsFilter} placeholder={copy.skillsFilterHint} closeLabel={copy.closeSearch} onInput={(value) => (query = value)} />
  </div>
{/snippet}
<ChatHeader title={copy.skillsSquare} actions={headerActions} />
<div class="skills-shell">
<p class="workspace-description" title={copy.skillsSquareHint}>{copy.skillsSquareHint}</p>

<div class="workspace-filterbar">
  <div class="segmented workspace-skill-filters" role="group" aria-label={copy.hostBashColScope}>
    {#each [
      { value: "all", label: copy.searchScopeAll, count: categoryCounts.all },
      { value: "builtin", label: copy.skillBuiltins, count: categoryCounts.builtin },
      { value: "workspace", label: copy.skillScopeGlobal, count: categoryCounts.workspace },
      { value: "agent", label: copy.skillScopeAgent, count: categoryCounts.agent }
    ] as category (category.value)}
      <Button class={`segmented-item${selectedCategory === category.value ? " active" : ""}`} aria-pressed={selectedCategory === category.value} onclick={() => (selectedCategory = category.value as SkillCategory)}>{category.label} <span class="workspace-category-count">{category.count}</span></Button>
    {/each}
  </div>
</div>

{#if skillsStore.skills && skillsStore.error}<p class="workspace-inline-warning" role="alert">{skillsStore.error}</p>{/if}
{#if skillsStore.actionResult}<p class="workspace-inline-status" role="status">{skillsStore.actionResult.kind === "builtin" ? `${copy.skillBuiltinUpdated}: ${skillsStore.actionResult.id}` : copy.skillsStatusSaved}</p>{/if}

{#if !serviceReady}
  <div class="workspace-empty"><p>{copy.skillsUnavailable}</p></div>
{:else if skillsStore.loading}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if skillsStore.error && !skillsStore.skills}
  <div class="workspace-empty" role="alert"><p>{copy.workspaceLoadFailed}</p><small>{skillsStore.error}</small><button class="secondary-button" type="button" onclick={() => serviceEndpoint && void loadSkills(serviceEndpoint)}>{copy.retryLoading}</button></div>
{:else if !skillsStore.skills}
  <div class="workspace-empty"><p>{copy.loading}</p></div>
{:else if catalogueSkills.length === 0}
  <div class="workspace-empty"><EmptyState title={copy.skillsEmpty} icon="sparkle" /></div>
{:else}
  {#if filteredSkills.length === 0}
    <div class="workspace-empty compact"><EmptyState title={copy.skillsNoMatches} icon="sparkle" /></div>
  {:else}
    <div class="skills-workspace" class:detail-open={detailOpen}>
      <div class="skills-rail" aria-label={copy.skillsSquare}>
        <div class="installed-skills-grid" class:list-mode={detailOpen} bind:this={gridEl}>
          {#each filteredSkills as skill (skill.id)}
            {@const visual = getSkillVisual(skill)}
            {@const Icon = visual.icon}
            {@const builtinState = builtinMap.get(skill.id)}
            {@const discovered = discoveredSkillIds.has(skill.id)}
            <!-- Selection is a click/Enter surface, not a control: the card hosts
                 real buttons (switch, actions), so role="button" would be the
                 actual nesting violation. Keyboard opens via the keydown handler. -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
            <article
              class="installed-skill-card"
              in:listIn={{ disabled: Boolean(normalizedQuery) }}
              out:listOut={{ disabled: Boolean(normalizedQuery) }}
              animate:listFlip={{ disabled: Boolean(normalizedQuery) }}
              class:disabled={!skill.enabled}
              class:selected={selectedSkillId === skill.id}
              tabindex="0"
              onclick={(event) => openSkillFromEvent(skill.id, event)}
              onkeydown={(event) => skillCardKeydown(skill.id, event)}
            >
              <div class="installed-skill-header">
                <div class="installed-skill-icon" data-tone={visual.tone} aria-hidden="true">
                  <Icon weight="Filled" size={18} />
                </div>

                <div class="installed-skill-header-info">
                  <div class="installed-skill-title">
                    <strong>{skill.name}</strong>
                  </div>
                </div>

              </div>

              <div class="installed-skill-copy">
                {#if skill.description}
                  <p>{skill.description}</p>
                {/if}
              </div>

              <div class="installed-skill-foot">
                <div class="installed-skill-meta">
                  {#if isBuiltin(skill)}
                    <span class="installed-skill-meta-pill builtin">{copy.skillBuiltins}</span>
                  {:else}
                    <span class="installed-skill-meta-pill">{scopeLabel(skill.scope)}</span>
                  {/if}
                  {#if skill.agentId}<span class="installed-skill-meta-pill">{skill.agentId}</span>{/if}
                  {#if skill.chatId}<span class="installed-skill-meta-pill">{skill.chatId}</span>{/if}
                  {#if skill.mcpServerCount > 0}<span class="installed-skill-meta-pill mcp">{copy.skillMcpServers}: {skill.mcpServerCount}</span>{/if}
                </div>
                <span class="installed-skill-state">{builtinState && !builtinState.installed ? copy.skillBuiltinRemoved : skill.enabled ? copy.providerEnabled : copy.providerDisabled}</span>
                {#if discovered}
                  <div class="installed-skill-header-controls">
                    <IosSwitch
                      checked={skill.enabled}
                      ariaLabel={`${skill.name}: ${skill.enabled ? copy.providerEnabled : copy.providerDisabled}`}
                      disabled={Boolean(skillsStore.savingId)}
                      onCheckedChange={(checked) => void toggleSkill(skill.id, checked)}
                    />
                  </div>
                {/if}
                <div class="installed-skill-actions">
                  {#if builtinState && (!builtinState.installed || builtinState.updateAvailable || builtinState.modified)}
                    <Button
                      variant="primary"
                      class="compact"
                      disabled={Boolean(skillsStore.updatingBuiltinId)}
                      onclick={() => void updateBuiltinSkill(builtinState.id)}
                    >
                      {skillsStore.updatingBuiltinId === builtinState.id ? copy.agentTemplateUpdating : !builtinState.installed ? copy.agentTemplateInstall : copy.agentTemplateUpdate}
                    </Button>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      </div>

      {#if detailOpen}
        <section class="skills-detail" aria-label={detail?.name ?? copy.skillsSquare}>
          <header class="skills-detail-head">
            <Button variant="icon" class="skills-detail-back" title={copy.skillDetailBack} onclick={closeSkill}><ArrowLeft size={15} aria-hidden="true" /></Button>
            <div class="skills-detail-title">
              <h2>{detail?.name ?? selectedItem?.name ?? ""}</h2>
              <p class="installed-skill-id-badge" translate="no">{detail?.baseDir ?? ""}</p>
            </div>
            <div class="skills-detail-head-actions">
              <Button variant="icon" title={copiedPath ? copy.skillDetailCopied : copy.skillDetailCopyPath} onclick={() => void copyPath()}><Copy size={15} aria-hidden="true" /></Button>
              <Button variant="icon" title={copy.skillDetailReveal} onclick={() => void revealDir()}><FolderOpenIcon size={15} aria-hidden="true" /></Button>
              <Button variant="icon" title={copy.dialogClose} ariaLabel={copy.dialogClose} onclick={closeSkill}><X size={15} aria-hidden="true" /></Button>
            </div>
          </header>

          {#if detailLoading && !detail}
            <div class="skills-detail-state" role="status"><Magnifier size={16} aria-hidden="true" />{copy.skillDetailLoading}</div>
          {:else if detailError && !detail}
            <div class="skills-detail-state" role="alert"><p>{copy.skillDetailLoadFailed}</p><small>{detailError}</small></div>
          {:else if detail}
            <div class="skills-detail-body">
              <div class="skills-detail-main">
                {#if detail.description}
                  <p class="skills-detail-description">{detail.description}</p>
                {/if}

                <div class="skills-detail-facts">
                  <div class="skills-detail-fact">
                    <span>{copy.skillDetailPath}</span>
                    <code translate="no">{detail.filePath}</code>
                  </div>
                  <div class="skills-detail-fact">
                    <span>{copy.hostBashColScope}</span>
                    <strong>{selectedIsBuiltin ? copy.skillBuiltins : scopeLabel(detail.scope)}</strong>
                  </div>
                  <div class="skills-detail-fact">
                    <span>{copy.skillDetailVersion}</span>
                    <strong>{detail.version || "—"}</strong>
                  </div>
                  <div class="skills-detail-fact">
                    <span>{copy.skillDetailUpdatedAt}</span>
                    <strong>{formatModified(detail.updatedAt)}</strong>
                  </div>
                  {#if detail.agentId}
                    <div class="skills-detail-fact"><span>{copy.skillScopeAgent}</span><strong>{detail.agentId}</strong></div>
                  {/if}
                  {#if detail.chatId}
                    <div class="skills-detail-fact"><span>{copy.skillScopeChat}</span><strong>{detail.chatId}</strong></div>
                  {/if}
                  {#if detail.mcpServers.length}
                    <div class="skills-detail-fact"><span>{copy.skillMcpServers}</span><strong translate="no">{detail.mcpServers.join(", ")}</strong></div>
                  {/if}
                  <div class="skills-detail-fact">
                    <span>{copy.logsStatus}</span>
                    <span class="status-badge" data-state={selectedEnabled ? "ready" : "disconnected"}>
                      {selectedBuiltin && !selectedBuiltin.installed ? copy.skillBuiltinRemoved : selectedEnabled ? copy.providerEnabled : copy.providerDisabled}
                    </span>
                  </div>
                </div>

                {#if selectedBuiltin}
                  <div class="skills-detail-builtin">
                    <div class="skills-detail-builtin-facts">
                      <span>{copy.skillBuiltins} <strong>v{selectedBuiltin.version}</strong></span>
                      <span>{copy.agentTemplateInstalledVersion} <strong>{selectedBuiltin.installedVersion ? `v${selectedBuiltin.installedVersion}` : copy.skillBuiltinRemoved}</strong></span>
                      {#if selectedBuiltin.modified}<span class="skills-detail-modified">{copy.agentTemplateModified}</span>{/if}
                    </div>
                    {#if !selectedBuiltin.installed || selectedBuiltin.updateAvailable || selectedBuiltin.modified}
                      <Button variant="primary" disabled={Boolean(skillsStore.updatingBuiltinId)} onclick={() => void updateBuiltinSkill(selectedBuiltin.id)}>
                        {skillsStore.updatingBuiltinId === selectedBuiltin.id ? copy.agentTemplateUpdating : !selectedBuiltin.installed ? copy.agentTemplateInstall : copy.agentTemplateUpdate}
                      </Button>
                    {/if}
                  </div>
                {/if}

                <section class="skills-detail-section">
                  <h3>{copy.skillDetailMetadata}</h3>
                  {#if detail.frontmatter.length === 0}
                    <p class="skills-detail-muted">{copy.skillDetailNoMetadata}</p>
                  {:else}
                    <dl class="skills-detail-props">
                      {#each detail.frontmatter as row (row.key)}
                        <dt translate="no">{row.key}</dt>
                        <dd translate="no">{row.value}</dd>
                      {/each}
                    </dl>
                  {/if}
                </section>

                <section class="skills-detail-section skills-detail-content">
                  <h3>{copy.skillDetailContent}<span class="skills-detail-content-path" translate="no">{selectedFile}</span></h3>
                  {#if fileLoading && !filePreview}
                    <p class="skills-detail-muted" role="status">{copy.skillDetailLoading}</p>
                  {:else if fileError}
                    <p class="skills-detail-muted" role="alert">{copy.skillDetailFileFailed}: {fileError}</p>
                  {:else if fileBinary}
                    <p class="skills-detail-muted">{copy.skillDetailBinary}</p>
                  {:else if filePreview}
                    {#if fileTruncated}<p class="skills-detail-muted">{copy.skillDetailTruncated}</p>{/if}
                    {#if previewHtml}
                      <div class="markdown-body skills-detail-markdown">{@html previewHtml}</div>
                    {:else}
                      <pre class="skills-detail-code" translate="no">{filePreview.content}</pre>
                    {/if}
                  {:else}
                    <p class="skills-detail-muted">{copy.skillDetailEmpty}</p>
                  {/if}
                </section>
              </div>

              <aside class="skills-detail-files" aria-label={copy.skillDetailFiles}>
                <h3>{copy.skillDetailFiles}<span class="skills-detail-files-count">{copy.skillDetailFilesCount.replace("{count}", String(detail.files.length))}</span></h3>
                {#if detail.files.length === 0}
                  <p class="skills-detail-muted">{copy.skillDetailNoFiles}</p>
                {:else}
                  <ul class="skills-file-list">
                    {#each detail.files as entry (entry.path)}
                      <li>
                        <button
                          type="button"
                          class="skills-file-row"
                          class:active={entry.kind === "file" && entry.path === selectedFile}
                          style={`--skills-file-depth:${fileDepth(entry.path)}`}
                          disabled={entry.kind === "dir"}
                          onclick={() => selectFile(entry)}
                        >
                          <span class="skills-file-icon" aria-hidden="true">
                            {#if entry.kind === "dir"}<FolderOpen size={15} weight="Filled" />
                            {:else}<FileText size={15} weight="Filled" />{/if}
                          </span>
                          <span class="skills-file-name" translate="no">{entry.path.split("/").pop()}</span>
                          {#if entry.kind === "file"}<span class="skills-file-size">{formatBytes(entry.size)}</span>{/if}
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </aside>
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
{/if}
</div>
