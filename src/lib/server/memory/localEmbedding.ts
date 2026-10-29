import type { EmbeddingModelConfig } from "$lib/server/settings/schema.js";

export { isLocalEmbeddingModel as isLocalEmbeddingProvider } from "./activeProvider.js";

export type LocalEmbeddingServiceId = "ollama" | "lmstudio";

export interface LocalEmbeddingService {
  id: LocalEmbeddingServiceId;
  name: string;
  baseUrl: string;
  models: string[];
  recommended?: string;
}

const EMBEDDING_MODEL_PATTERN = /(embed|bge|e5|gte|nomic|arctic|minilm|qwen3-embedding)/i;
const RECOMMENDED_MODELS = [
  "bge-m3",
  "bge-m3:latest",
  "BAAI/bge-m3",
  "qwen3-embedding:0.6b",
  "embeddinggemma",
  "embeddinggemma:latest",
  "text-embedding-nomic-embed-text-v1.5",
  "nomic-embed-text"
];
const DETECT_TIMEOUT_MS = 1_500;

function localBaseUrl(envName: string, fallback: string): string {
  return String(process.env[envName] ?? "").trim() || fallback;
}

function rootBaseUrl(value: string): string {
  return value.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function embeddingModels(values: string[]): string[] {
  const filtered = unique(values).filter((value) => EMBEDDING_MODEL_PATTERN.test(value));
  return filtered.sort((left, right) => {
    const leftRank = RECOMMENDED_MODELS.indexOf(left);
    const rightRank = RECOMMENDED_MODELS.indexOf(right);
    if (leftRank !== -1 || rightRank !== -1) {
      return (leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank)
        - (rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank);
    }
    return left.localeCompare(right);
  });
}

async function fetchJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(DETECT_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Detect local embedding servers without assuming they are installed. Only
 * loopback endpoints are probed; a remote URL must be configured explicitly as
 * a provider instead.
 */
export async function detectLocalEmbeddingServices(options?: {
  fetchImpl?: typeof fetch;
}): Promise<LocalEmbeddingService[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const ollamaBase = rootBaseUrl(
    localBaseUrl("MOLIBOT_OLLAMA_BASE_URL", "http://127.0.0.1:11434")
  );
  const lmStudioBase = rootBaseUrl(
    localBaseUrl("MOLIBOT_LMSTUDIO_BASE_URL", "http://127.0.0.1:1234")
  );
  const services = [
    {
      id: "ollama" as const,
      name: "Ollama",
      baseUrl: ollamaBase,
      listUrl: `${ollamaBase}/api/tags`,
      headers: {} as Record<string, string>,
      extract: (payload: unknown) => {
        const rows = (payload as { models?: Array<{ name?: string }> }).models ?? [];
        return rows.map((row) => String(row.name ?? ""));
      }
    },
    {
      id: "lmstudio" as const,
      name: "LM Studio",
      baseUrl: lmStudioBase,
      listUrl: `${lmStudioBase}/v1/models`,
      headers: { Authorization: "Bearer lm-studio" },
      extract: (payload: unknown) => {
        const rows = (payload as { data?: Array<{ id?: string }> }).data ?? [];
        return rows.map((row) => String(row.id ?? ""));
      }
    }
  ];

  const detected: Array<LocalEmbeddingService | null> = await Promise.all(services.map(async (service) => {
    try {
      const payload = await fetchJson(service.listUrl, service.headers, fetchImpl);
      const models = embeddingModels(service.extract(payload));
      if (models.length === 0) return null;
      return {
        id: service.id,
        name: service.name,
        baseUrl: service.baseUrl,
        models,
        recommended: models[0]
      } satisfies LocalEmbeddingService;
    } catch {
      return null;
    }
  }));

  return detected.filter((service): service is LocalEmbeddingService => service !== null);
}

export function localEmbeddingProvider(
  service: LocalEmbeddingService,
  model: string
): EmbeddingModelConfig {
  const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return {
    id: `local-${service.id}${slug ? `-${slug}` : ""}`,
    name: `${service.name} (local)`,
    enabled: true,
    baseUrl: service.baseUrl.replace(/\/+$/, ""),
    // LM Studio documents a placeholder key; Ollama ignores missing auth.
    apiKey: service.id === "lmstudio" ? "lm-studio" : "",
    model
  };
}
