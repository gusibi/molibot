import {
  EMPTY_PI_EXTENSION_MODELS,
  EMPTY_PI_EXTENSION_SESSION,
  type PiExtensionModelCatalog,
  type PiExtensionRuntimeSnapshot,
  type PiExtensionSessionSnapshot
} from "$lib/server/plugins/piExtensions/types.js";

/**
 * Real state of the run invoking a pi extension. The builder turns it into the
 * serializable snapshot the worker's `ExtensionContext` reads from.
 */
export interface PiExtensionRuntimeSource {
  cwd: string;
  systemPrompt?: string;
  sessionId?: string;
  /** A pi-ai `Model`; only its serializable, credential-free fields are kept. */
  model?: unknown;
  thinkingLevel?: string;
  scopedModels?: ReadonlyArray<{ model: unknown; thinkingLevel?: string }>;
  /** Whether the agent is idle. Extension calls run mid-turn, so this is usually false. */
  isIdle: boolean;
  pendingMessages?: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent?: number | null };
  /** Model discovery snapshot; omitted means "no models configured". */
  models?: PiExtensionModelCatalog;
  /** Read-only session view; omitted means "no session open". */
  session?: PiExtensionSessionSnapshot;
}

/** Drop headers (they can carry auth) and detach from the live object. */
function serializeModel(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { headers: _headers, ...rest } = value as Record<string, unknown>;
  try {
    return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function percentOf(usage: PiExtensionRuntimeSource["contextUsage"]): number | null {
  if (!usage) return null;
  if (usage.percent !== undefined) return usage.percent;
  if (usage.tokens === null) return null;
  return usage.contextWindow > 0 ? (usage.tokens / usage.contextWindow) * 100 : null;
}

export function buildPiExtensionRuntimeSnapshot(source: PiExtensionRuntimeSource): PiExtensionRuntimeSnapshot {
  const model = serializeModel(source.model);
  const scopedModels = (source.scopedModels ?? []).flatMap((entry) => {
    const serialized = serializeModel(entry.model);
    if (!serialized) return [];
    return [{ model: serialized, ...(entry.thinkingLevel ? { thinkingLevel: entry.thinkingLevel } : {}) }];
  });
  return {
    cwd: source.cwd,
    systemPrompt: source.systemPrompt ?? "",
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    ...(model ? { model } : {}),
    ...(source.thinkingLevel ? { thinkingLevel: source.thinkingLevel } : {}),
    scopedModels,
    isIdle: source.isIdle,
    hasPendingMessages: (source.pendingMessages ?? 0) > 0,
    ...(source.contextUsage
      ? { contextUsage: { tokens: source.contextUsage.tokens, contextWindow: source.contextUsage.contextWindow, percent: percentOf(source.contextUsage) } }
      : {}),
    models: source.models ?? EMPTY_PI_EXTENSION_MODELS,
    session: source.session ? { ...source.session, cwd: source.session.cwd || source.cwd } : { ...EMPTY_PI_EXTENSION_SESSION, cwd: source.cwd }
  };
}
