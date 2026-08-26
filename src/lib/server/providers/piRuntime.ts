import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  ModelsSimpleStreamOptions
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveAuthFilePath } from "$lib/server/agent/identity/authPath.js";
import { FileCredentialStore } from "$lib/server/agent/identity/credentialStore.js";
import { getPiModels } from "$lib/server/providers/piRegistry.js";

const models = getPiModels();

function isBuiltinModel(model: Model<any>): boolean {
  const builtin = models.getModel(model.provider, model.id);
  return Boolean(
    builtin &&
    builtin.api === model.api &&
    (builtin.baseUrl ?? "") === (model.baseUrl ?? "")
  );
}

export { getPiModels } from "$lib/server/providers/piRegistry.js";

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
  const telemetryContext = options?.telemetryContext;
  if (telemetryContext) {
    const output = createAssistantMessageEventStream();
    const startedAt = Date.now();
    void telemetryContext.startSpan({
      name: "pi.ai.request",
      attributes: {
        "pi.ai.operation": "stream",
        "pi.ai.provider": model.provider,
        "pi.ai.model": model.id,
        "pi.ai.api": model.api,
        "pi.ai.streaming": true
      }
    }, async (span) => {
      let chunkCount = 0;
      let firstChunkAt: number | undefined;
      let httpStatus: number | undefined;
      const stream = streamProvider(model, context, {
        ...options,
        telemetryContext: span,
        onResponse: async (response, responseModel) => {
          httpStatus = response.status;
          await options.onResponse?.(response, responseModel);
        }
      });
      let terminal: AssistantMessage | undefined;
      for await (const event of stream) {
        if (event.type !== "start" && event.type !== "done" && event.type !== "error") {
          chunkCount += 1;
          firstChunkAt ??= Date.now();
        }
        if (event.type === "done") terminal = event.message;
        if (event.type === "error") terminal = event.error;
        output.push(event);
      }
      terminal ??= await stream.result();
      const usage = terminal.usage as AssistantMessage["usage"] & { reasoning?: number };
      const normalizedStopReason = terminal.stopReason === "toolUse" ? "tool_use" : terminal.stopReason;
      span.setAttributes({
        "pi.ai.response.model": terminal.responseModel,
        "pi.ai.response.id": terminal.responseId,
        "pi.ai.response.stop_reason": normalizedStopReason,
        "pi.ai.http.status_code": httpStatus,
        "pi.ai.usage.input_tokens": usage.input,
        "pi.ai.usage.output_tokens": usage.output,
        "pi.ai.usage.cache_read_tokens": usage.cacheRead,
        "pi.ai.usage.cache_write_tokens": usage.cacheWrite,
        "pi.ai.usage.reasoning_tokens": usage.reasoning,
        "pi.ai.usage.total_tokens": usage.totalTokens,
        "pi.ai.usage.cost": usage.cost?.total,
        "pi.ai.stream.chunk_count": chunkCount,
        "pi.ai.stream.time_to_first_chunk_ms": firstChunkAt === undefined ? undefined : firstChunkAt - startedAt,
        "pi.ai.error.type": terminal.stopReason === "error" ? "ProviderResponseError" : undefined
      });
      if (terminal.stopReason === "error") {
        span.setStatus({
          status: "error",
          error: { name: "ProviderResponseError", message: terminal.errorMessage ?? "Provider request failed" }
        });
      }
      return terminal;
    }).catch((error) => {
      const message: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
      output.push({ type: "error", reason: "error", error: message });
    });
    return output;
  }
  return streamProvider(model, context, options);
}

function streamProvider(
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
