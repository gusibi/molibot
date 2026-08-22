import fs from "node:fs";
import path from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { ModelCapabilityTag, ModelRole } from "$lib/server/settings/schema.js";

export interface RemoteModelEntry {
  id: string;
  name?: string;
  description?: string;
  family?: string;
  release_date?: string;
  last_updated?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{ type: string; values?: string[] }>;
  interleaved?: { field?: string };
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  limit?: {
    context?: number;
    output?: number;
    input?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

export interface RemoteProviderEntry {
  id?: string;
  name?: string;
  doc?: string;
  env?: string[];
  npm?: string;
  api?: string;
  models?: Record<string, RemoteModelEntry>;
}

export type RemoteModelsRegistry = Record<string, RemoteProviderEntry>;

export interface InferredModelMetadata {
  matched: boolean;
  matchedId?: string;
  alias?: string;
  tags: ModelCapabilityTag[];
  supportedRoles: ModelRole[];
  contextWindow?: number;
  maxTokens?: number;
  thinking?: {
    supported: boolean;
    format?: "thought_tag" | "reasoning_content" | "standard";
    options?: Array<{ type: string; values?: string[] }>;
  };
  reasoning?: boolean;
  toolCall?: boolean;
  vision?: boolean;
  audioInput?: boolean;
  stt?: boolean;
  tts?: boolean;
  raw?: RemoteModelEntry;
}

const DEFAULT_REGISTRY_URL = "https://r2.eztoolab.com/models/models.json?t=2026-08-22";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class ModelRegistryService {
  private static instance: ModelRegistryService | null = null;
  private cacheFilePath: string;
  private memoryCache: Map<string, RemoteModelEntry> = new Map();
  private normalizedIndex: Map<string, RemoteModelEntry> = new Map();
  private loaded = false;
  private lastFetchTime = 0;
  private fetchPromise: Promise<boolean> | null = null;

  constructor(cacheDir?: string) {
    const dir = cacheDir ?? path.resolve(storagePaths.dataDir, "cache");
    this.cacheFilePath = path.resolve(dir, "model_registry.json");
  }

  public static getInstance(): ModelRegistryService {
    if (!ModelRegistryService.instance) {
      ModelRegistryService.instance = new ModelRegistryService();
    }
    return ModelRegistryService.instance;
  }

  /** Normalizes a model ID for fuzzy matching (strips prefixes, dates, version noise). */
  public normalizeModelId(id: string): string {
    if (!id) return "";
    let clean = id.trim().toLowerCase();
    // Strip leading organization/provider prefix e.g. "openai/gpt-4o" -> "gpt-4o"
    if (clean.includes("/")) {
      const parts = clean.split("/");
      clean = parts[parts.length - 1] ?? clean;
    }
    // Replace separators
    clean = clean.replace(/[:_]/g, "-");
    return clean;
  }

  /**
   * Initializes or loads the registry from local disk cache, or triggers a background fetch if empty/stale.
   */
  public async ensureLoaded(forceRefresh = false): Promise<void> {
    if (this.loaded && !forceRefresh && Date.now() - this.lastFetchTime < CACHE_TTL_MS) {
      return;
    }

    if (!forceRefresh && this.loadFromDisk()) {
      // Disk cache loaded. If stale, fetch in background.
      if (Date.now() - this.lastFetchTime >= CACHE_TTL_MS) {
        void this.fetchAndCache(DEFAULT_REGISTRY_URL);
      }
      return;
    }

    await this.fetchAndCache(DEFAULT_REGISTRY_URL);
  }

  private loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(this.cacheFilePath)) return false;
      const stat = fs.statSync(this.cacheFilePath);
      const raw = fs.readFileSync(this.cacheFilePath, "utf8");
      const data = JSON.parse(raw) as RemoteModelsRegistry;
      this.buildIndex(data);
      this.lastFetchTime = stat.mtimeMs;
      this.loaded = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetches latest models.json from remote and persists to disk.
   */
  public async fetchAndCache(url = DEFAULT_REGISTRY_URL): Promise<boolean> {
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = (async () => {
      try {
        const response = await fetch(url, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) return false;
        const data = (await response.json()) as RemoteModelsRegistry;
        this.buildIndex(data);
        this.loaded = true;
        this.lastFetchTime = Date.now();

        try {
          const dir = path.dirname(this.cacheFilePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(this.cacheFilePath, JSON.stringify(data), "utf8");
        } catch {
          // ignore cache write error
        }
        return true;
      } catch {
        return false;
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  /**
   * Ingests a raw models registry object and builds lookup indexes.
   */
  public buildIndex(registry: RemoteModelsRegistry): void {
    this.memoryCache.clear();
    this.normalizedIndex.clear();

    if (!registry || typeof registry !== "object") return;

    for (const [providerKey, providerVal] of Object.entries(registry)) {
      if (!providerVal || typeof providerVal !== "object" || !providerVal.models) continue;
      for (const [modelKey, modelVal] of Object.entries(providerVal.models)) {
        if (!modelVal || typeof modelVal !== "object") continue;
        const entry: RemoteModelEntry = {
          ...modelVal,
          id: modelVal.id || modelKey
        };

        // Exact ID index
        this.memoryCache.set(entry.id.toLowerCase(), entry);
        this.memoryCache.set(modelKey.toLowerCase(), entry);

        // Prefixed key (provider/model)
        this.memoryCache.set(`${providerKey}/${modelKey}`.toLowerCase(), entry);
        if (providerVal.id) {
          this.memoryCache.set(`${providerVal.id}/${modelKey}`.toLowerCase(), entry);
        }

        // Normalized ID index
        const norm = this.normalizeModelId(entry.id);
        if (norm && !this.normalizedIndex.has(norm)) {
          this.normalizedIndex.set(norm, entry);
        }
        const normKey = this.normalizeModelId(modelKey);
        if (normKey && !this.normalizedIndex.has(normKey)) {
          this.normalizedIndex.set(normKey, entry);
        }
      }
    }
  }

  /**
   * Finds a model entry using exact, prefix-stripped, and normalized fuzzy rules.
   */
  public findModel(modelId: string): RemoteModelEntry | null {
    if (!modelId) return null;
    const clean = modelId.trim().toLowerCase();

    // 1. Direct exact match
    if (this.memoryCache.has(clean)) {
      return this.memoryCache.get(clean)!;
    }

    // 2. Normalized match
    const norm = this.normalizeModelId(clean);
    if (this.normalizedIndex.has(norm)) {
      return this.normalizedIndex.get(norm)!;
    }

    // 3. Fallback: match without version date (e.g. gpt-4o-2024-08-06 -> gpt-4o)
    const dateStripped = norm.replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, "");
    if (dateStripped !== norm && this.normalizedIndex.has(dateStripped)) {
      return this.normalizedIndex.get(dateStripped)!;
    }

    // 4. Prefix match: e.g. "deepseek-ai/deepseek-v4-flash" matching "deepseek-v4-flash"
    for (const [key, entry] of this.normalizedIndex.entries()) {
      if (norm.endsWith(key) || key.endsWith(norm)) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Infers full model metadata and capabilities given a model ID.
   */
  public inferModelCapabilities(modelId: string): InferredModelMetadata {
    const matched = this.findModel(modelId);
    if (!matched) {
      return {
        matched: false,
        tags: ["text"],
        supportedRoles: ["system", "user", "assistant", "tool"]
      };
    }

    const inputModalities = matched.modalities?.input ?? [];
    const outputModalities = matched.modalities?.output ?? [];

    const hasVision = Boolean(
      inputModalities.includes("image") ||
      matched.attachment === true
    );

    const hasAudioInput = Boolean(inputModalities.includes("audio"));
    const hasAudioOutput = Boolean(outputModalities.includes("audio"));
    const hasTool = matched.tool_call !== false;
    const hasThinking = Boolean(matched.reasoning === true);

    const tags: ModelCapabilityTag[] = ["text"];
    if (hasVision) tags.push("vision");
    if (hasTool) tags.push("tool");
    if (hasAudioInput) {
      tags.push("audio_input");
      tags.push("stt");
    }
    if (hasAudioOutput) {
      tags.push("tts");
    }

    const roles: ModelRole[] = ["system", "user", "assistant"];
    if (hasTool) roles.push("tool");

    let thinkingFormat: "thought_tag" | "reasoning_content" | "standard" | undefined;
    if (hasThinking) {
      if (matched.interleaved?.field === "reasoning_content") {
        thinkingFormat = "reasoning_content";
      } else {
        thinkingFormat = "thought_tag";
      }
    }

    return {
      matched: true,
      matchedId: matched.id,
      alias: matched.name || undefined,
      tags,
      supportedRoles: roles,
      contextWindow: matched.limit?.context && matched.limit.context > 0 ? matched.limit.context : undefined,
      maxTokens: matched.limit?.output && matched.limit.output > 0 ? matched.limit.output : undefined,
      thinking: hasThinking ? {
        supported: true,
        format: thinkingFormat,
        options: matched.reasoning_options
      } : undefined,
      reasoning: hasThinking,
      toolCall: hasTool,
      vision: hasVision,
      audioInput: hasAudioInput,
      stt: hasAudioInput,
      tts: hasAudioOutput,
      raw: matched
    };
  }
}
