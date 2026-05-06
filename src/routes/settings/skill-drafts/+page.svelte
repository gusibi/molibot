<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Textarea } from "$lib/components/ui/textarea";

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

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", {
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
    if (item.scope === "global") return "Global";
    if (item.scope === "bot") return `Bot · ${item.botId}`;
    return `Chat · ${item.botId}/${item.chatId}`;
  }

  function hasWorkflowSkillPath(): boolean {
    return Boolean(String(skillDrafts.template.skillPath ?? "").trim());
  }

  async function loadDrafts(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load skill drafts");
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
      message = `Loaded ${items.length} draft(s).`;
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
        throw new Error("先指定一个标准 workflow 路径，才能打开自动生成。");
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillDrafts })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save skill draft settings");
      skillDrafts = normalizeSkillDraftSettings(data.settings?.skillDrafts ?? skillDrafts);
      message = "Skill draft settings saved.";
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
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save draft");
      message = "Draft saved.";
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
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to promote draft");
      message = `Draft promoted to ${data.saved?.filePath ?? "skill"}.`;
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
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to delete draft");
      message = "Draft deleted.";
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

<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Reusable Workflows</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Skill Drafts</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Review reusable workflow drafts before turning them into live skills.
      </p>
    </div>
  </header>

  <div class="flex items-center gap-2">
    <Button variant="outline" onclick={loadDrafts}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading skill drafts...</p>
  {:else}
    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Draft Generation Rules</CardTitle>
            <CardDescription>
              Control when reusable workflow drafts are saved, and which existing skill should define the draft format.
            </CardDescription>
          </div>
          <Button variant="outline" disabled={savingConfig} onclick={saveDraftSettings}>
            {savingConfig ? "Saving..." : "Save Rules"}
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-3">
            <Checkbox id="sd-auto" bind:checked={skillDrafts.autoSave.enabled} disabled={!hasWorkflowSkillPath()} />
            <Label for="sd-auto">Enable automatic draft saving</Label>
          </div>
          <div class="grid gap-1.5">
            <Label for="sd-min-tools" class="text-xs uppercase tracking-wide text-muted-foreground">Minimum Tool Calls</Label>
            <Input id="sd-min-tools" type="number" min="1" bind:value={skillDrafts.autoSave.minToolCalls} />
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-3">
            <Checkbox id="sd-recover" bind:checked={skillDrafts.autoSave.allowRecoveredToolFailures} />
            <Label for="sd-recover">Save draft when the run recovered from tool failures</Label>
          </div>
          <div class="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-3">
            <Checkbox id="sd-retry" bind:checked={skillDrafts.autoSave.allowModelRetries} />
            <Label for="sd-retry">Save draft when the run needed model retries or fallback</Label>
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="sd-path" class="text-xs uppercase tracking-wide text-muted-foreground">Workflow Skill Path</Label>
          <Input
            id="sd-path"
            bind:value={skillDrafts.template.skillPath}
            list={workflowSuggestionsId}
            placeholder="~/.molibot/skills/skill-creator/SKILL.md"
          />
          <datalist id={workflowSuggestionsId}>
            {#each templateSkills as option}
              <option value={option.filePath}>{option.name} · {formatTemplateScope(option)}</option>
            {/each}
          </datalist>
          <p class="text-xs text-muted-foreground">
            Fill in the standard workflow `SKILL.md` path. Without this path, automatic draft generation stays off.
          </p>
          {#if templateSkills.length > 0}
            <div class="rounded-xl border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
              Suggestions:
              {#each templateSkills as option, index}
                <div class={index === 0 ? "mt-2" : "mt-1"}>{option.name} · {formatTemplateScope(option)} · {option.filePath}</div>
              {/each}
            </div>
          {/if}
        </div>

        {#if !hasWorkflowSkillPath()}
          <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-600 dark:text-amber-400">
            Automatic draft generation is locked until a workflow `SKILL.md` path is configured.
          </div>
        {/if}

        {#if skillDrafts.template.skillPath}
          <div class="rounded-xl border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            Selected workflow: {skillDrafts.template.skillPath}
          </div>
        {/if}
      </CardContent>
    </Card>

    <div class="flex flex-wrap gap-3 text-sm">
      <Badge variant="outline">Total: {counts.total}</Badge>
      <Badge variant="outline">Bots: {counts.botCount}</Badge>
      <Badge variant="outline">Chats: {counts.chatCount}</Badge>
    </div>

    {#if diagnostics.length > 0}
      <Alert variant="default"><AlertDescription class="whitespace-pre-wrap">{diagnostics.join("\n")}</AlertDescription></Alert>
    {/if}

    {#if items.length === 0}
      <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">No skill drafts found yet.</div>
    {:else}
      <div class="space-y-4">
        {#each items as item}
          {@const lineCount = draftLineCount(item)}
          <article class="rounded-2xl border bg-card/60 p-5 text-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-base font-semibold text-foreground">{item.name}</h2>
                  <Badge variant="default">{draftScope[item.filePath] ?? "chat"}</Badge>
                  <Badge variant="outline">merged {item.mergeCount ?? 1}</Badge>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">{item.botId} / {item.chatId} · {formatDate(item.updatedAt)}</p>
                <p class="mt-2 text-sm text-muted-foreground">{item.description || "No description"}</p>
              </div>
              <div class="text-right text-xs text-muted-foreground">
                <div>{item.source || "manual review"}</div>
                <div>{item.fileName}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
              <div class="grid gap-1.5">
                <Label for="sd-name-{item.filePath}" class="text-xs uppercase tracking-wide text-muted-foreground">Skill Name</Label>
                <Input id="sd-name-{item.filePath}" bind:value={draftName[item.filePath]} />
              </div>
              <div class="grid gap-1.5">
                <Label for="sd-scope-{item.filePath}" class="text-xs uppercase tracking-wide text-muted-foreground">Promote Scope</Label>
                <NativeSelect id="sd-scope-{item.filePath}" bind:value={draftScope[item.filePath]}>
                  <NativeSelectOption value="chat">Chat</NativeSelectOption>
                  <NativeSelectOption value="bot">Bot</NativeSelectOption>
                  <NativeSelectOption value="global">Global</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>

            <div class="mt-4 grid gap-1.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <Label for="sd-content-{item.filePath}" class="text-xs uppercase tracking-wide text-muted-foreground">Draft Content</Label>
                <Button variant="outline" size="xs" type="button" onclick={() => openDraftEditor(item)}>
                  Edit full draft
                </Button>
              </div>
              <pre
                id="sd-content-{item.filePath}"
                class="max-h-[13.5rem] overflow-hidden whitespace-pre-wrap rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs leading-5 text-foreground"
              >{collapsedDraftContent(item)}</pre>
              {#if lineCount > collapsedDraftLineLimit}
                <p class="text-xs text-muted-foreground">
                  Showing first {collapsedDraftLineLimit} of {lineCount} lines. Open the editor to view and edit the full draft.
                </p>
              {/if}
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={saving.has(item.filePath)} onclick={() => saveDraft(item)}>
                Save Draft
              </Button>
              <Button size="sm" disabled={saving.has(item.filePath)} onclick={() => promoteDraft(item)}>
                Promote To Skill
              </Button>
              <Button variant="destructive" size="sm" disabled={saving.has(item.filePath)} onclick={() => deleteDraft(item)}>
                Delete Draft
              </Button>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if editingDraftItem}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
    <Card class="max-h-[90dvh] w-full max-w-5xl overflow-hidden">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <CardTitle>Edit Draft Content</CardTitle>
            <CardDescription class="break-all">
              {editingDraftItem.fileName}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" type="button" onclick={closeDraftEditor}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4 overflow-y-auto">
        <div class="grid gap-1.5">
          <Label for="sd-modal-content" class="text-xs uppercase tracking-wide text-muted-foreground">
            Full Draft Content
          </Label>
          <Textarea
            id="sd-modal-content"
            rows={28}
            class="min-h-[60dvh] font-mono text-xs leading-5"
            bind:value={draftContent[editingDraftItem.filePath]}
          />
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" type="button" onclick={closeDraftEditor}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving.has(editingDraftItem.filePath)}
            onclick={() => editingDraftItem && saveEditingDraft(editingDraftItem)}
          >
            {saving.has(editingDraftItem.filePath) ? "Saving..." : "Save Draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
{/if}
