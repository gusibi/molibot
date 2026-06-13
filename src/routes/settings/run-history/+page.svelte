<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { locale } from "$lib/ui/i18n";

  interface RunHistoryItem {
    runId: string;
    createdAt: string;
    botId: string;
    chatId: string;
    stopReason: "stop" | "aborted" | "error";
    durationMs: number;
    finalText: string;
    toolNames: string[];
    failedToolNames: string[];
    explicitSkillNames: string[];
    usedFallbackModel: boolean;
    modelFailureSummaries: string[];
    reflectionOutcome: "success" | "partial" | "failed";
    reflectionSummary: string;
    nextAction: string;
    memorySelectedCount: number;
    skillDraftPath: string;
  }

  interface Counts {
    total: number;
    success: number;
    partial: number;
    failed: number;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "运行反思",
      title: "运行历史",
      desc: "检查最近智能体的运行状态、产出结果以及后续执行建议。",
      btnRefresh: "刷新",
      loading: "正在加载运行历史...",
      recordsTitle: "运行历史记录",
      recordsDesc: "反思汇总：总数：{total} | 成功：{success} | 部分成功：{partial} | 失败：{failed}",
      noRecords: "尚未找到运行记录。",
      resultLabel: "结果：",
      memoryUsed: "已用记忆：",
      durationUnit: " 秒",
      summaryLabel: "摘要",
      noSummary: "无摘要",
      nextActionLabel: "下一步行动：",
      outputLabel: "输出快照",
      emptyContent: "(空)",
      toolsLabel: "工具",
      failuresLabel: "失败项",
      explicitSkillsLabel: "显式技能",
      fallbackLabel: "Fallback",
      yes: "是",
      no: "否",
      modelIssues: "模型异常：",
      savedDraft: "已保存草稿：",
      failedLoad: "加载运行历史失败",
      loadedMsg: "已加载 {count} 条运行记录。"
    },
    "en-US": {
      eyebrow: "Run Reflection",
      title: "Run History",
      desc: "Inspect recent agent runs, outcomes, and follow-up suggestions.",
      btnRefresh: "Refresh",
      loading: "Loading run history...",
      recordsTitle: "Run History Records",
      recordsDesc: "Outcome totals: Total: {total} | Success: {success} | Partial: {partial} | Failed: {failed}",
      noRecords: "No run records found yet.",
      resultLabel: "Result: ",
      memoryUsed: "Memory used: ",
      durationUnit: "s",
      summaryLabel: "Summary",
      noSummary: "No summary",
      nextActionLabel: "Next Action: ",
      outputLabel: "Output Snapshot",
      emptyContent: "(empty)",
      toolsLabel: "Tools",
      failuresLabel: "Failures",
      explicitSkillsLabel: "Explicit Skills",
      fallbackLabel: "Fallback",
      yes: "Yes",
      no: "No",
      modelIssues: "Model issues: ",
      savedDraft: "Saved draft: ",
      failedLoad: "Failed to load run history",
      loadedMsg: "Loaded {count} run record(s)."
    }
  } as const;

  let loading = true;
  let error = "";
  let message = "";
  let items: RunHistoryItem[] = [];
  let diagnostics: string[] = [];
  let counts: Counts = { total: 0, success: 0, partial: 0, failed: 0 };

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  function formatDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return "-";
    return `${Math.max(1, Math.round(durationMs / 1000))}${copy.durationUnit}`;
  }

  function outcomeVariant(outcome: RunHistoryItem["reflectionOutcome"]): "default" | "secondary" | "destructive" {
    if (outcome === "success") return "default";
    if (outcome === "partial") return "secondary";
    return "destructive";
  }

  async function loadRunHistory(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/run-history");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      items = Array.isArray(data.items) ? data.items : [];
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      counts = {
        total: Number(data.counts?.total ?? 0),
        success: Number(data.counts?.success ?? 0),
        partial: Number(data.counts?.partial ?? 0),
        failed: Number(data.counts?.failed ?? 0)
      };
      message = copy.loadedMsg.replace("{count}", String(items.length));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadRunHistory);
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
        <Button variant="outline" onclick={loadRunHistory}>{copy.btnRefresh}</Button>
      </div>
    </div>
  </div>

  {#if message || error}
    <div class="channel-card" style="padding: 1rem;">
      <div class="channel-card-body" style="gap: 0.5rem;">
        {#if message}
          <div class="settings-footbar-ok">{message}</div>
        {/if}
        {#if error}
          <div class="settings-footbar-error">{error}</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.recordsTitle}</h2>
          <p class="channel-card-desc">
            {copy.recordsDesc.replace("{total}", String(counts.total)).replace("{success}", String(counts.success)).replace("{partial}", String(counts.partial)).replace("{failed}", String(counts.failed))}
          </p>
        </div>
      </div>
      <div class="channel-card-body" style="gap: 1.5rem;">
        {#if diagnostics.length > 0}
          <div class="channel-hint" style="background: var(--muted); padding: 0.75rem; border-radius: 6px; white-space: pre-wrap;">
            {diagnostics.join("\n")}
          </div>
        {/if}

        {#if items.length === 0}
          <div class="channel-hint">
            {copy.noRecords}
          </div>
        {:else}
          {#each items as item}
            <div class="channel-card" style="padding: 1.25rem; background: var(--muted-soft, color-mix(in oklab, var(--muted) 4%, transparent)); border-color: var(--border);">
              <div class="channel-card-body" style="gap: 1rem;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                  <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <span class="channel-sidebar-btn-name">{item.botId} / {item.chatId}</span>
                    <Badge variant={outcomeVariant(item.reflectionOutcome)}>{item.reflectionOutcome}</Badge>
                  </div>
                  <div class="channel-sidebar-btn-id" style="text-align: right;">
                    <div>{copy.resultLabel}{item.stopReason}</div>
                    <div>{copy.memoryUsed}{item.memorySelectedCount}</div>
                  </div>
                </div>

                <div class="channel-sidebar-btn-id">
                  {formatDate(item.createdAt)} · {formatDuration(item.durationMs)} · {item.runId}
                </div>

                <div class="channel-field-row" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
                  <div class="channel-card" style="padding: 0.75rem; background: var(--card);">
                    <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--muted-foreground);">{copy.summaryLabel}</div>
                    <div style="font-size: 0.875rem; margin-top: 0.25rem;">{item.reflectionSummary || copy.noSummary}</div>
                    <div style="font-size: 0.75rem; margin-top: 0.5rem; color: var(--muted-foreground);">{copy.nextActionLabel}{item.nextAction || "-"}</div>
                  </div>
                  <div class="channel-card" style="padding: 0.75rem; background: var(--card);">
                    <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--muted-foreground);">{copy.outputLabel}</div>
                    <div style="font-size: 0.875rem; margin-top: 0.25rem; white-space: pre-wrap;">{item.finalText || copy.emptyContent}</div>
                  </div>
                </div>

                <div class="channel-field-row" style="grid-template-columns: repeat(4, 1fr); gap: 0.5rem;">
                  <div>
                    <div class="channel-sidebar-btn-id" style="font-weight: 600; text-transform: uppercase;">{copy.toolsLabel}</div>
                    <div style="font-size: 0.8125rem; margin-top: 0.125rem;">{item.toolNames.length > 0 ? item.toolNames.join(", ") : "-"}</div>
                  </div>
                  <div>
                    <div class="channel-sidebar-btn-id" style="font-weight: 600; text-transform: uppercase;">{copy.failuresLabel}</div>
                    <div style="font-size: 0.8125rem; margin-top: 0.125rem;">{item.failedToolNames.length > 0 ? item.failedToolNames.join(", ") : "-"}</div>
                  </div>
                  <div>
                    <div class="channel-sidebar-btn-id" style="font-weight: 600; text-transform: uppercase;">{copy.explicitSkillsLabel}</div>
                    <div style="font-size: 0.8125rem; margin-top: 0.125rem;">{item.explicitSkillNames.length > 0 ? item.explicitSkillNames.join(", ") : "-"}</div>
                  </div>
                  <div>
                    <div class="channel-sidebar-btn-id" style="font-weight: 600; text-transform: uppercase;">{copy.fallbackLabel}</div>
                    <div style="font-size: 0.8125rem; margin-top: 0.125rem;">{item.usedFallbackModel ? copy.yes : copy.no}</div>
                  </div>
                </div>

                {#if item.modelFailureSummaries.length > 0 || item.skillDraftPath}
                  <div class="channel-hint" style="background: var(--muted); padding: 0.5rem; border-radius: 6px;">
                    {#if item.modelFailureSummaries.length > 0}
                      <div>{copy.modelIssues}{item.modelFailureSummaries.join(" | ")}</div>
                    {/if}
                    {#if item.skillDraftPath}
                      <div style="margin-top: 0.125rem;">{copy.savedDraft}{item.skillDraftPath}</div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
