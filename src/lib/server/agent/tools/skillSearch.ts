import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { loadSkillsFromWorkspace, searchSkillsLocally, type LoadedSkill, type SkillSearchMatch } from "../skills.js";
import { momLog } from "../log.js";
import type { RuntimeSettings } from "../../settings/index.js";

const skillSearchSchema = Type.Object({
  intent: Type.String(),
  maxResults: Type.Optional(Type.Number())
});

interface ApiDecision {
  matched: boolean;
  skillName: string | null;
  confidence: number;
  reason: string;
}

interface ResolvedApiConfig {
  providerId: string;
  providerName: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  path: string;
}

function normalizeProviderPath(path: string | undefined): string {
  const raw = String(path ?? "/v1/chat/completions").trim();
  if (!raw) return "/v1/chat/completions";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function trimBody(text: string): string {
  const source = String(text ?? "").trim();
  if (!source) return "(empty body)";
  return source.length > 600 ? `${source.slice(0, 600)}...` : source;
}

function extractJsonObject(text: string): string | null {
  const source = String(text ?? "").trim();
  if (!source) return null;
  if (source.startsWith("{") && source.endsWith("}")) return source;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first >= 0 && last > first) return source.slice(first, last + 1);
  return null;
}

function parseDecision(text: string): ApiDecision | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      matched: Boolean(parsed.matched),
      skillName: typeof parsed.skillName === "string" && parsed.skillName.trim()
        ? parsed.skillName.trim()
        : null,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : ""
    };
  } catch {
    return null;
  }
}

function buildApiPrompt(intent: string, skills: LoadedSkill[]): string {
  const skillLines = skills.map((skill) => {
    const aliasText = skill.aliases.length > 0 ? ` aliases=${skill.aliases.join(", ")}` : "";
    return `- name=${skill.name}; description=${skill.description};${aliasText}`;
  });
  return [
    "User intent:",
    intent.trim(),
    "",
    "Available skills:",
    ...skillLines,
    "",
    "Choose at most one skill.",
    "Return JSON only with keys: matched, skillName, confidence, reason.",
    "If no skill clearly fits, return matched=false, skillName=null.",
  ].join("\n");
}

function resolveApiConfig(
  settings: RuntimeSettings["skillSearch"]["api"],
  providers: RuntimeSettings["customProviders"]
): { config: ResolvedApiConfig | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const providerId = String(settings.provider ?? "").trim();
  const provider = providers.find((item) => item.id === providerId && item.enabled !== false) ?? null;
  const legacyBaseUrl = String(settings.baseUrl ?? "").trim();
  const legacyApiKey = String(settings.apiKey ?? "").trim();
  const legacyModel = String(settings.model ?? "").trim();
  const legacyPath = String(settings.path ?? "").trim() || "/v1/chat/completions";

  if (!provider) {
    if (!legacyBaseUrl || !legacyApiKey || !legacyModel) {
      diagnostics.push(providerId
        ? `api_search_skipped: provider_not_found:${providerId}`
        : "api_search_skipped: provider_not_selected");
    }
  }

  const providerModelIds = new Set(provider?.models.map((item) => item.id) ?? []);
  const model = provider
    ? (providerModelIds.has(legacyModel)
      ? legacyModel
      : provider.defaultModel?.trim()
        || provider.models[0]?.id?.trim()
        || "")
    : legacyModel;
  const baseUrl = String(provider?.baseUrl ?? legacyBaseUrl).trim();
  const apiKey = String(provider?.apiKey ?? legacyApiKey).trim();
  const path = String(provider?.path ?? legacyPath).trim() || "/v1/chat/completions";

  if (provider && legacyModel && !providerModelIds.has(legacyModel) && model) {
    diagnostics.push(`api_search_model_fallback: ${legacyModel} -> ${model}`);
  }
  if (!baseUrl) diagnostics.push("api_search_skipped: missing_base_url");
  if (!apiKey) diagnostics.push("api_search_skipped: missing_api_key");
  if (!model) diagnostics.push("api_search_skipped: missing_model");

  if (!baseUrl || !apiKey || !model) return { config: null, diagnostics };

  return {
    config: {
      providerId: provider?.id ?? "legacy",
      providerName: provider?.name ?? "Legacy Skill Search API",
      model,
      baseUrl,
      apiKey,
      path
    },
    diagnostics
  };
}

async function searchSkillsViaApi(
  intent: string,
  skills: LoadedSkill[],
  settings: RuntimeSettings["skillSearch"]["api"],
  providers: RuntimeSettings["customProviders"],
  signal?: AbortSignal
): Promise<{ match: SkillSearchMatch | null; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  if (!settings.enabled) return { match: null, diagnostics };
  const resolved = resolveApiConfig(settings, providers);
  diagnostics.push(...resolved.diagnostics);
  if (!resolved.config) return { match: null, diagnostics };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(
      `${resolved.config.baseUrl.replace(/\/$/, "")}${normalizeProviderPath(resolved.config.path)}`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.config.apiKey}`
      },
      body: JSON.stringify({
        model: resolved.config.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        messages: [
          {
            role: "system",
            content:
              "You are a strict skill router. Pick at most one skill. Output JSON only. Prefer no match over a weak match."
          },
          {
            role: "user",
            content: buildApiPrompt(intent, skills)
          }
        ]
      }),
      signal: controller.signal
      }
    );

    if (!response.ok) {
      diagnostics.push(`api_search_http_${response.status}: ${trimBody(await response.text())}`);
      return { match: null, diagnostics };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(data.choices?.[0]?.message?.content ?? "").trim();
    const decision = parseDecision(content);
    if (!decision) {
      diagnostics.push("api_search_invalid_json");
      return { match: null, diagnostics };
    }
    if (!decision.matched || !decision.skillName || decision.confidence < settings.minConfidence) {
      diagnostics.push(
        `api_search_no_match: matched=${String(decision.matched)} confidence=${decision.confidence.toFixed(2)}`
      );
      return { match: null, diagnostics };
    }

    const matchedSkill = skills.find((skill) => skill.name === decision.skillName)
      ?? skills.find((skill) => skill.aliases.some((alias) => alias === decision.skillName));
    if (!matchedSkill) {
      diagnostics.push(`api_search_unknown_skill: ${decision.skillName}`);
      return { match: null, diagnostics };
    }

    return {
      match: {
        skill: matchedSkill,
        score: Math.round(decision.confidence * 100),
        reasons: [decision.reason || "api_match"]
      },
      diagnostics
    };
  } catch (error) {
    diagnostics.push(`api_search_failed: ${error instanceof Error ? error.message : String(error)}`);
    return { match: null, diagnostics };
  } finally {
    clearTimeout(timeout);
  }
}

function isClearLocalWinner(matches: SkillSearchMatch[]): boolean {
  if (matches.length === 0) return false;
  if (matches.length === 1) return matches[0].score >= 40;
  return matches[0].score >= 40 && matches[0].score - matches[1].score >= 15;
}

export function createSkillSearchTool(options: {
  workspaceDir: string;
  chatId: string;
  getSettings: () => RuntimeSettings;
}): AgentTool<typeof skillSearchSchema> {
  return {
    name: "skillSearch",
    label: "skillSearch",
    description:
      "Search installed skills before using generic tools. Use this for non-trivial tasks that may require a reusable skill, external search, media generation, scripting, or workflow execution.",
    parameters: skillSearchSchema,
    execute: async (toolCallId, params, signal) => {
      const settings = options.getSettings();
      const { skills } = loadSkillsFromWorkspace(options.workspaceDir, options.chatId, {
        disabledSkillPaths: settings.disabledSkillPaths
      });
      const intent = String(params.intent ?? "").trim();
      const maxResults = Math.max(1, Math.min(10, Number(params.maxResults ?? 5) || 5));
      momLog("runner", "skill_search_start", {
        chatId: options.chatId,
        toolCallId,
        intent,
        maxResults,
        localEnabled: settings.skillSearch.local.enabled,
        apiEnabled: settings.skillSearch.api.enabled,
        apiProvider: settings.skillSearch.api.provider,
        apiModel: settings.skillSearch.api.model,
        skillCount: skills.length
      });
      if (!intent) {
        momLog("runner", "skill_search_end", {
          chatId: options.chatId,
          toolCallId,
          source: "none",
          matchedCount: 0,
          matches: [],
          diagnostics: ["empty_intent"]
        });
        return {
          content: [{ type: "text", text: "No search intent provided." }],
          details: { matches: [], source: "none" }
        };
      }

      const diagnostics: string[] = [];
      let source: "none" | "local" | "api" | "local+api" = "none";
      let matches: SkillSearchMatch[] = [];

      if (settings.skillSearch.local.enabled) {
        matches = searchSkillsLocally(skills, intent, maxResults);
        source = matches.length > 0 ? "local" : "none";
        momLog("runner", "skill_search_local_result", {
          chatId: options.chatId,
          toolCallId,
          intent,
          source,
          matchedCount: matches.length,
          matches: matches.map((match) => ({
            name: match.skill.name,
            score: match.score,
            reasons: match.reasons
          }))
        });
      }

      if (
        settings.skillSearch.api.enabled &&
        (!settings.skillSearch.local.enabled || matches.length === 0 || !isClearLocalWinner(matches))
      ) {
        const apiResult = await searchSkillsViaApi(
          intent,
          skills,
          settings.skillSearch.api,
          settings.customProviders,
          signal
        );
        diagnostics.push(...apiResult.diagnostics);
        momLog("runner", "skill_search_api_result", {
          chatId: options.chatId,
          toolCallId,
          intent,
          apiProvider: settings.skillSearch.api.provider,
          apiModel: settings.skillSearch.api.model,
          matched: Boolean(apiResult.match),
          match: apiResult.match
            ? {
              name: apiResult.match.skill.name,
              score: apiResult.match.score,
              reasons: apiResult.match.reasons
            }
            : null,
          diagnostics: apiResult.diagnostics
        });
        if (apiResult.match) {
          if (!matches.some((item) => item.skill.filePath === apiResult.match?.skill.filePath)) {
            matches = [apiResult.match, ...matches].slice(0, maxResults);
          }
          source = source === "local" ? "local+api" : "api";
        }
      }

      if (matches.length === 0) {
        const suffix = diagnostics.length > 0 ? `\nDiagnostics:\n- ${diagnostics.join("\n- ")}` : "";
        momLog("runner", "skill_search_end", {
          chatId: options.chatId,
          toolCallId,
          intent,
          source,
          matchedCount: 0,
          matches: [],
          diagnostics
        });
        return {
          content: [{ type: "text", text: `No matching skill found for: ${intent}${suffix}` }],
          details: { matches: [], source, diagnostics }
        };
      }

      const lines = matches.map((match, index) => {
        const reasons = match.reasons.length > 0 ? ` reasons=${match.reasons.join(", ")}` : "";
        return `${index + 1}. ${match.skill.name}\n   skill_file: ${match.skill.filePath}\n   scope: ${match.skill.scope}\n   score: ${match.score}${reasons}`;
      });
      if (diagnostics.length > 0) {
        lines.push("Diagnostics:");
        for (const row of diagnostics) lines.push(`- ${row}`);
      }
      momLog("runner", "skill_search_end", {
        chatId: options.chatId,
        toolCallId,
        intent,
        source,
        matchedCount: matches.length,
        matches: matches.map((match) => ({
          name: match.skill.name,
          filePath: match.skill.filePath,
          scope: match.skill.scope,
          score: match.score,
          reasons: match.reasons
        })),
        diagnostics
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          matches: matches.map((match) => ({
            name: match.skill.name,
            filePath: match.skill.filePath,
            scope: match.skill.scope,
            score: match.score,
            reasons: match.reasons
          })),
          source,
          diagnostics
        }
      };
    }
  };
}
