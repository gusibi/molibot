import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createProvider, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAgentSession, AgentSessionRuntime, DefaultResourceLoader, InteractiveMode, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { PiExtensionTerminal } from "./pi-extension-terminal.mjs";
import { ownedNativeModelRuntime } from "./pi-native-model-runtime.mjs";

const pending = new Map();
let nextId = 0;
let terminal;
let runtime;
let mode;
let abort;
const modelCallbacks = new Map();

// Bind the official UI through the public session binding API.
function guardInteractiveUI(ui, token) {
  if (!ui) return ui;
  return new Proxy(ui, {
    get(target, name) {
      const operation = target[name];
      if (!["select", "confirm", "input", "custom", "editor"].includes(name)) return typeof operation === "function" ? operation.bind(target) : operation;
      return async (...args) => {
        const id = ++nextId;
        await host(token, "terminal.interactionStart", { id });
        try { return await operation.apply(target, args); }
        finally { await host(token, "terminal.interactionEnd", { id }); }
      };
    }
  });
}
const send = (message) => { if (process.connected) process.send(message); };

function host(token, method, input, options = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onAbort = () => send({ kind: "hostCancel", id, token });
    if (options.signal?.aborted) return reject(new Error("Native Pi call was aborted."));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, { resolve, reject, onEvent: options.onEvent, cleanup: () => options.signal?.removeEventListener("abort", onAbort) });
    send({ kind: "hostRequest", id, token, method, input });
  });
}

function stream(token, model, context, options, simple) {
  const result = createAssistantMessageEventStream();
  const allowed = new Set(["deferred", "temperature", "maxTokens", "reasoning", "thinkingBudgets", "toolChoice", "metadata", "timeoutMs", "transport", "cacheRetention"]);
  const portable = Object.fromEntries(Object.entries(options ?? {}).filter(([key]) => allowed.has(key)));
  const callbackId = ++nextId;
  modelCallbacks.set(callbackId, options ?? {});
  // Host credentials and session affinity remain host-owned; extension tracing
  // headers may accompany the request without copying those secrets into IPC.
  const requestHeaders = Object.fromEntries(Object.entries(options?.headers ?? {}).filter(([key]) =>
    !/^(authorization|proxy-authorization|cookie|host|x-api-key|api-key|content-length|connection|transfer-encoding|x-molibot-session|x-opencode-session)$/i.test(key)));
  void host(token, "nativeModel.hostStream", { callbackId, model: { provider: model.provider, id: model.id }, context, options: portable, requestHeaders, simple }, {
    signal: options?.signal,
    onEvent: (event) => result.push(event)
  }).then(({ message }) => result.end(message)).catch((error) => {
    const message = { role: "assistant", content: [], provider: model.provider, model: model.id, api: model.api,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: options?.signal?.aborted ? "aborted" : "error", errorMessage: error.message, timestamp: Date.now() };
    result.push({ type: "error", reason: message.stopReason, error: message });
    result.end(message);
  }).finally(() => modelCallbacks.delete(callbackId));
  return result;
}

function saveState(path, state) {
  writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

async function run(input, signal) {
  const { hostToken: token, snapshot, agentDir } = input;
  const statePath = join(agentDir, "state.json");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : undefined;
  if (previous?.status === "running" || previous?.requiresReview) throw new Error("The previous native Pi task did not complete. Its effects must be checked before continuing this context.");
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, cacheWarming: { enabled: false }, quietStartup: true, theme: "dark", tuiMode: "fullscreen", compaction: { enabled: false } });
  const baseModelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), refreshOnCreate: false });
  const bridges = new Map();
  const models = [...new Map([...(snapshot.availableModels ?? []), ...(snapshot.scopedModels ?? []).map((entry) => entry.model), snapshot.model]
    .filter(Boolean).map(model => [`${model.provider}\0${model.id}`, model])).values()];
  if (!models.length) throw new Error("A configured host model is required for native Pi execution.");
  for (const provider of new Set(models.map((model) => model.provider))) {
    const bridge = createProvider({ id: provider, models: models.filter((model) => model.provider === provider),
      auth: { apiKey: { name: "Molibot host", resolve: async () => ({ auth: {} }) } },
      api: { stream: (model, context, options) => stream(token, model, context, options, false), streamSimple: (model, context, options) => stream(token, model, context, options, true) }
    });
    baseModelRuntime.registerNativeProvider(bridge);
    bridges.set(provider, bridge);
  }
  const modelRuntime = ownedNativeModelRuntime(baseModelRuntime, bridges, (method, value) => host(token, method, value, { signal }));
  const customTools = input.tools.map((tool) => ({ ...tool, async execute(id, args, callSignal, onUpdate) {
    const outcome = await host(token, "executeTool", { toolName: tool.name, args }, { signal: callSignal, onEvent: onUpdate });
    if (outcome.result?.terminate) throw new Error("Host execution is suspended for approval; return to the Molibot conversation.");
    if (outcome.isError) throw new Error(outcome.result?.error ?? outcome.result?.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "Host tool failed.");
    return outcome.result;
  }}));
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
      noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: input.extensionPaths,
      extensionFactories: [{ name: "molibot-host-shell", factory: (pi) => {
        pi.on("user_bash", async (event) => {
          const outcome = await host(token, "executeTool", { toolName: "bash", args: { label: "Pi terminal command", command: event.command } }, { signal });
          if (outcome.result?.terminate) throw new Error("Host approval suspended the native task.");
          if (outcome.isError) throw new Error("Host shell command failed.");
          return { result: { output: outcome.result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), exitCode: typeof outcome.result.details?.exitCode === "number" ? outcome.result.details.exitCode : undefined, cancelled: signal.aborted, truncated: Boolean(outcome.result.details?.truncation) } };
        });
      }}],
      extensionsOverride: (loaded) => {
        for (const [name, value] of Object.entries(input.flags ?? {})) loaded.runtime.flagValues.set(name, value);
        loaded.extensions.sort((a, b) => Number(b.path === "<inline:molibot-host-shell>") - Number(a.path === "<inline:molibot-host-shell>"));
        return loaded;
      },
      systemPrompt: snapshot.systemPrompt });
    await resourceLoader.reload();
    const loaded = resourceLoader.getExtensions();
    const errors = loaded.errors;
    if (errors.length) throw new Error(`Native Pi extension load failed: ${errors.map((entry) => entry.error).join("; ")}`);
    const created = await createAgentSession({ cwd, agentDir, resourceLoader, modelRuntime, settingsManager, sessionManager, sessionStartEvent,
      model: snapshot.model, thinkingLevel: snapshot.thinkingLevel ?? "off", scopedModels: snapshot.scopedModels, noTools: "builtin", customTools,
      excludeTools: ["read", "bash", "edit", "write", "find", "grep", "ls", "powershell"].filter((name) => !customTools.some((tool) => tool.name === name)) });
    const bindExtensions = created.session.bindExtensions.bind(created.session);
    created.session.bindExtensions = (bindings) => bindExtensions({ ...bindings, uiContext: guardInteractiveUI(bindings.uiContext, token) });
    return { ...created, services: { cwd, agentDir, resourceLoader, modelRuntime, settingsManager, diagnostics: [] }, diagnostics: [] };
  };
  const sessionManager = previous?.sessionFile && existsSync(previous.sessionFile)
    ? SessionManager.open(previous.sessionFile, join(agentDir, "sessions"), snapshot.cwd)
    : SessionManager.create(snapshot.cwd, join(agentDir, "sessions"));
  const created = await createRuntime({ cwd: snapshot.cwd, sessionManager });
  runtime = new AgentSessionRuntime(created.session, created.services, createRuntime);
  terminal = new PiExtensionTerminal((data) => { void host(token, "terminal.write", { data }).catch(() => {}); }, input.columns ?? 100, input.rows ?? 30);
  mode = new InteractiveMode(runtime, { terminal, tuiMode: "fullscreen" });
  saveState(statePath, { status: "running", sessionFile: sessionManager.getSessionFile() });
  const stop = () => { void runtime.session.abort(); };
  signal.addEventListener("abort", stop, { once: true });
  let completedState;
  try {
    signal.throwIfAborted();
    await mode.init();
    // init() binds all native extension UI and shortcut handlers before prompting.
    const disposition = await runtime.session.prompt(input.prompt);
    await runtime.session.waitForIdle();
    signal.throwIfAborted();
    const text = disposition === "handled" ? "" : runtime.session.getLastAssistantText() ?? "";
    const last = [...runtime.session.messages].reverse().find((message) => message.role === "assistant");
    if (disposition !== "handled" && (last?.stopReason === "error" || last?.stopReason === "aborted")) throw new Error(last.errorMessage ?? `Native Pi ended with ${last.stopReason}.`);
    completedState = { status: "completed", sessionFile: runtime.session.sessionFile };
    return { text, sessionId: runtime.session.sessionId };
  } catch (error) {
    if (!signal.aborted) saveState(statePath, { status: "failed", requiresReview: true, sessionFile: runtime.session.sessionFile });
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    mode.stop();
    await runtime.dispose();
    signal.throwIfAborted();
    if (completedState) saveState(statePath, completedState);
    terminal.stop();
    mode = undefined;
    runtime = undefined;
  }
}

process.on("message", async (message) => {
  if (message.kind === "hostEvent") { pending.get(message.id)?.onEvent?.(message.event); return; }
  if (message.kind === "hostResponse") {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.cleanup?.();
    if (message.ok) request.resolve(message.value); else request.reject(new Error(message.error?.message ?? "Host operation failed."));
    return;
  }
  if (message.kind === "cancelInvocation") { abort?.abort(new Error("Native Pi execution stopped.")); return; }
  if (message.kind !== "request") return;
  try {
    let value;
    if (message.method === "nativeRun") { abort = new AbortController(); value = await run(message.input, abort.signal); }
    else if (message.method === "nativeModelCallback") {
      const callbacks = modelCallbacks.get(message.input.callbackId);
      if (!callbacks) throw new Error("The native model request has ended.");
      if (!["onPayload", "onResponse", "onProviderStreamEvent"].includes(message.input.method)) throw new Error("Invalid native model callback.");
      const callback = callbacks[message.input.method];
      value = typeof callback === "function" ? await callback(message.input.value, message.input.model) : undefined;
    }
    else if (message.method === "terminalInput") terminal?.input(message.input.data);
    else if (message.method === "terminalResize") terminal?.resize(message.input.columns, message.input.rows);
    else throw new Error("Unknown native Pi operation.");
    send({ kind: "response", id: message.id, ok: true, value });
  } catch (error) {
    send({ kind: "response", id: message.id, ok: false, error: { name: error.name, message: error.message } });
  }
});
process.on("disconnect", () => process.exit(0));
