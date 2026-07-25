import type {
  AssistantMessageEventStream,
  Context,
  Model,
  ModelsSimpleStreamOptions
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";
import { FileCredentialStore } from "$lib/server/agent/identity/credentialStore.js";

const models = builtinModels({
  credentials: new FileCredentialStore(resolveAuthFilePath())
});

function isBuiltinModel(model: Model<any>): boolean {
  const builtin = models.getModel(model.provider, model.id);
  return Boolean(
    builtin &&
    builtin.api === model.api &&
    (builtin.baseUrl ?? "") === (model.baseUrl ?? "")
  );
}

export function getPiModels() {
  return models;
}

export function getPiCatalogModels(providerId: string): readonly Model<any>[] {
  return models.getModels(providerId);
}

export async function createPiModelRuntime(): Promise<ModelRuntime> {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  return ModelRuntime.create({
    credentials: new FileCredentialStore(resolveAuthFilePath()),
    modelsPath: null,
    allowModelNetwork: false
  });
}

export async function hasPiProviderAuth(
  providerId: string,
  apiKey?: string
): Promise<boolean> {
  if (apiKey?.trim()) return true;
  return Boolean(await models.checkAuth(providerId));
}

/**
 * Route a model to its stream implementation.
 *
 * Custom providers deliberately bypass `Models` rather than being registered
 * into it with `MutableModels.setProvider`. Registration was evaluated and
 * rejected: custom providers live in runtime settings and are added, edited and
 * deleted through the settings UI, so registering them would put a cache
 * invalidation surface on the hot path of every model call, and it buys nothing
 * — `resolveCustomModel` already attaches auth, headers, `compat`, `reasoning`
 * and `thinkingLevelMap` to the model it builds.
 *
 * The final throw is defensive only. `CustomProviderProtocol` is
 * `"openai-compatible" | "anthropic"` and `resolveCustomProviderProtocol`
 * always returns one of them, so a custom model's `api` is always one of the
 * two branches below. Supporting a third protocol (e.g. `openai-responses`)
 * means adding it to the settings schema and one branch here — not switching to
 * provider registration.
 */
export function streamWithPiRuntime(
  model: Model<any>,
  context: Context,
  options?: ModelsSimpleStreamOptions
): AssistantMessageEventStream {
  if (isBuiltinModel(model)) {
    return models.streamSimple(model, context, options);
  }
  if (model.api === "anthropic-messages") {
    return streamAnthropic(model, context, options);
  }
  if (model.api === "openai-completions") {
    return streamOpenAICompletions(model, context, options);
  }
  throw new Error(`Unsupported custom model API '${model.api}' for '${model.provider}/${model.id}'.`);
}
