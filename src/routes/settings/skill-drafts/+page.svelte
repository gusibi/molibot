<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Textarea } from "$lib/components/ui/textarea";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

  type SkillScope = "global" | "chat" | "bot";

  interface SkillDraftSettings {
    autoSave: { enabled: boolean; minToolCalls: number; allowRecoveredToolFailures: boolean; allowModelRetries: boolean; };
    template: { skillPath: string; };
  }

  interface TemplateSkillOption {
    name: string;
    description: string;
    filePath: string;
    scope: SkillScope;
    botId?: string;
    chatId?: string;
  }

  interface SkillDraftItem {
    filePath: string;
    fileName: string;
    botId: string;
    chatId: string;
    workspaceDir: string;
    name: string;
    description: string;
    draft: boolean;
    source: string;
    mergeCount: number;
    updatedAt: string;
    content: string;
  }

  interface Counts {
    total: number;
    botCount: number;
    chatCount: number;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "可复用工作流",
      title: "技能草稿",
      desc: "在将可复用工作流草稿转换为正式技能之前对其进行审查。",
      btnRefresh: "刷新",
      loading: "正在加载技能草稿...",
      rulesTitle: "草稿生成规则",
      rulesDesc: "控制何时保存可复用工作流草稿，以及哪个现有技能应当定义草稿的格式。",
      autoSaveLabel: "启用自动保存草稿",
      minToolsLabel: "最少工具调用次数",
      recoverLabel: "运行从工具失败中恢复时保存草稿",
      retryLabel: "运行发生模型重试或 fallback 时保存草稿",
      pathLabel: "草稿骨架模板（SKILL.md）",
      pathPlaceholder: "~/.molibot/skills/<你的草稿骨架>/SKILL.md",
      pathHint: "这是一个结构骨架，不是要运行的技能。只有它的章节标题（When To Use / Goal / Suggested Steps / Verification / Pitfalls / Example Outcome）会用来决定草稿格式——文件正文不会被复制进草稿。请勿指向真实技能（例如 skill-creator）；若它没有任何标题匹配标准章节，则会被忽略并改用内置默认骨架。未配置此路径时，自动草稿生成将保持关闭。",
      suggestions: "推荐：",
      autoSaveLocked: "在配置草稿骨架 `SKILL.md` 路径之前，自动草稿生成功能已被锁定。",
      selectedWorkflow: "已选骨架：",
      totalCount: "总数",
      botCount: "Bots",
      chatCount: "会话",
      noDrafts: "尚未找到技能草稿。",
      noDesc: "无描述",
      manualReview: "人工审查",
      skillName: "技能名称",
      promoteScope: "提升范围",
      scopeChat: "会话",
      scopeBot: "Bot",
      scopeGlobal: "全局",
      draftContent: "草稿内容",
      editFullBtn: "编辑完整草稿",
      linesHint: "当前显示前 {limit} 行（共 {count} 行）。打开编辑器以查看和编辑完整草稿。",
      btnSaveDraft: "保存草稿",
      btnPromote: "提升为技能",
      btnDeleteDraft: "删除草稿",
      modalEditTitle: "编辑草稿内容",
      modalFullContent: "完整草稿内容",
      modalCancel: "取消",
      saving: "保存中...",
      savingConfig: "正在保存变更...",
      saveRulesBtn: "保存规则",
      resetBtn: "重置",
      failedLoad: "加载技能草稿失败",
      pathRequiredError: "先指定一个草稿骨架 `SKILL.md` 路径，才能打开自动生成。",
      failedSaveConfig: "保存技能草稿设置失败",
      configSaved: "技能草稿设置已保存。",
      failedSaveDraft: "保存草稿失败",
      draftSaved: "草稿已保存。",
      failedPromote: "提升草稿失败",
      promoteSuccess: "草稿已提升为 {path}。",
      failedDelete: "删除草稿失败",
      draftDeleted: "草稿已删除。"
    },
    "en-US": {
      eyebrow: "Reusable Workflows",
      title: "Skill Drafts",
      desc: "Review reusable workflow drafts before turning them into live skills.",
      btnRefresh: "Refresh",
      loading: "Loading skill drafts...",
      rulesTitle: "Draft Generation Rules",
      rulesDesc: "Control when reusable workflow drafts are saved, and which existing skill should define the draft format.",
      autoSaveLabel: "Enable automatic draft saving",
      minToolsLabel: "Minimum Tool Calls",
      recoverLabel: "Save draft when the run recovered from tool failures",
      retryLabel: "Save draft when the run needed model retries or fallback",
      pathLabel: "Draft Skeleton Template (SKILL.md)",
      pathPlaceholder: "~/.molibot/skills/<your-draft-skeleton>/SKILL.md",
      pathHint: "This is a structure skeleton, not a skill to run. Only its section headings (When To Use / Goal / Suggested Steps / Verification / Pitfalls / Example Outcome) shape generated drafts — the file's body is never copied in. Do NOT point it at a real skill such as skill-creator; if none of its headings match the standard sections it is ignored and a built-in default skeleton is used. Without a path, automatic draft generation stays off.",
      suggestions: "Suggestions:",
      autoSaveLocked: "Automatic draft generation is locked until a draft skeleton `SKILL.md` path is configured.",
      selectedWorkflow: "Selected skeleton: ",
      totalCount: "Total",
      botCount: "Bots",
      chatCount: "Chats",
      noDrafts: "No skill drafts found yet.",
      noDesc: "No description",
      manualReview: "manual review",
      skillName: "Skill Name",
      promoteScope: "Promote Scope",
      scopeChat: "Chat",
      scopeBot: "Bot",
      scopeGlobal: "Global",
      draftContent: "Draft Content",
      editFullBtn: "Edit full draft",
      linesHint: "Showing first {limit} of {count} lines. Open the editor to view and edit the full draft.",
      btnSaveDraft: "Save Draft",
      btnPromote: "Promote To Skill",
      btnDeleteDraft: "Delete Draft",
      modalEditTitle: "Edit Draft Content",
      modalFullContent: "Full Draft Content",
      modalCancel: "Cancel",
      saving: "Saving...",
      savingConfig: "Saving changes...",
      saveRulesBtn: "Save Rules",
      resetBtn: "Reset",
      failedLoad: "Failed to load skill drafts",
      pathRequiredError: "Choose a draft skeleton `SKILL.md` path first to enable automatic draft saving.",
      failedSaveConfig: "Failed to save skill draft settings",
      configSaved: "Skill draft settings saved.",
      failedSaveDraft: "Failed to save draft",
      draftSaved: "Draft saved.",
      failedPromote: "Failed to promote draft",
      promoteSuccess: "Draft promoted to {path}.",
      failedDelete: "Failed to delete draft",
      draftDeleted: "Draft deleted."
    }
  } as const;

  let loading = true;
  let savingConfig = false;
  let error = "";
  let message = "";
  let diagnostics: string[] = [];
  let items: SkillDraftItem[] = [];
  let templateSkills: TemplateSkillOption[] = [];
  let skillDrafts: SkillDraftSettings = {
    autoSave: { enabled: true, minToolCalls: 4, allowRecoveredToolFailures: true, allowModelRetries: true },
    template: { skillPath: "" }
  };
  let counts: Counts = { total: 0, botCount: 0, chatCount: 0 };
  let saving = new Set<string>();
  let draftContent: Record<string, string> = {};
  let draftName: Record<string, string> = {};
  let draftScope: Record<string, SkillScope> = {};
  let workflowSuggestionsId = "skill-draft-workflow-suggestions";
  let editingDraftItem: SkillDraftItem | undefined;
  const collapsedDraftLineLimit = 10;

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
  }

  function setSaving(filePath: string, active: boolean): void {
    const next = new Set(saving);
    if (active) next.add(filePath); else next.delete(filePath);
    saving = next;
  }

  function syncDraftState(rows: SkillDraftItem[]): void {
    draftContent = Object.fromEntries(rows.map((item) => [item.filePath, item.content]));
    draftName = Object.fromEntries(rows.map((item) => [item.filePath, item.name]));
    draftScope = Object.fromEntries(rows.map((item) => [item.filePath, "chat" as SkillScope]));
  }

  function draftLines(item: SkillDraftItem): string[] {
    const content = draftContent[item.filePath] ?? item.content ?? "";
    return content.split(/\r\n|\r|\n/);
  }

  function draftLineCount(item: SkillDraftItem): number {
    return draftLines(item).length;
  }

  function collapsedDraftContent(item: SkillDraftItem): string {
    return draftLines(item).slice(0, collapsedDraftLineLimit).join("\n");
  }

  function openDraftEditor(item: SkillDraftItem): void {
    editingDraftItem = item;
  }

  function closeDraftEditor(): void {
    editingDraftItem = undefined;
  }

  async function saveEditingDraft(item: SkillDraftItem): Promise<void> {
    const saved = await saveDraft(item);
    if (saved) closeDraftEditor();
  }

  function normalizeSkillDraftSettings(input: unknown): SkillDraftSettings {
    const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const autoSave = source.autoSave && typeof source.autoSave === "object" ? source.autoSave as Record<string, unknown> : {};
    const template = source.template && typeof source.template === "object" ? source.template as Record<string, unknown> : {};
    return {
      autoSave: {
        enabled: autoSave.enabled === undefined ? true : Boolean(autoSave.enabled),
        minToolCalls: Math.max(1, Number(autoSave.minToolCalls ?? 4) || 4),
        allowRecoveredToolFailures: autoSave.allowRecoveredToolFailures === undefined ? true : Boolean(autoSave.allowRecoveredToolFailures),
        allowModelRetries: autoSave.allowModelRetries === undefined ? true : Boolean(autoSave.allowModelRetries)
      },
      template: { skillPath: String(template.skillPath ?? "") }
    };
  }

  function formatTemplateScope(item: TemplateSkillOption): string {
    if (item.scope === "global") return copy.scopeGlobal;
    if (item.scope === "bot") return `${copy.scopeBot} · ${item.botId}`;
    return `${copy.scopeChat} · ${item.botId}/${item.chatId}`;
  }

  function hasWorkflowSkillPath(): boolean {
    return HTMLSelectElement && Boolean(String(skillDrafts.template.skillPath ?? "").trim());
  }

  async function loadDrafts(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      items = Array.isArray(data.items) ? data.items : [];
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      templateSkills = Array.isArray(data.templateSkills) ? data.templateSkills : [];
      skillDrafts = normalizeSkillDraftSettings(data.skillDrafts);
      counts = {
        total: Number(data.counts?.total ?? 0),
        botCount: Number(data.counts?.botCount ?? 0),
        chatCount: Number(data.counts?.chatCount ?? 0)
      };
      syncDraftState(items);
      message = copy.loadedMsg.replace("{count}", String(items.length));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function saveDraftSettings(): Promise<void> {
    savingConfig = true;
    error = "";
    message = "";
    try {
      if (skillDrafts.autoSave.enabled && !hasWorkflowSkillPath()) {
        throw new Error(copy.pathRequiredError);
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillDrafts })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || copy.failedSaveConfig);
      skillDrafts = normalizeSkillDraftSettings(data.settings?.skillDrafts ?? skillDrafts);
      message = copy.configSaved;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      savingConfig = false;
    }
  }

  async function saveDraft(item: SkillDraftItem): Promise<boolean> {
    const filePath = item.filePath;
    setSaving(filePath, true);
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", filePath, content: draftContent[filePath] ?? item.content })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || copy.failedSaveDraft);
      message = copy.draftSaved;
      await loadDrafts();
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      setSaving(filePath, false);
    }
  }

  async function promoteDraft(item: SkillDraftItem): Promise<void> {
    const filePath = item.filePath;
    setSaving(filePath, true);
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "promote", filePath, workspaceDir: item.workspaceDir, chatId: item.chatId,
          scope: draftScope[filePath] ?? "chat", name: draftName[filePath] ?? item.name, overwrite: false, archiveDraft: true
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || copy.failedPromote);
      message = copy.promoteSuccess.replace("{path}", data.saved?.filePath || "skill");
      await loadDrafts();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      setSaving(filePath, false);
    }
  }

  async function deleteDraft(item: SkillDraftItem): Promise<void> {
    const filePath = item.filePath;
    setSaving(filePath, true);
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", filePath })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || copy.failedDelete);
      message = copy.draftDeleted;
      await loadDrafts();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      setSaving(filePath, false);
    }
  }

  onMount(loadDrafts);

  $: if (!hasWorkflowSkillPath() && skillDrafts.autoSave.enabled) {
    skillDrafts = { ...skillDrafts, autoSave: { ...skillDrafts.autoSave, enabled: false } };
  }
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  <div class="channel-card">
    <div class="channel-card-body">
      <div style="display: flex; gap: 0.5rem;">
        <Button variant="outline" onclick={loadDrafts}>{copy.btnRefresh}</Button>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <form id="drafts-form" class="channel-form" onsubmit={(e) => { e.preventDefault(); void saveDraftSettings(); }}>
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.rulesTitle}</h2>
            <p class="channel-card-desc">{copy.rulesDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field-row" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="channel-toggle-row">
              <div class="channel-toggle-label">
                <Label for="sd-auto">{copy.autoSaveLabel}</Label>
              </div>
              <IosSwitch id="sd-auto" bind:checked={skillDrafts.autoSave.enabled} disabled={!hasWorkflowSkillPath()} />
            </div>
            <div class="channel-field">
              <Label for="sd-min-tools">{copy.minToolsLabel}</Label>
              <Input id="sd-min-tools" type="number" min="1" bind:value={skillDrafts.autoSave.minToolCalls} />
            </div>
          </div>

          <div class="channel-field-row" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="channel-toggle-row">
              <div class="channel-toggle-label">
                <Label for="sd-recover">{copy.recoverLabel}</Label>
              </div>
              <IosSwitch id="sd-recover" bind:checked={skillDrafts.autoSave.allowRecoveredToolFailures} />
            </div>
            <div class="channel-toggle-row">
              <div class="channel-toggle-label">
                <Label for="sd-retry">{copy.retryLabel}</Label>
              </div>
              <IosSwitch id="sd-retry" bind:checked={skillDrafts.autoSave.allowModelRetries} />
            </div>
          </div>

          <div class="channel-field">
            <Label for="sd-path">{copy.pathLabel}</Label>
            <Input
              id="sd-path"
              bind:value={skillDrafts.template.skillPath}
              list={workflowSuggestionsId}
              placeholder={copy.pathPlaceholder}
            />
            <datalist id={workflowSuggestionsId}>
              {#each templateSkills as option}
                <option value={option.filePath}>{option.name} · {formatTemplateScope(option)}</option>
              {/each}
            </datalist>
            <p class="channel-hint">{copy.pathHint}</p>
            {#if templateSkills.length > 0}
              <div class="channel-hint" style="background: var(--muted); padding: 0.75rem; border-radius: 6px; margin-top: 0.5rem;">
                <strong>{copy.suggestions}</strong>
                {#each templateSkills as option}
                  <div style="margin-top: 0.25rem;">{option.name} · {formatTemplateScope(option)} · {option.filePath}</div>
                {/each}
              </div>
            {/if}
          </div>

          {#if !hasWorkflowSkillPath()}
            <div class="channel-hint" style="color: var(--destructive); font-weight: 500;">
              {copy.autoSaveLocked}
            </div>
          {/if}

          {#if skillDrafts.template.skillPath}
            <div class="channel-hint">
              {copy.selectedWorkflow}{skillDrafts.template.skillPath}
            </div>
          {/if}
        </div>
      </div>
    </form>

    <div class="channel-card">
      <div class="channel-card-body" style="gap: 0.5rem;">
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <Badge variant="outline">{copy.totalCount}: {counts.total}</Badge>
          <Badge variant="outline">{copy.botCount}: {counts.botCount}</Badge>
          <Badge variant="outline">{copy.chatCount}: {counts.chatCount}</Badge>
        </div>
      </div>
    </div>

    {#if diagnostics.length > 0}
      <div class="channel-card" style="padding: 1rem;">
        <div class="channel-card-body" style="white-space: pre-wrap;">
          {diagnostics.join("\n")}
        </div>
      </div>
    {/if}

    <div class="channel-form">
      {#if items.length === 0}
        <div class="channel-card">
          <div class="channel-card-body">
            <div class="channel-hint">{copy.noDrafts}</div>
          </div>
        </div>
      {:else}
        {#each items as item}
          {@const lineCount = draftLineCount(item)}
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <h2 class="channel-card-title">{item.name}</h2>
                  <Badge variant="default">{draftScope[item.filePath] ?? "chat"}</Badge>
                  <Badge variant="outline">merged {item.mergeCount ?? 1}</Badge>
                </div>
                <p class="channel-card-desc">
                  {item.botId} / {item.chatId} · {formatDate(item.updatedAt)}
                </p>
                <p class="channel-hint" style="margin-top: 0.25rem;">
                  {item.description || copy.noDesc}
                </p>
              </div>
              <div style="text-align: right;" class="channel-sidebar-btn-id">
                <div>{item.source || copy.manualReview}</div>
                <div>{item.fileName}</div>
              </div>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row" style="grid-template-columns: 1fr 180px; gap: 0.75rem;">
                <div class="channel-field">
                  <Label for="sd-name-{item.filePath}">{copy.skillName}</Label>
                  <Input id="sd-name-{item.filePath}" bind:value={draftName[item.filePath]} />
                </div>
                <div class="channel-field">
                  <Label for="sd-scope-{item.filePath}">{copy.promoteScope}</Label>
                  <NativeSelect id="sd-scope-{item.filePath}" bind:value={draftScope[item.filePath]}>
                    <NativeSelectOption value="chat">{copy.scopeChat}</NativeSelectOption>
                    <NativeSelectOption value="bot">{copy.scopeBot}</NativeSelectOption>
                    <NativeSelectOption value="global">{copy.scopeGlobal}</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>

              <div class="channel-field">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <Label for="sd-content-{item.filePath}">{copy.draftContent}</Label>
                  <Button variant="outline" size="sm" type="button" onclick={() => openDraftEditor(item)}>
                    {copy.editFullBtn}
                  </Button>
                </div>
                <pre
                  id="sd-content-{item.filePath}"
                  class="channel-textarea"
                  style="max-height: 13.5rem; overflow: hidden; padding: 0.75rem;"
                >{collapsedDraftContent(item)}</pre>
                {#if lineCount > collapsedDraftLineLimit}
                  <p class="channel-hint">
                    {copy.linesHint.replace("{limit}", String(collapsedDraftLineLimit)).replace("{count}", String(lineCount))}
                  </p>
                {/if}
              </div>

              <div class="channel-field-row" style="grid-template-columns: repeat(3, auto); gap: 0.5rem; justify-content: start; margin-top: 0.5rem;">
                <Button variant="outline" size="sm" disabled={saving.has(item.filePath)} onclick={() => saveDraft(item)}>
                  {copy.btnSaveDraft}
                </Button>
                <Button size="sm" disabled={saving.has(item.filePath)} onclick={() => promoteDraft(item)}>
                  {copy.btnPromote}
                </Button>
                <Button variant="destructive" size="sm" disabled={saving.has(item.filePath)} onclick={() => deleteDraft(item)}>
                  {copy.btnDeleteDraft}
                </Button>
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

{#if editingDraftItem}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
    <div class="channel-card" style="width: 100%; max-width: 56rem; max-height: 90dvh; overflow: hidden; display: flex; flex-direction: column;">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.modalEditTitle}</h2>
          <p class="channel-card-desc break-all">{editingDraftItem.fileName}</p>
        </div>
        <Button variant="outline" size="sm" type="button" onclick={closeDraftEditor}>
          {copy.modalCancel}
        </Button>
      </div>
      <div class="channel-card-body" style="overflow-y: auto; flex: 1;">
        <div class="channel-field">
          <Label for="sd-modal-content">{copy.modalFullContent}</Label>
          <Textarea
            id="sd-modal-content"
            rows={20}
            class="channel-textarea font-mono"
            style="min-height: 50dvh;"
            bind:value={draftContent[editingDraftItem.filePath]}
          />
        </div>
        <div class="channel-field-row" style="grid-template-columns: auto auto; gap: 0.5rem; justify-content: end; margin-top: 0.5rem;">
          <Button variant="outline" type="button" onclick={closeDraftEditor}>
            {copy.modalCancel}
          </Button>
          <Button
            type="button"
            disabled={saving.has(editingDraftItem.filePath)}
            onclick={() => editingDraftItem && saveEditingDraft(editingDraftItem)}
          >
            {saving.has(editingDraftItem.filePath) ? copy.saving : copy.btnSaveDraft}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if !loading}
  <footer class="settings-footbar">
    <div class="settings-footbar-status">
      {#if savingConfig}
        <span class="settings-footbar-saving">
          <span class="settings-footbar-pulse"></span>
          {copy.savingConfig}
        </span>
      {:else if message}
        <span class="settings-footbar-ok">{message}</span>
      {/if}
      {#if error}
        <span class="settings-footbar-error">{error}</span>
      {/if}
    </div>
    <div class="settings-footbar-actions">
      <Button variant="outline" size="sm" onclick={loadDrafts} disabled={loading || savingConfig}>
        {copy.resetBtn}
      </Button>
      <button type="submit" form="drafts-form" class="settings-footbar-btn" disabled={loading || savingConfig}>
        {savingConfig ? copy.saving : copy.saveRulesBtn}
      </button>
    </div>
  </footer>
{/if}
