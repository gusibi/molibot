import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { listBuiltInSubagents, resolveSubagentModelRoute } from "$lib/server/agent/tools/subagent";
import { buildModelOptions } from "$lib/server/settings/modelSwitch";

function routeKey(route: ReturnType<typeof resolveSubagentModelRoute>): string {
  if (!route) return "";
  return `${route.mode}|${route.provider}|${route.model}`;
}

function fallbackRouteLabel(key: string): string {
  const [mode, provider, ...rest] = key.split("|");
  const model = rest.join("|");
  if (!mode || !provider || !model) return key;
  return `${mode === "custom" ? "[Custom]" : "[PI]"} ${provider} / ${model}`;
}

export const GET: RequestHandler = async () => {
  const settings = getRuntime().getSettings();
  const configuredKey = String(settings.modelRouting.subagentModelKey ?? "").trim();
  const levelKeys = {
    haiku: String(settings.modelRouting.subagentHaikuModelKey ?? "").trim(),
    sonnet: String(settings.modelRouting.subagentSonnetModelKey ?? "").trim(),
    opus: String(settings.modelRouting.subagentOpusModelKey ?? "").trim(),
    thinking: String(settings.modelRouting.subagentThinkingModelKey ?? "").trim()
  };
  const optionLabels = new Map(
    buildModelOptions(settings, "subagent").map((option) => [option.key, option.label])
  );
  const labelForKey = (key: string): string => optionLabels.get(key) ?? fallbackRouteLabel(key);
  const subagents = listBuiltInSubagents().map((subagent) => {
    // Roles that require independence can be routed away from their configured
    // level, so the displayed model must come from the same resolver the run
    // uses — otherwise Settings advertises a model the reviewer never runs on.
    const activeKey = routeKey(resolveSubagentModelRoute(settings, subagent.modelHint, {
      independentReview: subagent.independentReview
    }));
    const levelKey = routeKey(resolveSubagentModelRoute(settings, subagent.modelHint));
    const movedForIndependence = Boolean(subagent.independentReview) && activeKey !== levelKey;
    return {
      ...subagent,
      activeModelKey: activeKey,
      activeModelLabel: activeKey ? labelForKey(activeKey) : "",
      activeModelSource: movedForIndependence
        ? "independent review"
        : subagent.modelLevel && levelKeys[subagent.modelLevel]
          ? `${subagent.modelLevel} level`
          : configuredKey
            ? "subagent fallback route"
            : "text fallback"
    };
  });

  return json({
    ok: true,
    subagents,
    configuredModelKey: configuredKey,
    configuredModelLabel: configuredKey ? labelForKey(configuredKey) : "",
    modelLevels: Object.fromEntries(
      Object.entries(levelKeys).map(([level, key]) => [
        level,
        {
          key,
          label: key ? labelForKey(key) : ""
        }
      ])
    )
  });
};
