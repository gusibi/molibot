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
let nextHostId = 1;

function hostRequest(token, method, input) {
  const id = nextHostId++;
  return new Promise((resolve, reject) => {
    pendingHost.set(id, { resolve, reject });
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
  const wake = () => { if (resolveNext) { const resolve = resolveNext; resolveNext = undefined; resolve(); } };
  return {
    push(event) { if (done) return; queue.push(event); wake(); },
    end(message) { if (done) return; finalMessage = message; done = true; wake(); },
    fail(error) { if (done) return; failure = error instanceof Error ? error : new Error(String(error)); done = true; wake(); },
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          while (queue.length === 0 && !done) await new Promise((resolve) => { resolveNext = resolve; });
          return queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true };
        }
      };
    },
    result() { return failure ? Promise.reject(failure) : Promise.resolve(finalMessage); }
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
      return index < 0 ? entries.slice() : entries.slice(0, index + 1);
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
function executeTool(id, input, name, args) {
  const toolCallId = `${input.toolCallId ?? "extension"}/${name}`;
  const failure = (text) => ({
    toolCall: { type: "toolCall", id: toolCallId, name, arguments: args ?? {} },
    result: { content: [{ type: "text", text }], details: {} },
    isError: true
  });
  if (!input.hostToken) return Promise.resolve(failure("Nested tool execution is not available in this context."));
  return hostRequest(input.hostToken, "executeTool", { toolName: name, args })
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
    if (localSignal) {
      const onAbort = () => {
        void hostRequest(input.hostToken, "modelRegistry.streamAbort", { streamId }).catch(() => undefined);
        events.fail(localSignal.reason instanceof Error ? localSignal.reason : new Error("Model stream aborted."));
      };
      if (localSignal.aborted) onAbort();
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
      .catch((error) => events.fail(error));
    return events;
  };

  return {
    getAll: () => listOf("chat").slice(),
    getAvailable: () => listOf("chat").filter((model) => catalog.providerAuth?.[model.provider] === true),
    find: (provider, modelId) => listOf("chat").find((model) => model.provider === provider && model.id === modelId),
    findOfType: (type, provider, modelId) => withProvider(type, provider).find((model) => model.id === modelId),
    getModelsOfType: (type, provider) => withProvider(type, provider).slice(),
    getModelOfType: (type, provider, modelId) => withProvider(type, provider).find((model) => model.id === modelId),
    hasConfiguredAuth: (model) => Boolean(model && catalog.providerAuth?.[model.provider] === true),
    getProviderDisplayName: (provider) => provider,
    isUsingOAuth: () => false,

    classify: async (model, context) => {
      const base = { api: model?.api, provider: model?.provider, model: model?.id ?? "", answers: {}, stopReason: "error", timestamp: Date.now() };
      if (!input.hostToken) return { ...base, errorMessage: "Model operations are not available in this context." };
      try {
        const result = await hostRequest(input.hostToken, "modelRegistry.classify", {
          key: `classifier|${model.provider}|${model.id}`, state: context?.state ?? {}, questions: context?.questions ?? {}
        });
        return { api: model?.api, provider: model?.provider, model: result.model, answers: result.answers, usage: result.usage, stopReason: "stop", timestamp: Date.now() };
      } catch (error) {
        return { ...base, errorMessage: error instanceof Error ? error.message : String(error) };
      }
    },

    generateImages: async (model, context) => {
      const base = { api: model?.api, provider: model?.provider, model: model?.id ?? "", output: [], stopReason: "error", timestamp: Date.now() };
      if (!input.hostToken) return { ...base, errorMessage: "Model operations are not available in this context." };
      const blocks = Array.isArray(context?.input) ? context.input : [];
      const prompt = blocks.filter((block) => block && block.type === "text").map((block) => block.text).join("\n");
      const images = blocks.filter((block) => block && block.type === "image").map((block) => `data:${block.mimeType};base64,${block.data}`);
      try {
        const result = await hostRequest(input.hostToken, "modelRegistry.generateImages", { key: `image|${model.provider}|${model.id}`, prompt, images });
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
    stream: (model, context, options) => startStream(model, context, options, false),
    streamSimple: (model, context, options) => startStream(model, context, options, true),
    complete: async (model, context, options) => {
      const events = startStream(model, context, options, false);
      for await (const _event of events) { /* drain to completion */ }
      return events.result();
    }
  };
}

function context(id, input, notifications) {
  const runtime = input.runtime ?? {};
  return {
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      notify: (message, type = "info") => notifications.push({ message, type }),
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined
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
    signal: new AbortController().signal,
    abort: () => {
      if (input.hostToken) void hostRequest(input.hostToken, "abort", {}).catch(() => undefined);
      else reject(id, "ctx.abort", "Aborting the run requires an active invocation.");
    },
    hasPendingMessages: () => runtime.hasPendingMessages ?? false,
    shutdown: () => reject(id, "ctx.shutdown", "Extensions cannot stop the Molibot service."),
    getContextUsage: () => runtime.contextUsage,
    compact: () => {
      // pi's compact() is fire-and-forget: it triggers compaction without awaiting.
      if (input.hostToken) void hostRequest(input.hostToken, "compact", {}).catch(() => undefined);
      else reject(id, "ctx.compact", "Compaction requires an active invocation.");
    },
    getSystemPrompt: () => runtime.systemPrompt ?? input.systemPrompt ?? "",
    // The exact set `executeTool` accepts; nested calls route through the shared
    // ToolRuntime so permissions, approvals and budgets apply.
    tools: Array.isArray(input.tools) ? input.tools : [],
    executeTool: (name, args) => executeTool(id, input, name, args)
  };
}

function findExtension(id) {
  const extension = extensions.find((candidate) => candidate.__molibotId === id);
  if (!extension) throw new Error(`Unknown pi extension: ${id}`);
  return extension;
}

async function dispatch(message) {
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
  const ctx = context(input.extensionId, input, notifications);
  if (message.method === "invokeTool") {
    const definition = extension.tools.get(input.toolName)?.definition;
    if (!definition) throw new Error(`Unknown extension tool: ${input.toolName}`);
    const updates = [];
    const value = await definition.execute(input.toolCallId, input.params, ctx.signal, (update) => updates.push(clone(update)), ctx);
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
    return { results, payload: input.payload, notifications };
  }
  if (message.method === "invokeCommand") {
    const command = extension.commands.get(input.command);
    if (!command) throw new Error(`Unknown extension command: ${input.command}`);
    await command.handler(input.args, ctx);
    return { notifications };
  }
  throw new Error(`Unknown pi extension worker method: ${message.method}`);
}

process.on("message", (message) => {
  if (message?.kind === "hostEvent") {
    const pending = pendingHost.get(message.id);
    if (pending?.onEvent) pending.onEvent(message.event);
    return;
  }
  if (message?.kind === "hostResponse") {
    const pending = pendingHost.get(message.id);
    if (!pending) return;
    pendingHost.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else {
      const error = new Error(message.error?.message ?? "Extension host request failed.");
      if (message.error?.stack) error.stack = message.error.stack;
      pending.reject(error);
    }
    return;
  }
  if (message?.kind !== "request") return;
  void dispatch(message).then(
    (value) => send({ kind: "response", id: message.id, ok: true, value }),
    (error) => send({ kind: "response", id: message.id, ok: false, error: errorPayload(error) })
  );
});
process.on("disconnect", () => process.exit(0));
