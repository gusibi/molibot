import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SkillScope } from "./skills.js";
import { parseSkillFrontmatter } from "./skillFrontmatter.js";
import { resolveDataRootFromWorkspacePath } from "./workspace.js";

export interface SkillDraftContext {
  workspaceDir: string;
  chatId: string;
  userMessage: string;
  finalAnswer: string;
  toolNames: string[];
  failedToolNames: string[];
  explicitSkillNames: string[];
  modelFailures: string[];
}

export interface SavedSkillDraft {
  filePath: string;
  fileName: string;
  name: string;
  content: string;
  merged?: boolean;
}

function slugify(input: string, fallback = "workflow"): string {
  const slug = String(input ?? "")
    .toLowerCase()
    .replace(/[`"'()[\]{}]+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function compactLine(input: string, max = 120): string {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function inferDraftName(message: string): string {
  const source = compactLine(message, 48)
    .replace(/^\/[^\s]+\s*/i, "")
    .replace(/^(请|帮我|麻烦|现在|直接)\s*/u, "");
  return slugify(source, "reusable-workflow");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeSimilarityText(input: string): string {
  return String(input ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function bigrams(input: string): Set<string> {
  const text = normalizeSimilarityText(input);
  if (!text) return new Set();
  if (text.length === 1) return new Set([text]);
  const out = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) {
    out.add(text.slice(index, index + 2));
  }
  return out;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let same = 0;
  for (const item of left) {
    if (right.has(item)) same += 1;
  }
  return same / (left.size + right.size - same);
}

function parseInlineList(raw: string | undefined): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];
  const inner = value.replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const frontmatter = parseSkillFrontmatter(content) ?? {};
  const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  return {
    frontmatter,
    body: match?.[1] ?? content
  };
}

function parseSections(body: string): Array<{ title: string; lines: string[] }> {
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const rawLine of String(body ?? "").split(/\r?\n/)) {
    const title = rawLine.match(/^#\s+(.+?)\s*$/)?.[1]?.trim();
    if (title) {
      current = { title, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(rawLine);
  }

  return sections;
}

function mergeLineGroups(existing: string[], incoming: string[], maxItems = 8): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const value = line.trim();
    const key = value.replace(/^\d+\.\s*/, "- ").replace(/\s+/g, " ").trim().toLowerCase();
    if (!value) {
      if (merged.length > 0 && merged[merged.length - 1] !== "") merged.push("");
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(value);
  };

  for (const line of existing) push(line);
  for (const line of incoming) push(line);

  const filtered = merged.filter((line, index) => line || (index > 0 && index < merged.length - 1));
  const compacted: string[] = [];
  for (const line of filtered) {
    if (!line && compacted[compacted.length - 1] === "") continue;
    compacted.push(line);
  }
  const nonEmptyCount = compacted.filter(Boolean).length;
  if (nonEmptyCount <= maxItems) return compacted;

  const out: string[] = [];
  let kept = 0;
  for (const line of compacted) {
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (kept >= maxItems) break;
    out.push(line);
    kept += 1;
  }
  return out;
}

function renderFrontmatter(fields: Record<string, string>): string {
  const orderedKeys = ["name", "description", "aliases", "draft", "source", "merge_count", "updated_at"];
  const keys = [...orderedKeys.filter((key) => key in fields), ...Object.keys(fields).filter((key) => !orderedKeys.includes(key))];
  return [
    "---",
    ...keys.map((key) => `${key}: ${fields[key]}`),
    "---",
    ""
  ].join("\n");
}

function mergeDescriptions(existing: string, incoming: string): string {
  const values = unique([existing, incoming].map((item) => compactLine(item, 120)).filter(Boolean));
  return values.join(" / ").slice(0, 220);
}

export function areSkillDraftsSimilar(input: {
  candidateName: string;
  candidateDescription: string;
  candidateMessage: string;
  existingFileName: string;
  existingContent: string;
}): boolean {
  const parsed = splitFrontmatter(input.existingContent);
  const existingName = slugify(parsed.frontmatter.name ?? input.existingFileName.replace(/\.md$/i, ""), "workflow");
  const candidateName = slugify(input.candidateName, "workflow");
  if (existingName === candidateName) return true;

  const existingText = [
    parsed.frontmatter.name,
    parsed.frontmatter.description,
    parsed.body
  ].filter(Boolean).join("\n");

  const messageScore = jaccard(bigrams(input.candidateMessage), bigrams(existingText));
  const descriptionScore = jaccard(bigrams(input.candidateDescription), bigrams(existingText));
  return Math.max(messageScore, descriptionScore) >= 0.58;
}

export function mergeSkillDraftMarkdown(
  existingContent: string,
  incomingContent: string,
  options?: { keepDraftMarkers?: boolean }
): string {
  const existing = splitFrontmatter(existingContent);
  const incoming = splitFrontmatter(incomingContent);
  const existingSections = parseSections(existing.body);
  const incomingSections = parseSections(incoming.body);
  const incomingByTitle = new Map(incomingSections.map((section) => [section.title, section.lines]));
  const mergedSections: Array<{ title: string; lines: string[] }> = [];
  const seenTitles = new Set<string>();

  for (const section of existingSections) {
    seenTitles.add(section.title);
    mergedSections.push({
      title: section.title,
      lines: mergeLineGroups(section.lines, incomingByTitle.get(section.title) ?? [], section.title === "Example Outcome" ? 10 : 8)
    });
  }

  for (const section of incomingSections) {
    if (seenTitles.has(section.title)) continue;
    mergedSections.push({
      title: section.title,
      lines: mergeLineGroups([], section.lines, section.title === "Example Outcome" ? 10 : 8)
    });
  }

  const aliases = unique([
    ...parseInlineList(existing.frontmatter.aliases),
    ...parseInlineList(incoming.frontmatter.aliases)
  ]);

  const mergeCount = Number(existing.frontmatter.merge_count ?? "1") + 1;
  const frontmatterFields: Record<string, string> = {
    ...existing.frontmatter,
    name: existing.frontmatter.name ?? incoming.frontmatter.name ?? "workflow",
    description: mergeDescriptions(existing.frontmatter.description ?? "", incoming.frontmatter.description ?? ""),
    aliases: `[${aliases.join(", ")}]`,
    merge_count: String(mergeCount),
    updated_at: new Date().toISOString()
  };

  if (options?.keepDraftMarkers !== false) {
    frontmatterFields.draft = "true";
    frontmatterFields.source = existing.frontmatter.source ?? incoming.frontmatter.source ?? "auto-run-summary";
  } else {
    delete frontmatterFields.draft;
    delete frontmatterFields.source;
  }

  const frontmatter = renderFrontmatter(frontmatterFields);

  const body = mergedSections
    .map((section) => [`# ${section.title}`, ...section.lines.filter((line, index, list) => line || (index > 0 && index < list.length - 1)), ""].join("\n"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return `${frontmatter}${body}\n`;
}

export function shouldSuggestSkillDraft(input: {
  stopReason: "stop" | "aborted" | "error";
  finalText: string;
  toolCalls: number;
  toolFailures: number;
  modelAttempts: number;
  explicitSkillCount: number;
}): boolean {
  if (input.stopReason !== "stop") return false;
  if (!input.finalText.trim()) return false;
  if (input.explicitSkillCount > 0) return false;
  if (input.toolCalls >= 4) return true;
  if (input.toolCalls >= 3 && input.toolFailures > 0) return true;
  if (input.modelAttempts >= 2 && input.toolCalls >= 2) return true;
  return false;
}

export function buildSkillDraftMarkdown(context: SkillDraftContext): { name: string; content: string } {
  const name = inferDraftName(context.userMessage);
  const toolNames = unique(context.toolNames);
  const failedTools = unique(context.failedToolNames);
  const modelFailures = unique(context.modelFailures);
  const aliases = unique([name, name.replace(/-/g, ""), name.replace(/-/g, "_")]).filter(Boolean);

  const lines = [
    "---",
    `name: ${name}`,
    `description: Reusable workflow draft for: ${compactLine(context.userMessage, 96)}`,
    `aliases: [${aliases.join(", ")}]`,
    "draft: true",
    "source: auto-run-summary",
    "merge_count: 1",
    `updated_at: ${new Date().toISOString()}`,
    "---",
    "",
    "# When To Use",
    `- Use for requests like: ${compactLine(context.userMessage, 140) || "(fill in exact trigger examples)"}`,
    "",
    "# Goal",
    "- Deliver the requested result without rebuilding the workflow from scratch.",
    "",
    "# Suggested Steps",
    "1. Re-read the user goal and identify the target artifact or outcome.",
    toolNames.length > 0
      ? `2. Prefer the same working path first: ${toolNames.join(", ")}.`
      : "2. Prefer the simplest validated tool path first.",
    "3. Verify the output before replying.",
    "4. If the primary path fails, state the actual reason and choose a concrete fallback.",
    "",
    "# Verification",
    "- Confirm the final output exists, is readable, and matches the requested format.",
    "- Do not claim success unless the result was actually produced.",
    "",
    "# Pitfalls",
    ...(failedTools.length > 0
      ? failedTools.map((name) => `- Tool failure seen before: ${name}. Recheck inputs before retrying.`)
      : ["- Replace this section with concrete failure modes after review."]),
    ...(modelFailures.length > 0
      ? modelFailures.map((item) => `- Model/runtime issue seen before: ${compactLine(item, 140)}`)
      : []),
    "",
    "# Example Outcome",
    `- Final answer snapshot: ${compactLine(context.finalAnswer, 180) || "(fill after review)"}`,
    ""
  ];

  return {
    name,
    content: lines.join("\n")
  };
}

export function saveSkillDraft(context: SkillDraftContext): SavedSkillDraft {
  const built = buildSkillDraftMarkdown(context);
  const dir = resolve(context.workspaceDir, "skill-drafts");
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const filePath = join(dir, entry.name);
    const existing = readFileSync(filePath, "utf8");
    if (
      areSkillDraftsSimilar({
        candidateName: built.name,
        candidateDescription: `Reusable workflow draft for: ${compactLine(context.userMessage, 96)}`,
        candidateMessage: context.userMessage,
        existingFileName: entry.name,
        existingContent: existing
      })
    ) {
      const mergedContent = mergeSkillDraftMarkdown(existing, built.content);
      writeFileSync(filePath, mergedContent, "utf8");
      return {
        filePath,
        fileName: entry.name,
        name: built.name,
        content: mergedContent,
        merged: true
      };
    }
  }
  const fileName = `${new Date().toISOString().slice(0, 10)}-${built.name}.md`;
  const filePath = join(dir, fileName);
  writeFileSync(filePath, built.content, "utf8");
  return {
    filePath,
    fileName,
    name: built.name,
    content: built.content,
    merged: false
  };
}

function resolveLiveSkillRoot(params: {
  workspaceDir: string;
  chatId: string;
  scope: SkillScope;
}): string {
  if (params.scope === "global") {
    return resolve(resolveDataRootFromWorkspacePath(params.workspaceDir), "skills");
  }
  if (params.scope === "chat") {
    return resolve(params.workspaceDir, params.chatId, "skills");
  }
  return resolve(params.workspaceDir, "skills");
}

function collectSkillFiles(rootDir: string, out: string[]): void {
  if (!existsSync(rootDir)) return;
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectSkillFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      out.push(fullPath);
    }
  }
}

export function saveLiveSkill(params: {
  workspaceDir: string;
  chatId: string;
  scope: SkillScope;
  name: string;
  content: string;
  overwrite?: boolean;
  mergeSimilar?: boolean;
}): SavedSkillDraft {
  const slug = slugify(params.name, "skill");
  const root = resolveLiveSkillRoot(params);
  const dir = join(root, slug);
  const filePath = join(dir, "SKILL.md");
  mkdirSync(dir, { recursive: true });
  if (!params.overwrite && existsSync(filePath)) {
    if (params.mergeSimilar !== false) {
      const mergedContent = mergeSkillDraftMarkdown(readFileSync(filePath, "utf8"), params.content, {
        keepDraftMarkers: false
      });
      writeFileSync(filePath, mergedContent, "utf8");
      return {
        filePath,
        fileName: "SKILL.md",
        name: slug,
        content: mergedContent,
        merged: true
      };
    }
    throw new Error(`Skill already exists: ${filePath}`);
  }
  if (!params.overwrite && params.mergeSimilar !== false) {
    const skillFiles: string[] = [];
    collectSkillFiles(root, skillFiles);
    const similar = skillFiles.find((candidatePath) => {
      if (resolve(candidatePath) === resolve(filePath)) return false;
      const existing = readFileSync(candidatePath, "utf8");
      return areSkillDraftsSimilar({
        candidateName: params.name,
        candidateDescription: params.content,
        candidateMessage: params.content,
        existingFileName: candidatePath.split("/").pop() || "SKILL.md",
        existingContent: existing
      });
    });
    if (similar) {
      const mergedContent = mergeSkillDraftMarkdown(readFileSync(similar, "utf8"), params.content, {
        keepDraftMarkers: false
      });
      writeFileSync(similar, mergedContent, "utf8");
      return {
        filePath: similar,
        fileName: "SKILL.md",
        name: slugify(similar.split("/").slice(-2, -1)[0] || "skill"),
        content: mergedContent,
        merged: true
      };
    }
  }
  writeFileSync(filePath, params.content, "utf8");
  return {
    filePath,
    fileName: "SKILL.md",
    name: slug,
    content: params.content,
    merged: false
  };
}

export function updateLiveSkill(params: {
  filePath: string;
  content: string;
}): SavedSkillDraft {
  const filePath = resolve(params.filePath);
  if (!existsSync(filePath)) {
    throw new Error(`Skill file not found: ${filePath}`);
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, params.content, "utf8");
  return {
    filePath,
    fileName: "SKILL.md",
    name: slugify(filePath.split("/").slice(-2, -1)[0] || "skill"),
    content: params.content
  };
}

export function readSkillDraft(filePath: string): string {
  return readFileSync(resolve(filePath), "utf8");
}

function stripDraftMarkers(content: string): string {
  return String(content ?? "")
    .replace(/\n?draft:\s*true\s*\n/i, "\n")
    .replace(/\n?source:\s*auto-run-summary\s*\n/i, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

function inferNameFromDraftPath(filePath: string): string {
  const base = resolve(filePath).split("/").pop() || "skill";
  return slugify(base.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/i, ""), "skill");
}

export function prepareDraftForPromotion(params: {
  draftPath: string;
  content: string;
  name?: string;
}): { name: string; content: string } {
  return {
    name: params.name?.trim() || inferNameFromDraftPath(params.draftPath),
    content: stripDraftMarkers(params.content)
  };
}

export function promoteDraftToLiveSkill(params: {
  draftPath: string;
  workspaceDir: string;
  chatId: string;
  scope: SkillScope;
  overwrite?: boolean;
  archiveDraft?: boolean;
  name?: string;
}): SavedSkillDraft {
  const draftPath = resolve(params.draftPath);
  const draftContent = readSkillDraft(draftPath);
  const prepared = prepareDraftForPromotion({
    draftPath,
    content: draftContent,
    name: params.name
  });
  const saved = saveLiveSkill({
    workspaceDir: params.workspaceDir,
    chatId: params.chatId,
    scope: params.scope,
    name: prepared.name,
    content: prepared.content,
    overwrite: params.overwrite,
    mergeSimilar: true
  });

  if (params.archiveDraft !== false) {
    try {
      unlinkSync(draftPath);
    } catch {
      // keep draft if cleanup fails
    }
  }

  return saved;
}
