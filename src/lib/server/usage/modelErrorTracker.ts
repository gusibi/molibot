import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { storagePaths } from "../infra/db/storage.js";

export type ModelErrorKind = "request_error" | "empty_response" | "missing_api_key";

export interface ModelErrorRecord {
  ts: string;
  source: "runner" | "assistant";
  channel: string;
  botId: string;
  chatId: string;
  sessionId?: string;
  runId?: string;
  provider: string;
  model: string;
  api?: string;
  route: "text" | "vision" | "stt" | "tts";
  kind: ModelErrorKind;
  message: string;
  baseUrl?: string;
  endpointUrl?: string;
  candidateIndex?: number;
  recovered: boolean;
  fallbackUsed: boolean;
  finalProvider?: string;
  finalModel?: string;
}

export interface ModelErrorSummary {
  total: number;
  recovered: number;
  unrecovered: number;
  byKind: Array<{ kind: ModelErrorKind; count: number }>;
  byProvider: Array<{ provider: string; count: number }>;
}

function trimMessage(message: string): string {
  const normalized = String(message ?? "").trim();
  if (!normalized) return "(empty)";
  return normalized.length > 800 ? `${normalized.slice(0, 800)}...` : normalized;
}

function summarize(records: ModelErrorRecord[]): ModelErrorSummary {
  const kindMap = new Map<ModelErrorKind, number>();
  const providerMap = new Map<string, number>();
  let recovered = 0;

  for (const record of records) {
    if (record.recovered) recovered += 1;
    kindMap.set(record.kind, Number(kindMap.get(record.kind) ?? 0) + 1);
    providerMap.set(record.provider, Number(providerMap.get(record.provider) ?? 0) + 1);
  }

  return {
    total: records.length,
    recovered,
    unrecovered: Math.max(0, records.length - recovered),
    byKind: Array.from(kindMap.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    byProvider: Array.from(providerMap.entries())
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider))
  };
}

export class ModelErrorTracker {
  private readonly logsDir: string;
  private readonly logsFile: string;
  private readonly appendText: (text: string) => void;
  private readonly readText: () => string;
  private readonly ensureDir: () => void;

  constructor(options?: {
    logsFile?: string;
    appendText?: (text: string) => void;
    readText?: () => string;
    ensureDir?: () => void;
  }) {
    this.logsFile = options?.logsFile ?? path.join(storagePaths.dataDir, "logs", "model-errors.jsonl");
    this.logsDir = path.dirname(this.logsFile);
    this.appendText = options?.appendText ?? ((text) => appendFileSync(this.logsFile, text, "utf8"));
    this.readText = options?.readText ?? (() => (existsSync(this.logsFile) ? readFileSync(this.logsFile, "utf8") : ""));
    this.ensureDir = options?.ensureDir ?? (() => mkdirSync(this.logsDir, { recursive: true }));
  }

  record(input: Omit<ModelErrorRecord, "ts" | "message"> & { message: string }): void {
    this.ensureDir();
    const record: ModelErrorRecord = {
      ...input,
      ts: new Date().toISOString(),
      message: trimMessage(input.message)
    };
    this.appendText(`${JSON.stringify(record)}\n`);
  }

  getRecent(limit = 200): { items: ModelErrorRecord[]; summary: ModelErrorSummary } {
    const raw = this.readText();
    if (!raw.trim()) {
      return { items: [], summary: summarize([]) };
    }
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const items: ModelErrorRecord[] = [];

    for (let index = lines.length - 1; index >= 0 && items.length < limit; index -= 1) {
      const line = lines[index];
      try {
        const parsed = JSON.parse(line) as Partial<ModelErrorRecord>;
        if (!parsed || typeof parsed !== "object") continue;
        items.push({
          ts: String(parsed.ts ?? ""),
          source: parsed.source === "assistant" ? "assistant" : "runner",
          channel: String(parsed.channel ?? "unknown"),
          botId: String(parsed.botId ?? "unknown"),
          chatId: String(parsed.chatId ?? "unknown"),
          sessionId: parsed.sessionId ? String(parsed.sessionId) : undefined,
          runId: parsed.runId ? String(parsed.runId) : undefined,
          provider: String(parsed.provider ?? "unknown"),
          model: String(parsed.model ?? "unknown"),
          api: parsed.api ? String(parsed.api) : undefined,
          route: parsed.route === "vision" || parsed.route === "stt" || parsed.route === "tts" ? parsed.route : "text",
          kind: parsed.kind === "empty_response" || parsed.kind === "missing_api_key" ? parsed.kind : "request_error",
          message: trimMessage(String(parsed.message ?? "")),
          baseUrl: parsed.baseUrl ? String(parsed.baseUrl) : undefined,
          endpointUrl: parsed.endpointUrl ? String(parsed.endpointUrl) : undefined,
          candidateIndex: Number.isFinite(parsed.candidateIndex) ? Number(parsed.candidateIndex) : undefined,
          recovered: Boolean(parsed.recovered),
          fallbackUsed: Boolean(parsed.fallbackUsed),
          finalProvider: parsed.finalProvider ? String(parsed.finalProvider) : undefined,
          finalModel: parsed.finalModel ? String(parsed.finalModel) : undefined
        });
      } catch {
        continue;
      }
    }

    return { items, summary: summarize(items) };
  }
}
