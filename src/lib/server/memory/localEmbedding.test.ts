import assert from "node:assert/strict";
import test from "node:test";
import {
  detectLocalEmbeddingServices,
  isLocalEmbeddingProvider,
  localEmbeddingProvider
} from "./localEmbedding.js";

test("detects Ollama and LM Studio embedding models without chat models", async () => {
  const services = await detectLocalEmbeddingServices({
    fetchImpl: (async (url) => {
      const target = String(url);
      if (target.endsWith("/api/tags")) {
        return new Response(JSON.stringify({
          models: [
            { name: "llama3.2:latest" },
            { name: "bge-m3:latest" },
            { name: "qwen3-embedding:0.6b" }
          ]
        }), { status: 200 });
      }
      if (target.endsWith("/v1/models")) {
        return new Response(JSON.stringify({
          data: [
            { id: "text-embedding-nomic-embed-text-v1.5" },
            { id: "some-chat-model" }
          ]
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch
  });

  assert.deepEqual(services.map((service) => service.id), ["ollama", "lmstudio"]);
  assert.deepEqual(services[0]?.models, ["bge-m3:latest", "qwen3-embedding:0.6b"]);
  assert.equal(services[0]?.recommended, "bge-m3:latest");
  assert.deepEqual(services[1]?.models, ["text-embedding-nomic-embed-text-v1.5"]);
});

test("an offline or chat-only local server is not reported as available", async () => {
  const services = await detectLocalEmbeddingServices({
    fetchImpl: (async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }), { status: 200 });
      }
      throw new Error("connection refused");
    }) as typeof fetch
  });
  assert.deepEqual(services, []);
});

test("the local preset is an embedding-only loopback provider", () => {
  const service = {
    id: "ollama" as const,
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    models: ["bge-m3:latest"],
    recommended: "bge-m3:latest"
  };
  const provider = localEmbeddingProvider(service, "bge-m3:latest");
  assert.equal(provider.id, "local-ollama-bge-m3-latest");
  assert.equal(provider.name, "Ollama (local)");
  assert.equal(provider.baseUrl, "http://127.0.0.1:11434");
  assert.equal(provider.apiKey, "");
  assert.equal(provider.model, "bge-m3:latest");
  assert.equal(isLocalEmbeddingProvider(provider), true);
  assert.equal(isLocalEmbeddingProvider({ baseUrl: "https://api.example.com" }), false);

  const qwen = localEmbeddingProvider(service, "qwen3-embedding:0.6b");
  assert.notEqual(qwen.id, provider.id);
  assert.equal(qwen.name, "Ollama (local)");
  assert.equal(qwen.model, "qwen3-embedding:0.6b");
});
