import { readFileSync } from "node:fs";
import path from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

let extensions = [];
let extensionRuntime = null;

function send(message) {
  if (process.connected) process.send(message);
}

// Worker -> host requests (for example `executeTool`), correlated by id and
// routed back through the token of the invocation that started them.
const pendingHost = new Map();
const invocationControllers = new Map();
let nextHostId = 1;

function hostRequest(token, method, input, options = {}) {
  const id = nextHostId++;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason ?? new Error("Call aborted.")); return; }
    const abort = () => send({ kind: "hostCancel", id, token });
    options.signal?.addEventListener("abort", abort, { once: true });
    pendingHost.set(id, { resolve, reject, onEvent: options.onUpdate, cleanup: () => options.signal?.removeEventListener("abort", abort) });
    send({ kind: "hostRequest", id, token, method, input });
  });
}

function hostStream(token, method, input, onEvent) {
  const id = nextHostId++;
  return new Promise((resolve, reject) => {
    pendingHost.set(id, { resolve, reject, onEvent });
    send({ kind: "hostRequest", id, token, method, input, stream: true });
  });
}

function safeClone(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch { return undefined; }
}

/** A pi-shaped assistant message event stream fed by host pushes. */
function createEventStream() {
  const queue = [];
  let resolveNext;
  let done = false;
  let finalMessage;
  let failure;
  let resolveCompleted;
  const completed = new Promise(resolve => { resolveCompleted = resolve; });
  const wake = () => { if (resolveNext) { const resolve = resolveNext; resolveNext = undefined; resolve(); } };
  return {
    push(event) { if (done) return; queue.push(event); wake(); },
    end(message) { if (done) return; finalMessage = message; done = true; resolveCompleted(); wake(); },
    fail(error) { if (done) return; failure = error instanceof Error ? error : new Error(String(error)); done = true; resolveCompleted(); wake(); },
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          while (queue.length === 0 && !done) await new Promise((resolve) => { resolveNext = resolve; });
          return queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true };
        }
      };
    },
    async result() { await completed; if (failure) throw failure; return finalMessage; }
  };
}

function errorPayload(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };
}

function extensionId(entryPath, agentDir) {
  const relative = path.relative(path.join(agentDir, "extensions"), entryPath);
  const first = relative.split(path.sep)[0];
  return first && first !== ".." ? first : path.basename(path.dirname(entryPath));
}

function packageMeta(id, agentDir) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(agentDir, "extensions", id, "package.json"), "utf8"));
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : id,
      version: typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "unknown",
      description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : undefined
    };
  } catch {
    return { name: id, version: "unknown" };
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function describe(extension, agentDir) {
  const entryPath = extension.resolvedPath || extension.path;
  const id = extensionId(entryPath, agentDir);
  const unsupported = [];
  if (extension.shortcuts.size) unsupported.push("shortcuts");
  if (extension.messageRenderers.size) unsupported.push("messageRenderers");
  if (extension.entryRenderers?.size) unsupported.push("entryRenderers");
  return {
    id,
    ...packageMeta(id, agentDir),
    entryPath,
    toolNames: [...extension.tools.keys()],
    eventNames: [...extension.handlers.keys()],
    eventHandlerCounts: Object.fromEntries([...extension.handlers.entries()].map(([name, handlers]) => [name, handlers.length])),
    commandNames: [...extension.commands.keys()],
    flagNames: [...extension.flags.keys()],
    unsupported,
    tools: [...extension.tools.values()].map(({ definition }) => ({
      name: definition.name,
      label: definition.label ?? definition.name,
      description: definition.description ?? "",
      parameters: clone(definition.parameters),
      executionMode: definition.executionMode
    })),
    commands: [...extension.commands.entries()].map(([name, command]) => ({ name, description: command.description }))
  };
}

function reject(id, capability, hint) {
  throw new Error(`pi extension "${id}" called ${capability}, which Molibot does not provide. ${hint}`);
}

/**
 * Read-only `ctx.sessionManager` over the native durable log snapshot.
 *
 * Identity, entries, branch and leaf come from the real durable context; the
 * native store already resolves the active branch, so reads are synchronous
 * and never masquerade as Promises. Durable entries carry the model-visible
 * messages they contributed, so an entry is exposed both as a pi-style
 * `message` entry and with its full `messages` array. Molibot sessions are a
 * linear log, so `getTree` is flat and there are no labels.
 */
function sessionManager(_id, runtime) {
  const session = runtime.session && typeof runtime.session === "object" ? runtime.session : {};
  const cwd = session.cwd ?? runtime.cwd ?? "";
  const entries = (Array.isArray(session.entries) ? session.entries : []).map((entry) => {
    const messages = Array.isArray(entry.messages) ? entry.messages : [];
    return messages.length
      ? { id: entry.id, parentId: null, timestamp: "", type: "message", message: messages[0], messages }
      : { id: entry.id, parentId: null, timestamp: "", type: "custom", customType: entry.kind, messages };
  });
  return {
    getCwd: () => cwd,
    getSessionDir: () => session.dir ?? "",
    getSessionId: () => session.id,
    getSessionFile: () => session.file ?? "",
    getSessionName: () => session.name,
    getHeader: () => ({ type: "session", id: session.id, cwd, timestamp: "" }),
    getLeafId: () => entries.at(-1)?.id,
    getLeafEntry: () => entries.at(-1),
    getEntry: (entryId) => entries.find((entry) => entry.id === entryId),
    getLabel: () => undefined,
    getBranch: (fromId) => {
      if (!fromId) return entries.slice();
      const index = entries.findIndex((entry) => entry.id === fromId);
      if (index < 0) return reject(_id, "sessionManager.getBranch", "The entry is outside this invocation's Session.");
      return entries.slice(0, index + 1);
    },
    getEntries: () => entries.slice(),
    getTree: () => entries.map((entry) => ({ entry, children: [] })),
    buildContextEntries: () => entries.slice(),
    buildSessionProjection: () => ({
      entries,
      messages: entries.flatMap((entry) => (Array.isArray(entry.messages) ? entry.messages : [])),
      thinkingLevel: runtime.thinkingLevel ?? "off",
      model: runtime.model ? { provider: runtime.model.provider, modelId: runtime.model.id } : null
    })
  };
}

/**
 * The extension `ExtensionContext`, built from the invoking run's snapshot.
 *
 * Read-only run state (cwd, model, thinking level, scoped models, context
 * usage, idle/pending flags, system prompt) is real. Interfaces Molibot does
 * not serve yet, and terminal-only ones, throw an error naming the extension
 * and the capability — never a silent no-op or a fabricated success.
 */
/** Nest a tool call through the host's shared ToolRuntime; failures come back as `isError`. */
function executeTool(id, input, name, args, options) {
  const toolCallId = `${input.toolCallId ?? "extension"}/${name}`;
  const failure = (text) => ({
    toolCall: { type: "toolCall", id: toolCallId, name, arguments: args ?? {} },
    result: { content: [{ type: "text", text }], details: {} },
    isError: true
  });
  if (!input.hostToken) return Promise.resolve(failure("Nested tool execution is not available in this context."));
  return hostRequest(input.hostToken, "executeTool", { toolName: name, args }, options)
    .catch((error) => failure(error instanceof Error ? error.message : String(error)));
}

/**
 * Extension-facing `ctx.modelRegistry` over the snapshot catalog.
 *
 * Discovery is synchronous and credential-free; `classify`/`generateImages`
 * round-trip to the host's shared ModelOperations so authorization, budget and
 * usage accounting stay on the same path as Codemode. Credential access and
 * provider/registration mutation are rejected explicitly.
 */
function modelRegistry(id, input, runtime) {
  const catalog = runtime.models && typeof runtime.models === "object" ? runtime.models : {};
  const listOf = (type) => (Array.isArray(catalog[type]) ? catalog[type] : []);
  const withProvider = (type, provider) => listOf(type).filter((model) => !provider || model.provider === provider);
  const unsupported = (capability, hint) => reject(id, capability, hint);

  // Streaming: the host runs the shared Provider adapter and pushes serialized
  // events back; the worker exposes them as a pi-shaped event stream.
  const startStream = (model, context, options, simple) => {
    const events = createEventStream();
    if (!input.hostToken) { events.fail(new Error("Model streaming is not available in this context.")); return events; }
    const streamId = `${input.toolCallId ?? "extension"}:stream:${nextHostId}`;
    const localSignal = options && options.signal;
    let onAbort;
    if (localSignal) {
      onAbort = () => {
        void hostRequest(input.hostToken, "modelRegistry.streamAbort", { streamId }).catch(() => undefined);
        events.fail(localSignal.reason instanceof Error ? localSignal.reason : new Error("Model stream aborted."));
      };
      if (localSignal.aborted) { events.fail(localSignal.reason ?? new Error("Model stream aborted.")); return events; }
      else localSignal.addEventListener("abort", onAbort, { once: true });
    }
    void hostStream(input.hostToken, "modelRegistry.stream", {
      streamId,
      model: { provider: model && model.provider, id: model && model.id },
      simple: Boolean(simple),
      context: safeClone(context),
      options: safeClone(options)
    }, (event) => events.push(event))
      .then((value) => events.end(value && value.message))
      .catch((error) => events.fail(error))
      .finally(() => { if (onAbort) localSignal.removeEventListener("abort", onAbort); });
    return events;
  };

  return {
    getAll: () => listOf("chat").slice(),
    getAvailable: () => listOf("chat").filter((model) => catalog.providerAuth?.[model.provider] === true),
    find: (provider, modelId) => listOf("chat").find((model) => model.provider === provider && model.id === modelId),
    findOfType: (type, provider, modelId) => withProvider(type, provider).find((model) => model.id === modelId),
    getModelsOfType: (type, provider) => withProvider(type, provider).slice(),
    getAvailableOfType: async (type, provider) => withProvider(type, provider).filter(model => catalog.providerAuth?.[model.provider] === true),
    getModelOfType: (type, provider, modelId) => withProvider(type, provider).find((model) => model.id === modelId),
    hasConfiguredAuth: (model) => Boolean(model && catalog.providerAuth?.[model.provider] === true),
    getProviderDisplayName: (provider) => provider,
    isUsingOAuth: model => Boolean(model && catalog.providerOAuth?.[model.provider]),

    classify: async (model, context, options = {}) => {
      const base = { api: model?.api, provider: model?.provider, model: model?.id ?? "", answers: {}, stopReason: "error", timestamp: Date.now() };
      if (!input.hostToken) return { ...base, errorMessage: "Model operations are not available in this context." };
      try {
        for (const key of Object.keys(options)) if (key !== "signal") return reject(id, `modelRegistry.classify option ${key}`, "Only the optional cancellation signal is supported; request options are host-owned.");
        const result = await hostRequest(input.hostToken, "modelRegistry.classify", {
          key: `classifier|${model.provider}|${model.id}`, state: context?.state ?? {}, questions: context?.questions ?? {}
        }, options);
        return { api: model?.api, provider: model?.provider, model: result.model, answers: result.answers, usage: result.usage, stopReason: "stop", timestamp: Date.now() };
      } catch (error) {
        return { ...base, errorMessage: error instanceof Error ? error.message : String(error) };
      }
    },

    generateImages: async (model, context, options = {}) => {
      const base = { api: model?.api, provider: model?.provider, model: model?.id ?? "", output: [], stopReason: "error", timestamp: Date.now() };
      if (!input.hostToken) return { ...base, errorMessage: "Model operations are not available in this context." };
      const blocks = Array.isArray(context?.input) ? context.input : [];
      const prompt = blocks.filter((block) => block && block.type === "text").map((block) => block.text).join("\n");
      const images = blocks.filter((block) => block && block.type === "image").map((block) => `data:${block.mimeType};base64,${block.data}`);
      try {
        for (const key of Object.keys(options)) if (key !== "signal") return reject(id, `modelRegistry.generateImages option ${key}`, "Only the optional cancellation signal is supported; provider-specific size, seed and metadata options are unavailable.");
        const result = await hostRequest(input.hostToken, "modelRegistry.generateImages", { key: `image|${model.provider}|${model.id}`, prompt, images }, options);
        const output = [];
        for (const image of result.images ?? []) output.push({ type: "image", mimeType: image.mimeType, data: image.data });
        if (result.text) output.push({ type: "text", text: result.text });
        return { api: model?.api, provider: model?.provider, model: result.model, output, usage: result.usage, stopReason: "stop", timestamp: Date.now() };
      } catch (error) {
        return { ...base, errorMessage: error instanceof Error ? error.message : String(error) };
      }
    },

    refresh: () => unsupported("modelRegistry.refresh", "The catalog is a per-invocation snapshot."),
    getError: () => undefined,
    getApiKeyAndHeaders: () => unsupported("modelRegistry.getApiKeyAndHeaders", "Credentials are never exposed to extensions."),
    getApiKeyForProvider: () => unsupported("modelRegistry.getApiKeyForProvider", "Credentials are never exposed to extensions."),
    getProvider: () => unsupported("modelRegistry.getProvider", "Provider objects are never exposed to extensions."),
    getProviderAuth: () => unsupported("modelRegistry.getProviderAuth", "Credentials are never exposed to extensions."),
    getProviderAuthStatus: () => unsupported("modelRegistry.getProviderAuthStatus", "Credentials are never exposed to extensions."),
    registerProvider: () => unsupported("modelRegistry.registerProvider", "Extensions cannot modify providers."),
    unregisterProvider: () => unsupported("modelRegistry.unregisterProvider", "Extensions cannot modify providers."),
    registerVirtualModel: () => unsupported("modelRegistry.registerVirtualModel", "Extensions cannot register models."),
    unregisterVirtualModel: () => unsupported("modelRegistry.unregisterVirtualModel", "Extensions cannot register models."),
    getRegisteredProviderConfig: () => unsupported("modelRegistry.getRegisteredProviderConfig", "Provider configuration may contain credentials."),
    getRegisteredNativeProvider: () => unsupported("modelRegistry.getRegisteredNativeProvider", "Executable Provider objects are host-owned."),
    getRegisteredProviderIds: () => Object.keys(catalog.providerAuth ?? {}),
    stream: (model, context, options) => startStream(model, context, options, false),
    streamSimple: (model, context, options) => startStream(model, context, options, true),
    complete: async (model, context, options) => {
      const events = startStream(model, context, options, false);
      for await (const _event of events) { /* drain to completion */ }
      return events.result();
    }
  };
}

function context(id, input, notifications, signal, controls) {
  const control = (method, payload = {}) => {
    if (!input.hostToken) return reject(id, `ctx.${method}`, "An active invocation is required.");
    const task = hostRequest(input.hostToken, method, payload);
    task.catch(() => undefined);
    controls.push(task);
  };
  const runtime = input.runtime ?? {};
  return {
    ui: {
      select: () => reject(id, "ctx.ui.select", "Terminal UI is unavailable in print mode."),
      confirm: () => reject(id, "ctx.ui.confirm", "Terminal UI is unavailable in print mode."),
      input: () => reject(id, "ctx.ui.input", "Terminal UI is unavailable in print mode."),
      notify: (message, type = "info") => notifications.push({ message, type }),
      onTerminalInput: () => reject(id, "ctx.ui.onTerminalInput", "Terminal UI is unavailable in print mode."),
      setStatus: () => reject(id, "ctx.ui.setStatus", "Terminal UI is unavailable in print mode."),
      setWorkingMessage: () => reject(id, "ctx.ui.setWorkingMessage", "Terminal UI is unavailable in print mode."),
      setWorkingVisible: () => reject(id, "ctx.ui.setWorkingVisible", "Terminal UI is unavailable in print mode."),
      setWorkingIndicator: () => reject(id, "ctx.ui.setWorkingIndicator", "Terminal UI is unavailable in print mode."),
      setHiddenThinkingLabel: () => reject(id, "ctx.ui.setHiddenThinkingLabel", "Terminal UI is unavailable in print mode."),
      setWidget: () => reject(id, "ctx.ui.setWidget", "Terminal UI is unavailable in print mode."),
      setFooter: () => reject(id, "ctx.ui.setFooter", "Terminal UI is unavailable in print mode."),
    },
    mode: "print",
    hasUI: false,
    cwd: runtime.cwd ?? input.cwd,
    sessionManager: sessionManager(id, runtime),
    modelRegistry: modelRegistry(id, input, runtime),
    model: runtime.model,
    scopedModels: Array.isArray(runtime.scopedModels) ? runtime.scopedModels : [],
    thinkingLevel: runtime.thinkingLevel,
    isIdle: () => runtime.isIdle ?? false,
    isProjectTrusted: () => true,
    signal,
    abort: () => {
      control("abort");
    },
    hasPendingMessages: () => runtime.hasPendingMessages ?? false,
    shutdown: () => reject(id, "ctx.shutdown", "Extensions cannot stop the Molibot service."),
    getContextUsage: () => runtime.contextUsage,
    compact: (options = {}) => {
      if (options.onComplete || options.onError) return reject(id, "ctx.compact callbacks", "Native compaction exposes its result through the current Session; callback result shapes are not supported.");
      control("compact", { customInstructions: options.customInstructions });
    },
    getSystemPrompt: () => runtime.systemPrompt ?? input.systemPrompt ?? "",
    // The exact set `executeTool` accepts; nested calls route through the shared
    // ToolRuntime so permissions, approvals and budgets apply.
    tools: Array.isArray(input.tools) ? input.tools : [],
    executeTool: (name, args, options) => executeTool(id, input, name, args, options)
  };
}

function findExtension(id) {
  const extension = extensions.find((candidate) => candidate.__molibotId === id);
  if (!extension) throw new Error(`Unknown pi extension: ${id}`);
  return extension;
}

async function dispatch(message, signal) {
  const input = message.input ?? {};
  if (message.method === "load") {
    const result = await discoverAndLoadExtensions([], input.cwd, input.agentDir);
    extensions = result.extensions;
    extensionRuntime = result.runtime;
    for (const extension of extensions) {
      const entryPath = extension.resolvedPath || extension.path;
      extension.__molibotId = extensionId(entryPath, input.agentDir);
    }
    return {
      extensions: extensions.map((extension) => describe(extension, input.agentDir)),
      errors: result.errors.map((entry) => ({
        id: extensionId(entry.path, input.agentDir),
        entryPath: entry.path,
        error: entry.error
      }))
    };
  }
  if (message.method === "setFlags") {
    for (const [name, value] of Object.entries(input.flags ?? {})) extensionRuntime?.flagValues.set(name, value);
    return null;
  }
  const extension = findExtension(input.extensionId);
  const notifications = [];
  const controls = [];
  const ctx = context(input.extensionId, input, notifications, signal, controls);
  if (message.method === "invokeTool") {
    const definition = extension.tools.get(input.toolName)?.definition;
    if (!definition) throw new Error(`Unknown extension tool: ${input.toolName}`);
    const updates = [];
    const value = await definition.execute(input.toolCallId, input.params, ctx.signal, (update) => updates.push(clone(update)), ctx);
    await Promise.all(controls);
    return { value, updates, notifications };
  }
  if (message.method === "invokeEvent") {
    const results = [];
    const handlers = extension.handlers.get(input.event) ?? [];
    if (Number.isInteger(input.handlerIndex)) {
      const handler = handlers[input.handlerIndex];
      if (!handler) throw new Error(`Unknown extension event handler: ${input.event}[${input.handlerIndex}]`);
      results.push(await handler(input.payload, ctx));
    } else {
      for (const handler of handlers) results.push(await handler(input.payload, ctx));
    }
    await Promise.all(controls);
    return { results, payload: input.payload, notifications };
  }
  if (message.method === "invokeCommand") {
    const command = extension.commands.get(input.command);
    if (!command) throw new Error(`Unknown extension command: ${input.command}`);
    await command.handler(input.args, ctx);
    await Promise.all(controls);
    return { notifications };
  }
  throw new Error(`Unknown pi extension worker method: ${message.method}`);
}

process.on("message", (message) => {
  if (message?.kind === "cancelInvocation") {
    invocationControllers.get(message.id)?.abort(new Error("The owning invocation was cancelled."));
    return;
  }
  if (message?.kind === "hostEvent") {
    const pending = pendingHost.get(message.id);
    if (pending?.onEvent) pending.onEvent(message.event);
    return;
  }
  if (message?.kind === "hostResponse") {
    const pending = pendingHost.get(message.id);
    if (!pending) return;
    pendingHost.delete(message.id);
    pending.cleanup?.();
    if (message.ok) pending.resolve(message.value);
    else {
      const error = new Error(message.error?.message ?? "Extension host request failed.");
      if (message.error?.stack) error.stack = message.error.stack;
      pending.reject(error);
    }
    return;
  }
  if (message?.kind !== "request") return;
  const controller = new AbortController();
  invocationControllers.set(message.id, controller);
  void dispatch(message, controller.signal).then(
    (value) => send({ kind: "response", id: message.id, ok: true, value }),
    (error) => send({ kind: "response", id: message.id, ok: false, error: errorPayload(error) })
  ).finally(() => invocationControllers.delete(message.id));
});
process.on("disconnect", () => process.exit(0));
