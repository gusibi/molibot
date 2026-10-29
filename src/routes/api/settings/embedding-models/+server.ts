import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getRuntime } from "$lib/server/app/runtime.js";
import type { EmbeddingModelConfig } from "$lib/server/settings/schema.js";
import { sanitizeEmbeddingModels } from "$lib/server/settings/sanitize.js";
import { EMBEDDING_PROBE_MODELS } from "$lib/server/memory/embeddingResolver.js";
import {
  detectLocalEmbeddingServices,
  localEmbeddingProvider
} from "$lib/server/memory/localEmbedding.js";

function memoryItems(runtime: ReturnType<typeof getRuntime>) {
  const memory = runtime.getSettings().plugins.memory;
  return {
    items: memory.embeddingModels ?? [],
    activeId: memory.activeEmbeddingModelId ?? "",
    status: runtime.embeddingResolver.status(),
    error: runtime.embeddingResolver.lastError()
  };
}

function saveItems(
  runtime: ReturnType<typeof getRuntime>,
  items: EmbeddingModelConfig[],
  activeId: string
) {
  const settings = runtime.getSettings();
  return runtime.updateSettings({
    plugins: {
      ...settings.plugins,
      memory: {
        ...settings.plugins.memory,
        embeddingModels: items,
        activeEmbeddingModelId: activeId
      }
    }
  });
}

function candidateFromBody(body: Record<string, unknown>): EmbeddingModelConfig | null {
  const [item] = sanitizeEmbeddingModels([{
    id: String(body.id ?? "").trim() || `embedding-${Math.random().toString(36).slice(2, 10)}`,
    name: body.name,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    model: body.model
  }], []);
  return item ?? null;
}

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  return json({
    ok: true,
    ...memoryItems(runtime),
    local: await detectLocalEmbeddingServices(),
    suggestions: EMBEDDING_PROBE_MODELS
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const memory = settings.plugins.memory;
  const candidate = candidateFromBody(body);
  if (!candidate) {
    return json({ ok: false, error: "A name, HTTP(S) base URL and model are required." }, { status: 400 });
  }

  const currentItems = memory.embeddingModels ?? [];
  const items = currentItems.some((item) => item.id === candidate.id)
    ? currentItems.map((item) => (item.id === candidate.id ? candidate : item))
    : [...currentItems, candidate];
  const activeId = memory.activeEmbeddingModelId || (candidate.enabled ? candidate.id : "");
  saveItems(runtime, items, activeId);
  await runtime.embeddingResolver.ensure();
  return json({ ok: true, ...memoryItems(runtime) });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
  const runtime = getRuntime();
  const memory = runtime.getSettings().plugins.memory;
  if (!(memory.embeddingModels ?? []).some((item) => item.id === id)) {
    return json({ ok: false, error: "Embedding model not found" }, { status: 404 });
  }
  const items = (memory.embeddingModels ?? []).filter((item) => item.id !== id);
  const activeId = memory.activeEmbeddingModelId === id
    ? (items.find((item) => item.enabled)?.id ?? "")
    : memory.activeEmbeddingModelId;
  saveItems(runtime, items, activeId);
  await runtime.embeddingResolver.ensure();
  return json({ ok: true, ...memoryItems(runtime) });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const runtime = getRuntime();
  const action = String(body.action ?? "").trim();

  if (action === "activate") {
    const id = String(body.id ?? "").trim();
    const memory = runtime.getSettings().plugins.memory;
    const target = (memory.embeddingModels ?? []).find((item) => item.id === id);
    if (!target || !target.enabled || !target.model.trim()) {
      return json({ ok: false, error: "Embedding model not found, disabled, or missing a model name." }, { status: 400 });
    }
    saveItems(runtime, memory.embeddingModels ?? [], id);
    await runtime.embeddingResolver.ensure();
    return json({ ok: true, ...memoryItems(runtime) });
  }

  if (action === "test") {
    const id = String(body.id ?? "").trim();
    // The editor sends unsaved host/key/model values; prefer them over the
    // persisted row so "Test connection" never tests stale credentials.
    const inline = body.baseUrl ? candidateFromBody(body) : null;
    const entry = inline ?? (id
      ? (runtime.getSettings().plugins.memory.embeddingModels ?? []).find((item) => item.id === id)
      : null);
    if (!entry) return json({ ok: false, error: "Embedding model not found." }, { status: 400 });
    try {
      const probe = await runtime.embeddingResolver.testModel(entry, String(body.model ?? entry.model));
      return json(
        { ok: probe.ok, probe, error: probe.ok ? undefined : probe.error },
        { status: probe.ok ? 200 : 400 }
      );
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  if (action === "use-local") {
    const serviceId = String(body.serviceId ?? "").trim();
    const model = String(body.model ?? "").trim();
    const services = await detectLocalEmbeddingServices();
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      return json({ ok: false, error: "Local embedding service was not detected." }, { status: 400 });
    }
    if (!model || !service.models.includes(model)) {
      return json({ ok: false, error: "Choose a model reported by the local service." }, { status: 400 });
    }
    const entry = localEmbeddingProvider(service, model);
    const probe = await runtime.embeddingResolver.testModel(entry, model);
    if (!probe.ok) {
      return json({ ok: false, error: probe.error || "Local embedding test failed.", probe }, { status: 400 });
    }
    const memory = runtime.getSettings().plugins.memory;
    const items = [...(memory.embeddingModels ?? []).filter((item) => item.id !== entry.id), entry];
    saveItems(runtime, items, entry.id);
    await runtime.embeddingResolver.ensure();
    return json({ ok: true, ...memoryItems(runtime), local: services });
  }

  if (action === "backfill") {
    if (!runtime.getSettings().plugins.memory.enabled) {
      return json({ ok: false, error: "Memory is disabled." }, { status: 400 });
    }
    if (!runtime.embeddingResolver.status()) {
      return json({ ok: false, error: "Activate an embedding model before reindexing." }, { status: 400 });
    }
    const limit = Math.max(1, Math.min(500, Number(body.limit ?? 100) || 100));
    try {
      return json({ ok: true, result: await runtime.memory.backfillEmbeddings(limit) });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  return json({ ok: false, error: "Unsupported embedding action." }, { status: 400 });
};
