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
}

export interface DailyMaterialsRunResult {
  targetId: string;
  runKey: string;
  createdFile: string | null;
  scannedConversations: number;
  scannedMessages: number;
  usedFallbackPrompt: boolean;
}

type ProjectLookup = { get(id: string): { id: string; rootPath: string } | null };
const DEFAULT_DIR = "content/daily-materials";
const DEFAULT_PROMPT = "Extract useful daily content materials from the authorized transcript below. Return Markdown only. Remove credentials, personal identifiers, third-party privacy, and unreleased project details. If nothing qualifies, return exactly: 今日无可用素材";
const MAX_TRANSCRIPT_CHARS = 60_000;
const SECRET_PATTERN = /(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|password\s*[:=])/i;

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

function boundedTranscript(projections: ReflectionSourceProjection[]): { text: string; truncated: boolean } {
  const full = projections.map(projectionText).join("\n\n");
  return full.length <= MAX_TRANSCRIPT_CHARS ? { text: full, truncated: false } : { text: full.slice(-MAX_TRANSCRIPT_CHARS), truncated: true };
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
    const targetId = dailyMaterialsTargetId(target);
    const runKey = `${targetId}:${localDate}`;
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Daily materials aborted.");
    const projections = await this.reader.read(target, localDate);
    const scannedMessages = projections.reduce((count, projection) => count + projection.messages.length, 0);
    if (projections.length === 0) return { targetId, runKey, createdFile: null, scannedConversations: 0, scannedMessages: 0, usedFallbackPrompt: false };

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
    const transcript = boundedTranscript(projections);
    const prompt = [template, `Task ID: ${options.taskId || "daily-materials"}`, `Local date: ${localDate}`, transcript.truncated ? "Note: older transcript content was truncated to the 60,000-character safety budget." : "", transcript.text].filter(Boolean).join("\n\n");
    const body = normalizeMarkdown(await this.reply(prompt));
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
    return { targetId, runKey, createdFile: relativeFile, scannedConversations: projections.length, scannedMessages, usedFallbackPrompt };
  }
}
