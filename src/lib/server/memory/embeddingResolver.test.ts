import test from "node:test";
import assert from "node:assert/strict";
import { EmbeddingModelResolver } from "./embeddingResolver.js";
import type { EmbeddingModelConfig, RuntimeSettings } from "$lib/server/settings/schema.js";

function embedding(patch: Partial<EmbeddingModelConfig> = {}): EmbeddingModelConfig {
  return {
    id: "embedding-a",
    name: "Embedding A",
    enabled: true,
    baseUrl: "https://example.invalid/v1",
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

function memoryOf(current: RuntimeSettings) {
  return current.plugins.memory;
}

test("an active remote embedding is used without probing", async () => {
  let fetches = 0;
  let current = settings([embedding()]);
  const resolutions: string[] = [];
  const resolver = new EmbeddingModelResolver({
    getSettings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch } as RuntimeSettings;
      return current;
    },
    onResolved: (item) => resolutions.push(`${item.providerId}:${item.model}`),
    fetchImpl: (async () => { fetches += 1; throw new Error("should not fetch"); }) as typeof fetch
  });

  const result = await resolver.ensure();
  assert.equal(result?.model, "text-embedding-3-small");
  assert.equal(fetches, 0);
  assert.deepEqual(resolutions, ["embedding-a:text-embedding-3-small"]);
  assert.equal(resolver.status()?.model, "text-embedding-3-small");
});

test("an active local embedding is health-checked and used when reachable", async () => {
  let current = settings([embedding({
    id: "local-ollama",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: "",
    model: "bge-m3:latest"
  })]);
  let seenAuth: string | null = "unset";
  const resolver = new EmbeddingModelResolver({
    getSettings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch } as RuntimeSettings;
      return current;
    },
    fetchImpl: (async (_url, init) => {
      seenAuth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 });
    }) as typeof fetch
  });

  const result = await resolver.ensure();
  assert.equal(result?.providerId, "local-ollama");
  assert.equal(result?.model, "bge-m3:latest");
  assert.equal(seenAuth, null);
});

test("an unavailable local active embedding falls back to a remote entry", async () => {
  const local = embedding({
    id: "local-ollama",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: "",
    model: "bge-m3:latest"
  });
  const remote = embedding({ id: "remote", model: "remote-model" });
  let current = settings([local, remote], "local-ollama");
  const resolver = new EmbeddingModelResolver({
    getSettings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch } as RuntimeSettings;
      return current;
    },
    fetchImpl: (async () => new Response("local down", { status: 502 })) as typeof fetch
  });

  const result = await resolver.ensure();
  assert.equal(result?.providerId, "remote");
  assert.equal(memoryOf(current).activeEmbeddingModelId, "remote");
  assert.equal(memoryOf(current).embeddingModels.find((item) => item.id === "local-ollama")?.model, "bge-m3:latest");
});

test("when no entry is active the resolver probes, persists the model and activates it", async () => {
  let current = settings([embedding({ model: "" })], "");
  const updates: string[] = [];
  const requested: string[] = [];
  const resolver = new EmbeddingModelResolver({
    getSettings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch } as RuntimeSettings;
      updates.push(memoryOf(current).activeEmbeddingModelId);
      return current;
    },
    fetchImpl: (async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model as string;
      requested.push(model);
      if (model === "bge-m3") {
        return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 });
      }
      return new Response("unsupported", { status: 404 });
    }) as typeof fetch
  });

  const result = await resolver.ensure();
  assert.equal(result?.model, "bge-m3");
  assert.ok(requested.includes("text-embedding-3-small"));
  assert.ok(requested.includes("bge-m3"));
  assert.equal(memoryOf(current).embeddingModels[0]?.model, "bge-m3");
  assert.equal(memoryOf(current).activeEmbeddingModelId, "embedding-a");
  assert.ok(updates.includes("embedding-a"));
});

test("a failed probe is cached per entry instead of hammering the endpoint", async () => {
  let current = settings([embedding({ model: "" })], "");
  let now = 1_000_000;
  let fetches = 0;
  const resolver = new EmbeddingModelResolver({
    getSettings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch } as RuntimeSettings;
      return current;
    },
    now: () => now,
    fetchImpl: (async () => {
      fetches += 1;
      return new Response("no", { status: 404 });
    }) as typeof fetch
  });

  assert.equal(await resolver.ensure(), null);
  const firstFetches = fetches;
  assert.ok(firstFetches > 0);
  assert.equal(await resolver.ensure(), null);
  assert.equal(fetches, firstFetches);

  now += 61 * 60_000;
  assert.equal(await resolver.ensure(), null);
  assert.ok(fetches > firstFetches);
});

test("testModel probes an unsaved local entry without persisting it", async () => {
  let current = settings([]);
  let seenAuth: string | null = "unset";
  const resolver = new EmbeddingModelResolver({
    getSettings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch } as RuntimeSettings;
      return current;
    },
    fetchImpl: (async (_url, init) => {
      seenAuth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 });
    }) as typeof fetch
  });

  const result = await resolver.testModel(embedding({
    id: "local-ollama",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: "",
    model: "bge-m3"
  }));
  assert.equal(result.ok, true);
  assert.equal(result.dimension, 3);
  assert.equal(seenAuth, null);
  assert.equal(memoryOf(current).embeddingModels.length, 0);
});
