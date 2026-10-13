import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ModelOperations } from "./modelOperations.js";

/** Model requests are owned native tools, including their policy decision and committed result. */
export function createOwnedModelOperations(base: ModelOperations, options: {
  wrap(tool: AgentTool<any>): AgentTool<any>;
  invoke(tool: AgentTool<any>, id: string, args: unknown, signal: AbortSignal): Promise<{ result: AgentToolResult<unknown>; isError: boolean }>;
}): { models: ModelOperations; tools: AgentTool<any>[] } {
  const schemas = {
    classify: Type.Object({ model: Type.Optional(Type.String()), state: Type.Record(Type.String(), Type.Any()), questions: Type.Record(Type.String(), Type.Any()) }, { additionalProperties: false }),
    generateImages: Type.Object({ model: Type.Optional(Type.String()), prompt: Type.String({ minLength: 1 }), images: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false })
  };
  const tools = (["classify", "generateImages"] as const).map(operation => options.wrap({
    name: operation === "classify" ? "modelsClassify" : "modelsGenerateImages",
    label: operation === "classify" ? "Classify with a model" : "Generate images",
    description: "Call the selected configured model. Remote execution may incur charges.",
    parameters: schemas[operation],
    replay: "safe",
    classification: { risk: "medium", source: "builtin", effect: "network" },
    async execute(id: string, args: any, signal?: AbortSignal) {
      const value = operation === "classify" ? await base.classify(args, signal, id) : await base.generateImages(args, signal, id);
      return { content: [{ type: "text" as const, text: operation === "classify" ? "Classification completed." : "Images saved." }], details: { modelResult: value } };
    }
  } as AgentTool<any>));
  async function invoke(operation: "classify" | "generateImages", args: unknown, signal?: AbortSignal, id: string = randomUUID()): Promise<any> {
    const outcome = await options.invoke(tools[operation === "classify" ? 0 : 1]!, id, args, signal ?? new AbortController().signal);
    const result = outcome.result as AgentToolResult<any> & { terminate?: boolean };
    if (result.terminate) {
      const error = new Error(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"));
      Object.assign(error, { suspendedResult: result });
      throw error;
    }
    if (outcome.isError) throw new Error(result.content.filter(block => block.type === "text").map(block => block.text).join("\n"));
    return result.details.modelResult;
  }
  return { tools, models: { catalog: () => base.catalog(), classify: (args, signal, id) => invoke("classify", args, signal, id), generateImages: (args, signal, id) => invoke("generateImages", args, signal, id) } };
}

/** Streaming uses the same native ownership; events are transient and the final message is committed. */
export function createOwnedModelStream(stream: import("$lib/server/plugins/piExtensions/toolBridge.js").PiExtensionToolOptions["streamModel"], options: {
  wrap(tool: AgentTool<any>): AgentTool<any>;
  invoke(tool: AgentTool<any>, id: string, args: unknown, signal: AbortSignal): Promise<{ result: AgentToolResult<unknown>; isError: boolean }>;
}) {
  const sinks = new Map<string, (event: unknown) => void>();
  const tool = options.wrap({ name: "modelsStream", label: "Chat with a model", description: "Stream a configured chat model; remote execution may incur charges.",
    parameters: Type.Object({ model: Type.Object({ provider: Type.String(), id: Type.String() }), context: Type.Any(), options: Type.Optional(Type.Any()), simple: Type.Boolean(), callId: Type.Optional(Type.String()) }),
    replay: "safe",
    classification: { risk: "medium", source: "builtin", effect: "network" },
    async execute(id: string, args: any, signal?: AbortSignal) {
      const value = await stream!(args, sinks.get(id) ?? (() => undefined), signal ?? new AbortController().signal);
      return { content: [{ type: "text" as const, text: "Model stream completed." }], details: { modelResult: value } };
    }
  } as AgentTool<any>);
  return { tool, stream: async (input: import("$lib/server/plugins/piExtensions/toolBridge.js").PiExtensionStreamInput, emit: (event: unknown) => void, signal: AbortSignal) => {
    const id = input.callId ?? randomUUID();
    sinks.set(id, emit);
    try {
      const outcome = await options.invoke(tool, id, input, signal);
      if (outcome.isError || (outcome.result as any).terminate) {
        const error = new Error(outcome.result.content.filter(block => block.type === "text").map(block => block.text).join("\n"));
        if ((outcome.result as any).terminate) Object.assign(error, { suspendedResult: outcome.result });
        throw error;
      }
      return (outcome.result.details as any).modelResult;
    } finally { sinks.delete(id); }
  } };
}
