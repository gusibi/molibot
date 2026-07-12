import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { InternalEventTarget } from "$lib/server/agent/events.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { previousReflectionLocalDate, type ReflectionSourceProjection, type ReflectionSourceReader, type ReflectionStateStore, type ReflectionTarget } from "$lib/server/memory/reflection.js";

export interface DailyMaterialsInternal {
  kind: "daily-materials";
  target: InternalEventTarget;
  promptPath?: string;
  output?: { projectId: string; dir?: string };
  // Per-run token budget for the assembled transcript. When the day's material
  // exceeds it, the scan splits into batches instead of dropping older sessions.
  scanTokenBudget?: number;
}

export interface DailyMaterialsRunResult {
  targetId: string;
  runKey: string;
  createdFile: string | null;
  scannedConversations: number;
  scannedMessages: number;
  usedFallbackPrompt: boolean;
  // How the day was processed: number of model batches, and how many individual
  // conversations were themselves too large to fit and got tail-truncated.
  batches: number;
  truncatedConversations: number;
}

export interface DailyMaterialsBackfillProgress {
  index: number;
  total: number;
  localDate: string;
  createdFile: string | null;
  daysWithData: number;
  scannedMessages: number;
}

export interface DailyMaterialsBackfillResult {
  from: string;
  to: string;
  totalDays: number;
  daysWithData: number;
  scannedMessages: number;
  createdFiles: string[];
}

// A reader that can additionally report the earliest activity date, so the
// backfill can auto-pick a start date. Optional so any bare reader still works.
type EarliestDateReader = ReflectionSourceReader & {
  earliestLocalDate?(target: ReflectionTarget): string | undefined;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
// Hard cap so a bad timezone/clock can never enqueue an unbounded run.
const MAX_BACKFILL_DAYS = 800;

function normalizeDateKey(value: string | undefined): string | undefined {
  return value && DATE_KEY.test(value) ? value : undefined;
}

// Inclusive ascending list of YYYY-MM-DD from `from` to `to`. Ascending order is
// required so each day advances the watermark past that day's messages, letting
// the next day continue cleanly without re-scanning.
function enumerateDates(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let cursor = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  const dates: string[] = [];
  while (cursor <= end && dates.length < MAX_BACKFILL_DAYS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return dates;
}

type ProjectLookup = { get(id: string): { id: string; rootPath: string } | null };
const DEFAULT_DIR = "content/daily-materials";
const DEFAULT_PROMPT = "Extract useful daily content materials from the authorized transcript below. Return Markdown only. Remove credentials, personal identifiers, third-party privacy, and unreleased project details. If nothing qualifies, return exactly: 今日无可用素材";
const SECRET_PATTERN = /(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|password\s*[:=])/i;
// Default transcript budget in estimated tokens. Sized for large-context models
// but overridable per config (`dailyMaterials.scanTokenBudget`).
const DEFAULT_SCAN_TOKEN_BUDGET = 120_000;
const MIN_SCAN_TOKEN_BUDGET = 8_000;
const MAX_SCAN_TOKEN_BUDGET = 900_000;

function normalizeTokenBudget(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCAN_TOKEN_BUDGET;
  return Math.min(MAX_SCAN_TOKEN_BUDGET, Math.max(MIN_SCAN_TOKEN_BUDGET, Math.round(n)));
}

// Rough CJK-aware token estimate (CLAUDE.md pitfall #7): CJK characters count as
// ~1 token each; other characters as ~1/4. Whitespace-splitting or chars/4 alone
// under-counts Chinese ~3-4x and would silently disable the batching guard.
function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0x3400 && code <= 0x9fff) || // CJK Unified + Ext-A
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff);   // CJK compatibility
    if (isCjk) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

// Keep the newest tail of one over-budget conversation. Used only when a single
// conversation alone exceeds the whole budget, so it still gets represented.
function truncateToBudget(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  let kept = text.slice(-tokenBudget * 2);
  while (kept.length > 0 && estimateTokens(kept) > tokenBudget) {
    kept = kept.slice(Math.ceil(kept.length * 0.1));
  }
  return kept;
}

// Greedily pack per-conversation blocks into batches that each fit the budget.
// Ascending message order is preserved; no conversation is dropped — an oversized
// one is tail-truncated into its own batch.
function planBatches(projections: ReflectionSourceProjection[], tokenBudget: number): { batches: string[]; truncatedConversations: number } {
  const batches: string[] = [];
  let current = "";
  let currentTokens = 0;
  let truncatedConversations = 0;
  for (const projection of projections) {
    let block = projectionText(projection);
    if (estimateTokens(block) > tokenBudget) {
      block = `${truncateToBudget(block, tokenBudget)}\n（注意：该会话过长，仅保留最新片段）`;
      truncatedConversations += 1;
    }
    const blockTokens = estimateTokens(block);
    if (currentTokens > 0 && currentTokens + blockTokens > tokenBudget) {
      batches.push(current);
      current = "";
      currentTokens = 0;
    }
    current = current ? `${current}\n\n${block}` : block;
    currentTokens += blockTokens;
  }
  if (current) batches.push(current);
  return { batches, truncatedConversations };
}

function canonicalScopes(target: ReflectionTarget): string[] {
  return target.sourceScopes.map((scope) => [scope.channel, scope.externalUserId, scope.projectId ?? ""].map(encodeURIComponent).join(":")).sort();
}

export function dailyMaterialsTargetId(target: ReflectionTarget): string {
  return createHash("sha256").update(JSON.stringify(["daily-materials", target.ownerId, target.botId, target.timezone, canonicalScopes(target)])).digest("hex");
}

function resolveInside(rootPath: string, configuredPath: string, label: string): string {
  if (!configuredPath.trim() || isAbsolute(configuredPath)) throw new Error(`${label} must be a relative path.`);
  const root = resolve(rootPath);
  const target = resolve(root, configuredPath);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} must stay inside the project root.`);
  const realRoot = realpathSync(root);
  let existingAncestor = target;
  while (!existsSync(existingAncestor)) existingAncestor = dirname(existingAncestor);
  const realAncestor = realpathSync(existingAncestor);
  const realRel = relative(realRoot, realAncestor);
  if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) throw new Error(`${label} must stay inside the project root.`);
  return target;
}

function projectionText(projection: ReflectionSourceProjection): string {
  const messages = projection.messages.map((message) => `[id=${message.id}] ${message.role}: ${message.content}`).join("\n");
  return [`## ${projection.scope.channel}/${projection.conversationId}`, projection.latestSummary ? `Summary: ${projection.latestSummary}` : "", messages].filter(Boolean).join("\n");
}

function normalizeMarkdown(value: string): string {
  const trimmed = value.trim();
  return trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)?.[1]?.trim() ?? trimmed;
}

function extractionPrompt(
  template: string,
  taskId: string,
  localDate: string,
  transcript: string,
  meta: { batchIndex?: number; batchCount?: number; truncated: boolean }
): string {
  const batchNote = meta.batchCount && meta.batchCount > 1
    ? `注意：今日素材较多，已分 ${meta.batchCount} 批处理，这是第 ${meta.batchIndex}/${meta.batchCount} 批；只需从本批提取素材，稍后会统一汇总。`
    : "";
  const truncNote = meta.truncated ? "注意：个别超长会话仅保留了最新片段。" : "";
  return [template, `Task ID: ${taskId}`, `Local date: ${localDate}`, batchNote, truncNote, transcript].filter(Boolean).join("\n\n");
}

function synthesisPrompt(template: string, localDate: string, partials: string[]): string {
  const notes = partials.map((partial, index) => `### 第 ${index + 1} 批素材\n\n${partial}`).join("\n\n");
  return [
    template,
    `Local date: ${localDate}`,
    "以下是同一天分批提取的素材笔记，请按上面的模板要求合并、去重、整理成当日最终素材文件；若各批都没有可用素材，只输出「今日无可用素材」。",
    notes
  ].join("\n\n");
}

export class DailyMaterialsService {
  constructor(
    private readonly reader: ReflectionSourceReader,
    private readonly state: ReflectionStateStore,
    private readonly reply: (prompt: string) => Promise<string>,
    private readonly projects: ProjectLookup = getProjectStore()
  ) {}

  async run(internal: DailyMaterialsInternal, options: { now?: Date; signal?: AbortSignal; taskId?: string } = {}): Promise<DailyMaterialsRunResult> {
    const target = internal.target as ReflectionTarget;
    const now = options.now ?? new Date();
    const localDate = previousReflectionLocalDate(now, target.timezone);
    return this.runForDate(internal, localDate, options);
  }

  // Scan a range of past days one at a time (ascending) and produce a material
  // file per day that has content. Idempotent: watermarks advance per day, so a
  // re-run — or a resume after an interruption — quietly skips covered days.
  async runBackfill(
    internal: DailyMaterialsInternal,
    options: {
      from?: string;
      to?: string;
      now?: Date;
      signal?: AbortSignal;
      onProgress?: (progress: DailyMaterialsBackfillProgress) => void;
    } = {}
  ): Promise<DailyMaterialsBackfillResult> {
    const target = internal.target as ReflectionTarget;
    const now = options.now ?? new Date();
    const to = normalizeDateKey(options.to) ?? previousReflectionLocalDate(now, target.timezone);
    let from = normalizeDateKey(options.from);
    if (!from) {
      const reader = this.reader as EarliestDateReader;
      from = reader.earliestLocalDate?.(target) ?? to;
    }
    if (from > to) from = to;
    const dates = enumerateDates(from, to);

    let daysWithData = 0;
    let scannedMessages = 0;
    const createdFiles: string[] = [];
    for (let index = 0; index < dates.length; index += 1) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials backfill aborted.");
      const localDate = dates[index];
      const result = await this.runForDate(internal, localDate, { now, signal: options.signal });
      scannedMessages += result.scannedMessages;
      if (result.createdFile) {
        createdFiles.push(result.createdFile);
        daysWithData += 1;
      }
      options.onProgress?.({ index: index + 1, total: dates.length, localDate, createdFile: result.createdFile, daysWithData, scannedMessages });
    }
    return { from, to: dates.at(-1) ?? to, totalDays: dates.length, daysWithData, scannedMessages, createdFiles };
  }

  private async runForDate(internal: DailyMaterialsInternal, localDate: string, options: { now?: Date; signal?: AbortSignal; taskId?: string } = {}): Promise<DailyMaterialsRunResult> {
    const target = internal.target as ReflectionTarget;
    const now = options.now ?? new Date();
    const targetId = dailyMaterialsTargetId(target);
    const runKey = `${targetId}:${localDate}`;
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials aborted.");
    const projections = await this.reader.read(target, localDate);
    const scannedMessages = projections.reduce((count, projection) => count + projection.messages.length, 0);
    if (projections.length === 0) return { targetId, runKey, createdFile: null, scannedConversations: 0, scannedMessages: 0, usedFallbackPrompt: false, batches: 0, truncatedConversations: 0 };

    const projectId = String(internal.output?.projectId ?? "").trim();
    const project = projectId ? this.projects.get(projectId) : null;
    if (!project) throw new Error(`Daily materials output project is not registered: ${projectId || "(empty)"}`);
    const outputDir = String(internal.output?.dir ?? DEFAULT_DIR).trim() || DEFAULT_DIR;
    resolveInside(project.rootPath, outputDir, "Daily materials output directory");
    const promptPath = String(internal.promptPath ?? "").trim();
    let template = DEFAULT_PROMPT;
    let usedFallbackPrompt = true;
    if (promptPath) {
      const resolvedPrompt = resolveInside(project.rootPath, promptPath, "Daily materials prompt path");
      if (existsSync(resolvedPrompt)) {
        template = readFileSync(resolvedPrompt, "utf8");
        usedFallbackPrompt = false;
      }
    }
    const tokenBudget = normalizeTokenBudget(internal.scanTokenBudget);
    const taskId = options.taskId || "daily-materials";
    const { batches, truncatedConversations } = planBatches(projections, tokenBudget);

    let body: string;
    if (batches.length <= 1) {
      // Small day: one extraction call over the whole transcript.
      const prompt = extractionPrompt(template, taskId, localDate, batches[0] ?? "", { truncated: truncatedConversations > 0 });
      body = normalizeMarkdown(await this.reply(prompt));
    } else {
      // Busy day: extract each batch, then synthesize the day's file from the
      // partial notes so no session is dropped and cross-session dedup happens.
      const partials: string[] = [];
      for (let index = 0; index < batches.length; index += 1) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials aborted.");
        const prompt = extractionPrompt(template, taskId, localDate, batches[index], { batchIndex: index + 1, batchCount: batches.length, truncated: truncatedConversations > 0 });
        partials.push(normalizeMarkdown(await this.reply(prompt)));
      }
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials aborted.");
      body = normalizeMarkdown(await this.reply(synthesisPrompt(template, localDate, partials)));
    }
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials aborted.");
    if (SECRET_PATTERN.test(body)) throw new Error("Daily materials output contains a credential-like value.");

    const relativeFile = `${outputDir.replace(/[\\/]+$/, "")}/${localDate}.md`;
    const outputFile = resolveInside(project.rootPath, relativeFile, "Daily materials output file");
    mkdirSync(dirname(outputFile), { recursive: true });
    if (existsSync(outputFile)) {
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: target.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
      writeFileSync(outputFile, `\n\n---\n\n## 补充（${time} 生成）\n\n${body}\n`, { encoding: "utf8", flag: "a" });
    } else {
      writeFileSync(outputFile, `${body}\n`, "utf8");
    }
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials aborted.");
    for (const projection of projections) {
      const last = projection.messages.at(-1);
      if (last) this.state.set(targetId, projection.conversationId, `${last.createdAt}:${last.id}`, runKey);
    }
    return { targetId, runKey, createdFile: relativeFile, scannedConversations: projections.length, scannedMessages, usedFallbackPrompt, batches: batches.length, truncatedConversations };
  }
}
