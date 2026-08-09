import { readFileSync } from "node:fs";
import path from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

let extensions = [];
let extensionRuntime = null;

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

function unsupported(id, capability) {
  return new Proxy({}, { get(_target, property) { throw new Error(`pi extension "${id}" used unsupported ${capability}.${String(property)}.`); } });
}

function context(id, input, notifications) {
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
    cwd: input.cwd,
    sessionManager: unsupported(id, "ctx.sessionManager"),
    modelRegistry: unsupported(id, "ctx.modelRegistry"),
    model: undefined,
    isIdle: () => false,
    isProjectTrusted: () => true,
    signal: new AbortController().signal,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => input.systemPrompt ?? ""
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
  if (message?.kind !== "request") return;
  void dispatch(message).then(
    (value) => send({ kind: "response", id: message.id, ok: true, value }),
    (error) => send({ kind: "response", id: message.id, ok: false, error: errorPayload(error) })
  );
});
process.on("disconnect", () => process.exit(0));
