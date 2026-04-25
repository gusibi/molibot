import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { momLog } from "../log.js";

export interface DeferredToolEntry {
  name: string;
  label: string;
  description: string;
  keywords: string[];
  tool: AgentTool<any>;
}

const toolSearchSchema = Type.Object({
  query: Type.String({
    description: "Query to find deferred tools. Use \"select:<tool_name>\" for direct selection, or keywords to search."
  }),
  maxResults: Type.Optional(Type.Number({ description: "Maximum number of matches to return. Defaults to 5." }))
});

function normalize(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchableText(entry: DeferredToolEntry): string {
  return normalize([
    entry.name,
    entry.label,
    entry.description,
    ...entry.keywords
  ].join(" "));
}

function scoreEntry(query: string, entry: DeferredToolEntry): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  const haystack = searchableText(entry);

  if (normalize(entry.name) === normalizedQuery) return 100;
  if (haystack.includes(normalizedQuery)) return 70;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (normalize(entry.name).split(/\s+/).includes(term)) score += 25;
    else if (entry.keywords.some((keyword) => normalize(keyword) === term)) score += 20;
    else if (haystack.includes(term)) score += 10;
  }
  return score;
}

function explainEntryScore(query: string, entry: DeferredToolEntry): {
  name: string;
  normalizedName: string;
  searchableText: string;
  score: number;
  reasons: string[];
} {
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(entry.name);
  const haystack = searchableText(entry);
  const reasons: string[] = [];
  if (!normalizedQuery) {
    return { name: entry.name, normalizedName, searchableText: haystack, score: 0, reasons: ["empty_query"] };
  }
  if (normalizedName === normalizedQuery) reasons.push("exact_name");
  if (haystack.includes(normalizedQuery)) reasons.push("phrase_match");

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const nameTerms = normalizedName.split(/\s+/).filter(Boolean);
  for (const term of terms) {
    if (nameTerms.includes(term)) reasons.push(`name_term:${term}`);
    else if (entry.keywords.some((keyword) => normalize(keyword) === term)) reasons.push(`keyword:${term}`);
    else if (haystack.includes(term)) reasons.push(`text_term:${term}`);
    else reasons.push(`miss:${term}`);
  }

  return {
    name: entry.name,
    normalizedName,
    searchableText: haystack,
    score: scoreEntry(query, entry),
    reasons
  };
}

function parseQueryTerms(query: string): { requiredTerms: string[]; optionalTerms: string[] } {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const requiredTerms: string[] = [];
  const optionalTerms: string[] = [];
  for (const term of terms) {
    if (term.startsWith("+") && term.length > 1) requiredTerms.push(term.slice(1));
    else optionalTerms.push(term);
  }
  return { requiredTerms, optionalTerms };
}

function entryMatchesRequiredTerms(entry: DeferredToolEntry, requiredTerms: string[]): boolean {
  if (requiredTerms.length === 0) return true;
  const normalizedName = normalize(entry.name);
  return requiredTerms.every((term) => normalizedName.includes(normalize(term)));
}

function parseDirectSelections(query: string): string[] | null {
  const direct = query.match(/^select:(.+)$/i)?.[1]?.trim();
  if (!direct) return null;
  return direct
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildFunctionSchema(entry: DeferredToolEntry): Record<string, unknown> {
  return {
    description: entry.tool.description ?? entry.description,
    name: entry.tool.name,
    parameters: entry.tool.parameters
  };
}

function buildFunctionsBlock(entries: DeferredToolEntry[]): string {
  return [
    "<functions>",
    ...entries.map((entry) => `<function>${JSON.stringify(buildFunctionSchema(entry))}</function>`),
    "</functions>"
  ].join("\n");
}

export function createToolSearchTool(options: {
  chatId: string;
  getDeferredTools: () => DeferredToolEntry[];
  loadDeferredTools: (toolNames: string[]) => string[];
}): AgentTool<typeof toolSearchSchema> {
  return {
    name: "toolSearch",
    label: "toolSearch",
    description: [
      "Fetches full schema definitions for deferred tools so they can be called.",
      "Deferred tools appear by name in <available-deferred-tools> messages. Until fetched, only the name is known.",
      "Use select:<tool_name> or select:<tool_a>,<tool_b> for direct selection, keywords for search, or +term to require a term in the tool name."
    ].join("\n"),
    parameters: toolSearchSchema,
    executionMode: "sequential",
    execute: async (toolCallId, params) => {
      const query = String(params.query ?? "").trim();
      const normalizedQuery = normalize(query);
      const maxResults = Math.max(1, Math.min(10, Number(params.maxResults ?? 5) || 5));
      const deferredTools = options.getDeferredTools();
      momLog("runner", "tool_search_start", {
        chatId: options.chatId,
        toolCallId,
        query,
        normalizedQuery,
        maxResults,
        deferredToolCount: deferredTools.length,
        deferredTools: deferredTools.map((entry) => ({
          name: entry.name,
          normalizedName: normalize(entry.name),
          keywords: entry.keywords
        }))
      });

      if (!query) {
        return {
          content: [{ type: "text", text: "No tool search query provided." }],
          details: { matches: [], loaded: [] }
        };
      }

      const directSelections = parseDirectSelections(query);
      const parsedTerms = parseQueryTerms(query);
      momLog("runner", "tool_search_query_parsed", {
        chatId: options.chatId,
        toolCallId,
        query,
        normalizedQuery,
        directSelections,
        requiredTerms: parsedTerms.requiredTerms,
        optionalTerms: parsedTerms.optionalTerms
      });
      const matches = directSelections
        ? deferredTools.filter((entry) =>
          directSelections.some((selected) => normalize(selected) === normalize(entry.name))
        )
        : (() => {
          const { requiredTerms, optionalTerms } = parsedTerms;
          const scoringQuery = optionalTerms.length > 0 ? optionalTerms.join(" ") : requiredTerms.join(" ");
          const scoredRows = deferredTools.map((entry) => ({
            entry,
            requiredMatch: entryMatchesRequiredTerms(entry, requiredTerms),
            score: scoreEntry(scoringQuery, entry),
            explanation: explainEntryScore(scoringQuery, entry)
          }));
          momLog("runner", "tool_search_candidates", {
            chatId: options.chatId,
            toolCallId,
            query,
            scoringQuery,
            requiredTerms,
            candidates: scoredRows.map((row) => ({
              name: row.entry.name,
              requiredMatch: row.requiredMatch,
              score: row.score,
              normalizedName: row.explanation.normalizedName,
              searchableText: row.explanation.searchableText,
              reasons: row.explanation.reasons
            }))
          });
          return scoredRows
            .filter((row) => row.requiredMatch)
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
            .slice(0, maxResults)
            .map((row) => row.entry);
        })();

      if (directSelections) {
        momLog("runner", "tool_search_direct_candidates", {
          chatId: options.chatId,
          toolCallId,
          query,
          directSelections,
          candidates: deferredTools.map((entry) => ({
            name: entry.name,
            normalizedName: normalize(entry.name),
            selected: directSelections.some((selected) => normalize(selected) === normalize(entry.name))
          }))
        });
      }

      const loaded = options.loadDeferredTools(matches.map((entry) => entry.name));
      momLog("runner", "tool_search_end", {
        chatId: options.chatId,
        toolCallId,
        query,
        matchedCount: matches.length,
        matches: matches.map((entry) => entry.name),
        loaded
      });

      if (matches.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No deferred tool matched: ${query}\nAvailable deferred tools: ${deferredTools.map((entry) => entry.name).join(", ") || "(none)"}`
          }],
          details: { matches: [], loaded: [] }
        };
      }

      const lines = [
        loaded.length > 0
          ? `Loaded deferred tools: ${loaded.join(", ")}`
          : "Matching deferred tools were already loaded.",
        "The matched tools' complete JSONSchema definitions are below. After this result, call the loaded tool directly if it is needed.",
        "",
        buildFunctionsBlock(matches)
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          matches: matches.map((entry) => ({
            name: entry.name,
            description: entry.description,
            keywords: entry.keywords,
            schema: buildFunctionSchema(entry)
          })),
          loaded
        }
      };
    }
  };
}
