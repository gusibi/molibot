import type {
  AssistantMessage,
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

export function completeWithPiRuntime(
  model: Model<any>,
  context: Context,
  options?: ModelsSimpleStreamOptions
): Promise<AssistantMessage> {
  return streamWithPiRuntime(model, context, options).result();
}
