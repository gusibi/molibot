let runtime = null;
let badge = null;
let nextHostCallId = 1;
const pendingHostCalls = new Map();

function send(message) {
  if (process.connected) process.send(message);
}

function errorPayload(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };
}

function callHost(method, input) {
  const id = nextHostCallId++;
  return new Promise((resolve, reject) => {
    pendingHostCalls.set(id, { resolve, reject });
    send({ kind: "host_call", id, method, input });
  });
}

function logger(level, event, detail) {
  send({ kind: "log", level, event, detail });
}

async function initialize(input) {
  const loaded = await import(input.moduleUrl);
  if (typeof loaded?.default !== "function") {
    throw new Error("runtime.entry must default-export a factory function.");
  }
  runtime = await loaded.default({
    appId: input.appId,
    dataDir: input.dataDir,
    logger: {
      info: (event, detail) => logger("info", event, detail),
      warn: (event, detail) => logger("warn", event, detail),
      error: (event, detail) => logger("error", event, detail)
    },
    badge: {
      set: (value) => { badge = value; send({ kind: "badge", value }); },
      get: () => badge,
      clear: () => { badge = null; send({ kind: "badge", value: null }); }
    },
    ai: {
      generateText: (request) => callHost("ai.generateText", { ...request, signal: undefined }),
      transcribe: (request) => callHost("ai.transcribe", { ...request, signal: undefined })
    }
  });
  if (!runtime || typeof runtime !== "object") throw new Error("runtime factory did not return a runtime object.");
  if (typeof runtime.handleHttp !== "function") throw new Error("runtime must provide handleHttp().");
  const provided = Object.keys(runtime.tools ?? {});
  const missing = input.toolNames.filter((name) => !provided.includes(name));
  const extra = provided.filter((name) => !input.toolNames.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`Tool handlers do not match the manifest.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Undeclared: ${extra.join(", ")}.` : ""}`);
  }
  return { ready: true };
}

async function dispatch(message) {
  if (message.method === "init") return initialize(message.input);
  if (!runtime) throw new Error("Mini App runtime is not initialized.");
  if (message.method === "invokeTool") {
    const handler = runtime.tools?.[message.input.toolName];
    if (typeof handler !== "function") throw new Error(`Missing tool handler: ${message.input.toolName}`);
    return handler(message.input.input, { toolCallId: message.input.toolCallId });
  }
  if (message.method === "handleHttp") return runtime.handleHttp(message.input);
  if (message.method === "dispose") {
    await runtime.dispose?.();
    runtime = null;
    return null;
  }
  throw new Error(`Unknown Mini App worker method: ${message.method}`);
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.kind === "host_result") {
    const pending = pendingHostCalls.get(message.id);
    if (!pending) return;
    pendingHostCalls.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(Object.assign(new Error(message.error?.message ?? "Host call failed."), message.error));
    return;
  }
  if (message.kind !== "request") return;
  void dispatch(message).then(
    (value) => send({ kind: "response", id: message.id, ok: true, value }),
    (error) => send({ kind: "response", id: message.id, ok: false, error: errorPayload(error) })
  );
});

process.on("disconnect", () => process.exit(0));

