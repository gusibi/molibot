import assert from "node:assert/strict";
import test from "node:test";
import type { EmbeddingModelConfig, RuntimeSettings } from "$lib/server/settings/schema.js";
import {
  embeddingEndpoint,
  isLocalEmbeddingModel,
  listEmbeddingModels,
  resolveEmbeddingTarget
} from "./activeProvider.js";

function embedding(patch: Partial<EmbeddingModelConfig> = {}): EmbeddingModelConfig {
  return {
    id: "embedding-a",
    name: "Embedding A",
    enabled: true,
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "text-embedding-3-small",
    ...patch
  };
}

function settings(models: EmbeddingModelConfig[], activeId = models[0]?.id ?? ""): RuntimeSettings {
  return {
    plugins: {
      memory: {
        enabled: true,
        backend: "mory",
        embeddingModels: models,
        activeEmbeddingModelId: activeId
      }
    }
  } as unknown as RuntimeSettings;
}

test("embedding endpoint accepts base URLs with and without a version segment", () => {
  assert.equal(
    embeddingEndpoint({ baseUrl: "https://api.siliconflow.cn" }),
    "https://api.siliconflow.cn/v1/embeddings"
  );
  assert.equal(
    embeddingEndpoint({ baseUrl: "https://api.siliconflow.cn/v1" }),
    "https://api.siliconflow.cn/v1/embeddings"
  );
  assert.equal(
    embeddingEndpoint({ baseUrl: "https://openrouter.ai/api" }),
    "https://openrouter.ai/api/v1/embeddings"
  );
  assert.equal(
    embeddingEndpoint({ baseUrl: "http://127.0.0.1:11434" }),
    "http://127.0.0.1:11434/v1/embeddings"
  );
  assert.equal(
    embeddingEndpoint({ baseUrl: "https://api.example.com/v1/embeddings" }),
    "https://api.example.com/v1/embeddings"
  );
});

test("the active embedding entry is used directly", () => {
  const a = embedding({ id: "a", model: "model-a" });
  const b = embedding({ id: "b", model: "model-b" });
  assert.equal(resolveEmbeddingTarget(settings([a, b], "b"))?.id, "b");
});

test("a stale active id falls back to the first usable entry", () => {
  const a = embedding({ id: "a" });
  const b = embedding({ id: "b", enabled: false });
  assert.equal(resolveEmbeddingTarget(settings([a, b], "missing"))?.id, "a");
  assert.deepEqual(listEmbeddingModels(settings([a, b])).map((item) => item.id), ["a"]);
});

test("loopback entries may omit an API key, remote entries may not", () => {
  const local = embedding({
    id: "local-ollama",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: "",
    model: "bge-m3:latest"
  });
  const remote = embedding({
    id: "remote",
    baseUrl: "https://api.example.com",
    apiKey: ""
  });
  assert.deepEqual(listEmbeddingModels(settings([local, remote])).map((item) => item.id), ["local-ollama"]);
  assert.equal(isLocalEmbeddingModel(local), true);
  assert.equal(isLocalEmbeddingModel(remote), false);
});
