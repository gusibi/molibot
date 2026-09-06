import { isAbsolute } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { isCoreSettingsPluginId } from "$lib/server/plugins/coreSettings.js";
import { updatePluginsConfig } from "$lib/server/settings/handlers/plugins.js";
import { buildModelOptions } from "$lib/server/settings/modelSwitch.js";

function relativePath(value: unknown, fallback: string): string {
  const normalized = String(value ?? "").trim() || fallback;
  if (isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) {
    throw new Error("Daily materials paths must stay relative to the selected project");
  }
  return normalized;
}

export const GET: RequestHandler = ({ params }) => {
  if (!isCoreSettingsPluginId(params.pluginId)) {
    return json({ ok: false, error: "Unknown built-in plugin" }, { status: 404 });
  }
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  if (params.pluginId === "memory") {
    return json({
      ok: true,
      values: {
        enabled: settings.plugins.memory.enabled,
        backend: settings.plugins.memory.backend,
        embeddingProviderId: settings.plugins.memory.embeddingProviderId,
        embeddingModel: settings.plugins.memory.embeddingModel,
        reflectionTime: settings.plugins.memory.reflectionTime,
        reflectionNotifications: settings.plugins.memory.reflectionNotifications
      },
      backends: runtime.pluginCatalog.memoryBackends.map((item) => ({ value: item.key, label: item.name })),
      embeddingProviders: (settings?.customProviders ?? []).filter((provider) => provider.enabled).map((provider) => ({ value: provider.id, label: provider.name || provider.id }))
    });
  }
  return json({
    ok: true,
    values: settings.plugins.memory.dailyMaterials,
    projects: getProjectStore().list().map((project) => ({ value: project.id, label: project.name || project.id })),
    models: buildModelOptions(settings, "text").map((model) => ({ value: model.key, label: model.label }))
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!isCoreSettingsPluginId(params.pluginId)) {
    return json({ ok: false, error: "Unknown built-in plugin" }, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const settings = runtime.getSettings();
  try {
    if (params.pluginId === "memory") {
      const backend = String(body.backend ?? settings.plugins.memory.backend).trim();
      if (!runtime.pluginCatalog.memoryBackends.some((item) => item.key === backend)) {
        throw new Error("Unknown memory backend");
      }
      const reflectionTime = String(body.reflectionTime ?? settings.plugins.memory.reflectionTime);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reflectionTime)) throw new Error("Invalid reflection time");
      const plugins = updatePluginsConfig(runtime, {
        memory: {
          enabled: body.enabled === undefined ? settings.plugins.memory.enabled : Boolean(body.enabled),
          backend,
          embeddingProviderId: body.embeddingProviderId === undefined
            ? settings.plugins.memory.embeddingProviderId
            : String(body.embeddingProviderId ?? "").trim(),
          embeddingModel: body.embeddingModel === undefined
            ? settings.plugins.memory.embeddingModel
            : String(body.embeddingModel ?? "").trim(),
          reflectionTime,
          reflectionNotifications: body.reflectionNotifications === undefined
            ? settings.plugins.memory.reflectionNotifications
            : Boolean(body.reflectionNotifications)
        }
      });
      return json({ ok: true, values: plugins.memory });
    }

    const current = settings.plugins.memory.dailyMaterials;
    const time = String(body.time ?? current.time);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid daily review time");
    const projectId = String(body.projectId ?? current.projectId).trim();
    if (projectId && !getProjectStore().get(projectId)) throw new Error("Unknown project");
    const scanModelKey = String(body.scanModelKey ?? current.scanModelKey).trim();
    if (scanModelKey && !buildModelOptions(settings, "text").some((model) => model.key === scanModelKey)) {
      throw new Error("Unknown scan model");
    }
    const rawBudget = Number(body.scanTokenBudget ?? current.scanTokenBudget);
    if (!Number.isFinite(rawBudget)) throw new Error("Invalid scan token budget");
    const plugins = updatePluginsConfig(runtime, {
      memory: {
        dailyMaterials: {
          enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
          time,
          projectId,
          dir: relativePath(body.dir, current.dir),
          promptPath: relativePath(body.promptPath, current.promptPath),
          notifications: body.notifications === undefined ? current.notifications : Boolean(body.notifications),
          scanTokenBudget: Math.min(900000, Math.max(8000, Math.round(rawBudget))),
          scanModelKey
        }
      }
    });
    return json({ ok: true, values: plugins.memory.dailyMaterials });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
