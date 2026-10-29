import type { EmbeddingModelConfig, RuntimeSettings } from "$lib/server/settings/schema.js";

/** Local model servers (Ollama, LM Studio, llama.cpp) usually have no key. */
export function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(String(baseUrl ?? "")).hostname.toLowerCase();
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isLocalEmbeddingModel(model: Pick<EmbeddingModelConfig, "baseUrl">): boolean {
  return isLoopbackUrl(model.baseUrl);
}

function isUsable(model: EmbeddingModelConfig): boolean {
  return model.enabled !== false
    && String(model.baseUrl ?? "").trim().length > 0
    && (String(model.apiKey ?? "").trim().length > 0 || isLocalEmbeddingModel(model));
}

/**
 * The embedding targets the user has configured, in storage order. An entry
 * with no key is still usable on loopback so Ollama / LM Studio work without a
 * fake credential.
 */
export function listEmbeddingModels(settings: RuntimeSettings): EmbeddingModelConfig[] {
  return (settings.plugins.memory.embeddingModels ?? []).filter(isUsable);
}

/**
 * The active target. If the stored active id is stale, fall back to the first
 * usable entry so a deleted active model cannot silently force lexical mode.
 */
export function resolveEmbeddingTarget(settings: RuntimeSettings): EmbeddingModelConfig | null {
  const models = listEmbeddingModels(settings).filter((model) => String(model.model ?? "").trim().length > 0);
  const activeId = String(settings.plugins.memory.activeEmbeddingModelId ?? "").trim();
  return models.find((model) => model.id === activeId) ?? models[0] ?? null;
}

/**
 * Build the embeddings URL from the configured base URL. A base URL may or may
 * not contain a version segment (`/v1`); both forms are accepted.
 */
export function embeddingEndpoint(model: Pick<EmbeddingModelConfig, "baseUrl">): string {
  const base = String(model.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (/\/embeddings$/i.test(base)) return base;
  if (/\/(v\d+(?:beta\d*)?)$/i.test(base)) return `${base}/embeddings`;
  return `${base}/v1/embeddings`;
}
