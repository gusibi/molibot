import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model
} from "@earendil-works/pi-ai";
import type { RuntimeThinkingLevel } from "$lib/server/settings/thinking.js";

export const DEFAULT_THINKING_LEVEL_MAP = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
} as const satisfies NonNullable<Model<any>["thinkingLevelMap"]>;

export function withDefaultThinkingLevels(model: Model<any>): Model<any> {
  if (Object.keys(model.thinkingLevelMap ?? {}).length > 0) return model;
  return { ...model, reasoning: true, thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP };
}

/**
 * Keep Molibot's visible/effective levels on pi's capability/clamping path.
 * An explicit model map is authoritative; otherwise all seven canonical levels
 * are available, without a model-id table.
 */
export function getModelThinkingLevels(model: Model<any>): RuntimeThinkingLevel[] {
  const levels = getSupportedThinkingLevels(withDefaultThinkingLevels(model)) as RuntimeThinkingLevel[];
  return levels.length > 0 ? levels : ["off"];
}

export function resolveModelThinkingLevel(
  model: Model<any>,
  requested: RuntimeThinkingLevel
): RuntimeThinkingLevel {
  return clampThinkingLevel(withDefaultThinkingLevels(model), requested) as RuntimeThinkingLevel;
}
