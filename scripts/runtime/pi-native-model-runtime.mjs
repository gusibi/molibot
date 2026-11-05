import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

/** Keep extension-defined providers local, with host admission and usage receipts. */
export function ownedNativeModelRuntime(runtime, bridges, host) {
  const owned = (model) => !bridges.has(model.provider) || bridges.get(model.provider) !== runtime.getRegisteredNativeProvider(model.provider);
  async function admitted(model, kind, operation) {
    const { permit } = await host("nativeModel.before", { provider: model.provider, id: model.id, api: model.api, kind });
    const value = await operation();
    await host("nativeModel.usage", { permit, usage: value?.usage });
    return value;
  }
  function stream(method, model, context, options) {
    if (!owned(model)) return runtime[method](model, context, options);
    const output = createAssistantMessageEventStream();
    void admitted(model, "chat", async () => {
      const events = runtime[method](model, context, { ...options, maxRetries: 0 });
      for await (const event of events) output.push(event);
      return events.result();
    }).then((message) => output.end(message)).catch((error) => {
      const message = { role: "assistant", content: [], provider: model.provider, model: model.id, api: model.api,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: options?.signal?.aborted ? "aborted" : "error", errorMessage: error.message, timestamp: Date.now() };
      output.push({ type: "error", reason: message.stopReason, error: message });
      output.end(message);
    });
    return output;
  }
  return new Proxy(runtime, {
    get(target, property) {
      if (["stream", "streamSimple", "streamDeferred"].includes(property)) return (...args) => stream(property, ...args);
      if (["complete", "completeSimple", "fetchDeferred"].includes(property)) return async (model, context, options) => {
        const events = stream(property === "fetchDeferred" ? "streamDeferred" : property === "complete" ? "stream" : "streamSimple", model, context, options);
        for await (const _event of events) {}
        return events.result();
      };
      if (property === "classify" || property === "generateImages") return async (model, context, options) => {
        try { return await admitted(model, property === "classify" ? "classify" : "image", () => target[property](model, context, { ...options, maxRetries: 0 })); }
        catch (error) { return { provider: model.provider, model: model.id, api: model.api,
          ...(property === "classify" ? { answers: {} } : { output: [] }),
          stopReason: options?.signal?.aborted ? "aborted" : "error", errorMessage: error.message, timestamp: Date.now() }; }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
