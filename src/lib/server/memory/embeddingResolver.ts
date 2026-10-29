import { createHash } from "node:crypto";
import type { EmbeddingModelConfig, RuntimeSettings } from "$lib/server/settings/schema.js";
import { SESSION_AFFINITY_HEADER } from "$lib/server/providers/sessionAffinity.js";
import {
  embeddingEndpoint,
  isLocalEmbeddingModel,
  listEmbeddingModels,
  resolveEmbeddingTarget
} from "./activeProvider.js";

/**
 * Ordered by how likely a provider exposes it without extra configuration.
 * The probe stops at the first model that returns a vector; a provider we
 * cannot identify stays on lexical retrieval rather than failing every turn.
 */
export const EMBEDDING_PROBE_MODELS = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
  "bge-m3",
  "BAAI/bge-m3",
  "nomic-embed-text",
  "embed-english-v3.0",
  "qwen3-embedding:0.6b",
  "embeddinggemma",
  "text-embedding-nomic-embed-text-v1.5"
];

const PROBE_TIMEOUT_MS = 4_000;
const FAILURE_COOLDOWN_MS = 60 * 60_000;

export interface EmbeddingResolution {
  providerId: string;
  providerName: string;
  model: string;
}

export interface EmbeddingProbeResult {
  ok: boolean;
  providerId: string;
  providerName: string;
  model: string;
  latencyMs: number;
  dimension?: number;
  status?: number;
  error?: string;
}

export interface EmbeddingFailure {
  providerId: string;
  providerName: string;
  model?: string;
  message: string;
  status?: number;
  at: string;
}

export interface EmbeddingResolverDeps {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  onResolved?: (resolution: EmbeddingResolution) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

function modelKey(model: EmbeddingModelConfig): string {
  const digest = model.apiKey
    ? createHash("sha256").update(model.apiKey).digest("hex").slice(0, 12)
    : "local";
  return `${model.id}:${model.baseUrl}:${digest}`;
}

function failure(
  model: EmbeddingModelConfig,
  message: string,
  at: number,
  modelName?: string,
  status?: number
): EmbeddingFailure {
  return {
    providerId: model.id,
    providerName: model.name || model.id,
    model: modelName,
    message,
    status,
    at: new Date(at).toISOString()
  };
}

function resolution(model: EmbeddingModelConfig, modelName: string): EmbeddingResolution {
  return {
    providerId: model.id,
    providerName: model.name || model.id,
    model: modelName
  };
}

/**
 * Resolves the active embedding model. The active entry is used as-is; if it is
 * a local entry whose server is gone, the resolver switches to the first usable
 * remote entry. When no entry is active, it probes configured entries and
 * persists the first model that returns a vector.
 */
export class EmbeddingModelResolver {
  private inFlight: Promise<EmbeddingResolution | null> | null = null;
  private lastResolvedKey = "";
  private readonly failureUntil = new Map<string, number>();
  private lastProbeError: EmbeddingFailure | null = null;

  constructor(private readonly deps: EmbeddingResolverDeps) {}

  /** Current target without probing; used by settings/status surfaces. */
  status(): EmbeddingResolution | null {
    const target = resolveEmbeddingTarget(this.deps.getSettings());
    return target ? resolution(target, target.model) : null;
  }

  /** The most recent failed probe, for the memory UI. */
  lastError(): EmbeddingFailure | null {
    return this.lastProbeError;
  }

  async ensure(force = false): Promise<EmbeddingResolution | null> {
    const settings = this.deps.getSettings();
    const target = resolveEmbeddingTarget(settings);

    if (target && !isLocalEmbeddingModel(target)) {
      this.lastProbeError = null;
      return this.emit(resolution(target, target.model));
    }

    if (target) {
      const probe = await this.request(target, target.model);
      if (probe.ok) {
        this.lastProbeError = null;
        return this.emit(resolution(target, target.model));
      }
      this.lastProbeError = failure(
        target,
        probe.error ?? "Local embedding provider is unavailable.",
        this.now(),
        target.model,
        probe.status
      );
      this.failureUntil.set(modelKey(target), this.now() + FAILURE_COOLDOWN_MS);
      const fallback = listEmbeddingModels(settings).find((model) => (
        model.id !== target.id
        && !isLocalEmbeddingModel(model)
        && String(model.model ?? "").trim().length > 0
      ));
      this.deps.log?.(
        `local embedding unavailable provider=${target.name || target.id} model=${target.model}; falling back to remote`
      );
      this.updateActive(target.id, fallback?.id ?? "");
      if (fallback) return this.emit(resolution(fallback, fallback.model));
      this.lastResolvedKey = "";
      return null;
    }

    if (this.inFlight) return this.inFlight;

    const models = listEmbeddingModels(settings);
    if (models.length === 0) {
      this.lastProbeError = {
        providerId: "none",
        providerName: "No embedding model",
        message: "Add an embedding model in Settings → Memory → Embedding models.",
        at: new Date(this.now()).toISOString()
      };
      return null;
    }

    const run = this.probeModels(models, force);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  /** Probe one configured entry/model without persisting it. */
  async test(embeddingId: string, modelName?: string): Promise<EmbeddingProbeResult> {
    const entry = listEmbeddingModels(this.deps.getSettings()).find((model) => model.id === embeddingId);
    if (!entry) throw new Error("Unknown or ineligible embedding model.");
    return this.testModel(entry, modelName ?? entry.model);
  }

  /** Probe an entry that is not in settings yet (local discovery preset). */
  async testModel(entry: EmbeddingModelConfig, modelName?: string): Promise<EmbeddingProbeResult> {
    const candidate = String(modelName ?? entry.model ?? "").trim();
    if (!candidate) throw new Error("Embedding model is required.");
    const result = await this.request(entry, candidate);
    return {
      ok: result.ok,
      providerId: entry.id,
      providerName: entry.name || entry.id,
      model: candidate,
      latencyMs: result.latencyMs,
      dimension: result.vector?.length,
      status: result.status,
      error: result.error
    };
  }

  private async probeModels(
    models: EmbeddingModelConfig[],
    force: boolean
  ): Promise<EmbeddingResolution | null> {
    let lastFailure: EmbeddingFailure | null = null;
    for (const entry of models) {
      const key = modelKey(entry);
      if (!force && (this.failureUntil.get(key) ?? 0) > this.now()) continue;

      const modelName = await this.probeEntry(entry);
      if (modelName) {
        this.failureUntil.delete(key);
        this.lastProbeError = null;
        this.persistDetected(entry.id, modelName);
        this.deps.log?.(`embedding model detected provider=${entry.name || entry.id} model=${modelName}`);
        return this.emit(resolution(entry, modelName));
      }

      lastFailure = this.lastProbeError;
      this.failureUntil.set(key, this.now() + FAILURE_COOLDOWN_MS);
    }

    this.lastResolvedKey = "";
    this.lastProbeError = lastFailure ?? failure(
      models[0],
      "No configured embedding model returned a vector.",
      this.now()
    );
    this.deps.log?.(
      `embedding probe found no model provider=${this.lastProbeError.providerName}; memory stays lexical`
    );
    return null;
  }

  private async probeEntry(entry: EmbeddingModelConfig): Promise<string | null> {
    const candidates = entry.model
      ? [entry.model, ...EMBEDDING_PROBE_MODELS.filter((name) => name !== entry.model)]
      : EMBEDDING_PROBE_MODELS;
    for (const modelName of candidates) {
      const result = await this.request(entry, modelName);
      if (result.ok) return modelName;
      this.lastProbeError = failure(
        entry,
        result.error ?? "Embedding request failed.",
        this.now(),
        modelName,
        result.status
      );
    }
    return null;
  }

  private persistDetected(embeddingId: string, modelName: string): void {
    const settings = this.deps.getSettings();
    const memory = settings.plugins.memory;
    this.deps.updateSettings({
      plugins: {
        ...settings.plugins,
        memory: {
          ...memory,
          embeddingModels: memory.embeddingModels.map((model) => (
            model.id === embeddingId ? { ...model, model: modelName } : model
          )),
          activeEmbeddingModelId: memory.activeEmbeddingModelId || embeddingId
        }
      }
    });
  }

  private updateActive(previousId: string, nextId: string): void {
    const settings = this.deps.getSettings();
    const memory = settings.plugins.memory;
    if (memory.activeEmbeddingModelId && memory.activeEmbeddingModelId !== previousId) return;
    this.deps.updateSettings({
      plugins: {
        ...settings.plugins,
        memory: { ...memory, activeEmbeddingModelId: nextId }
      }
    });
  }

  private async request(
    entry: EmbeddingModelConfig,
    modelName: string
  ): Promise<{ ok: boolean; vector?: number[]; latencyMs: number; status?: number; error?: string }> {
    const endpoint = embeddingEndpoint(entry);
    if (!endpoint) return { ok: false, latencyMs: 0, error: "Embedding model has no base URL." };
    const doFetch = this.deps.fetchImpl ?? fetch;
    const started = this.now();
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        [SESSION_AFFINITY_HEADER]: "molibot-memory-probe"
      };
      if (entry.apiKey) headers.Authorization = `Bearer ${entry.apiKey}`;
      const response = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: modelName, input: "memory" }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      const latencyMs = this.now() - started;
      const text = await response.text().catch(() => "");
      if (!response.ok) {
        const detail = text.trim().replace(/\s+/g, " ").slice(0, 300);
        return {
          ok: false,
          latencyMs,
          status: response.status,
          error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}`
        };
      }
      let payload: { data?: Array<{ embedding?: unknown }> };
      try {
        payload = JSON.parse(text) as { data?: Array<{ embedding?: unknown }> };
      } catch {
        return { ok: false, latencyMs, status: response.status, error: "Embedding response was not valid JSON." };
      }
      const embedding = payload.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        return {
          ok: false,
          latencyMs,
          status: response.status,
          error: "Embedding response did not contain a vector."
        };
      }
      return { ok: true, vector: embedding.map(Number), latencyMs, status: response.status };
    } catch (error) {
      return {
        ok: false,
        latencyMs: this.now() - started,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private emit(next: EmbeddingResolution): EmbeddingResolution {
    const key = `${next.providerId}:${next.model}`;
    if (key !== this.lastResolvedKey) {
      this.lastResolvedKey = key;
      this.deps.onResolved?.(next);
    }
    return next;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
