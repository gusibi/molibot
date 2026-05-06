import { existsSync, readFileSync } from "node:fs";

export interface SkillDraftMetadataContext {
  userMessage: string;
  finalAnswer: string;
  toolNames: string[];
  templateSkillPath?: string;
  requestedName?: string;
  requestedDescription?: string;
  requestedTriggers?: string[];
}

export interface SkillDraftMetadata {
  name: string;
  description: string;
  aliases: string[];
  trigger: string;
}

const GENERIC_RETRY_PATTERNS = [
  /^重试(一下|下)?$/u,
  /^再试(一下|下)?$/u,
  /^再来(一次|一下)?$/u,
  /^retry( again)?$/iu,
  /^try again$/iu
];

const CN_TOKEN_MAP: Array<[RegExp, string]> = [
  [/昨日|昨天/u, "yesterday"],
  [/今日|今天/u, "today"],
  [/数据/u, "data"],
  [/回顾|复盘/u, "review"],
  [/新闻|资讯/u, "news"],
  [/摘要|总结|整理/u, "summary"],
  [/日报/u, "daily-report"],
  [/周报/u, "weekly-report"],
  [/月报/u, "monthly-report"],
  [/图片|图像/u, "image"],
  [/生成|创建/u, "generation"],
  [/搜索|检索/u, "search"],
  [/查询|查一下/u, "query"],
  [/语音|音频/u, "voice"],
  [/提醒|定时/u, "reminder"],
  [/草稿/u, "draft"],
  [/技能|skill/iu, "skill"]
];

function compactLine(input: string, max = 140): string {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= max ? normalized : normalized.slice(0, max).trimEnd();
}

export function slugifySkillName(input: string, fallback = "reusable-workflow"): string {
  const slug = String(input ?? "")
    .toLowerCase()
    .replace(/[`"'()[\]{}]+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function stripRequestNoise(input: string): string {
  return compactLine(input, 120)
    .replace(/^\/[^\s]+\s*/i, "")
    .replace(/^(请|帮我|麻烦|现在|直接|可以|能不能|能否)\s*/u, "")
    .replace(/为什么没有/gu, "")
    .replace(/怎么没有/gu, "")
    .replace(/只有[^，。！？,!?]{1,24}(，|,)?/gu, "")
    .replace(/我这个是?要/gu, "")
    .replace(/这个是?要/gu, "")
    .replace(/要在第[一二三四五六七八九十0-9]+条就列出来/gu, "")
    .replace(/^(重试|再试|再来)(一下|下|一次)?/u, "")
    .replace(/[，。！？,!?；;：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericRetry(input: string): boolean {
  const normalized = compactLine(input, 30).replace(/[。！？!?.\s]+$/g, "");
  return GENERIC_RETRY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function extractChineseFeaturePhrase(input: string): string {
  const cleaned = stripRequestNoise(input);
  const explicit = cleaned.match(/(?:要有|需要|添加|增加|生成|整理|创建|实现|输出|列出)([\u4e00-\u9fa5a-zA-Z0-9-]{2,32})/u)?.[1];
  const source = explicit || cleaned;
  const nounPhrase = source.match(/[\u4e00-\u9fa5]{2,24}(?:数据回顾|回顾|复盘|摘要|总结|日报|周报|月报|搜索|查询|提醒|草稿|技能)/u)?.[0];
  return (nounPhrase || source)
    .replace(/^(的|了|要|有)+/u, "")
    .replace(/(的|了|呢|啊)+$/u, "")
    .trim();
}

function englishTokensFromChinese(input: string): string[] {
  const tokens: string[] = [];
  for (const [pattern, token] of CN_TOKEN_MAP) {
    if (pattern.test(input) && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

function identifierFromFeaturePhrase(input: string): string {
  const englishTokens = englishTokensFromChinese(input);
  if (englishTokens.length >= 2) return englishTokens.join("-");
  if (englishTokens.length === 1) return `${englishTokens[0]}-workflow`;
  return input;
}

function summarizeNameCandidate(context: SkillDraftMetadataContext): string {
  if (context.requestedName?.trim()) return context.requestedName;
  const message = compactLine(context.userMessage, 160);
  if (isGenericRetry(message)) {
    const answerPhrase = extractChineseFeaturePhrase(context.finalAnswer);
    if (answerPhrase && !isGenericRetry(answerPhrase)) return identifierFromFeaturePhrase(answerPhrase);
    const firstTool = context.toolNames.find(Boolean);
    return firstTool ? `${firstTool}-workflow` : "reusable-workflow";
  }
  const featurePhrase = extractChineseFeaturePhrase(message);
  return identifierFromFeaturePhrase(featurePhrase) || "reusable-workflow";
}

function readTemplateRules(filePath: string | undefined): string {
  const normalized = String(filePath ?? "").trim();
  if (!normalized || !existsSync(normalized)) return "";
  try {
    return readFileSync(normalized, "utf8");
  } catch {
    return "";
  }
}

function templateUsesSkillCreatorRules(templateContent: string): boolean {
  return /name:\s*skill-creator/i.test(templateContent) || /Write the SKILL\.md/i.test(templateContent);
}

export function buildSkillDraftMetadata(context: SkillDraftMetadataContext): SkillDraftMetadata {
  const templateRules = readTemplateRules(context.templateSkillPath);
  const enforceSkillCreatorMetadata = templateUsesSkillCreatorRules(templateRules);
  const trigger = compactLine(context.userMessage, 140) || "(fill in exact trigger examples)";
  const rawName = summarizeNameCandidate(context);
  const name = slugifySkillName(rawName, "reusable-workflow");
  const description = compactLine(
    context.requestedDescription ||
      (enforceSkillCreatorMetadata
        ? `Use when the user needs this reusable workflow: ${trigger}`
        : `Reusable workflow draft for: ${trigger}`),
    220
  );
  const aliases = [
    name,
    name.replace(/-/g, ""),
    name.replace(/-/g, "_"),
    ...(
      Array.isArray(context.requestedTriggers)
        ? context.requestedTriggers.map((item) => slugifySkillName(item, "")).filter(Boolean)
        : []
    )
  ];
  return {
    name,
    description,
    aliases: [...new Set(aliases)].filter(Boolean),
    trigger
  };
}
