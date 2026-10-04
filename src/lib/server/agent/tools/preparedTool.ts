import type { ToolCall } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolRuntime } from "./toolRuntime.js";
import type { ToolExecutionContext, ToolResult } from "./toolTypes.js";

export type HostToolResult = AgentToolResult<unknown> & {
  error?: string;
  metadata?: Record<string, unknown>;
  terminate?: boolean;
};
export type PreparedAgentInvocation = { execute(): Promise<HostToolResult>; cancel(): void };
export type PreparedAgentTool = Omit<AgentTool, "execute"> & {
  execute: (...args: Parameters<AgentTool["execute"]>) => Promise<HostToolResult>;
  prepareInvocation: (id: string, args: unknown, signal?: AbortSignal, onUpdate?: (result: AgentToolResult<unknown>) => void, approvalRequestId?: string, preparationEffects?: ToolExecutionContext["preparationEffects"])
    => Promise<PreparedAgentInvocation | HostToolResult>;
};

function modelResult(result: ToolResult): HostToolResult {
  return {
    content: Array.isArray(result.content) ? result.content : [{ type: "text", text: String(result.content ?? result.error ?? "") }],
    error: result.ok ? undefined : result.error, isError: !result.ok,
    metadata: result.metadata, details: result.details, terminate: result.terminate, usage: result.usage
  };
}

/** Both direct dispatch and Pi's pre-intent hook consume the same authorized invocation. */
export function bindToolRuntime(
  tool: Omit<AgentTool, "execute">, runtime: ToolRuntime,
  buildContext: (signal: AbortSignal | undefined, id: string, onUpdate: ((result: AgentToolResult<unknown>) => void) | undefined, name: string) => ToolExecutionContext
): PreparedAgentTool {
  const prepareInvocation: PreparedAgentTool["prepareInvocation"] = async (id, args, signal, onUpdate, approvalRequestId, preparationEffects) => {
    let validated: unknown;
    try {
      validated = validateToolArguments(tool, { type: "toolCall", id, name: tool.name, arguments: args as ToolCall["arguments"] });
    } catch {
      return modelResult({ ok: false, error: `Invalid arguments for ${tool.name}: input failed tool schema validation. Correct the arguments before requesting approval or execution.` });
    }
    const prepared = await runtime.prepareToolCall({ toolId: tool.name, input: validated, context: { ...buildContext(signal, id, onUpdate, tool.name), resumeApprovalRequestId: approvalRequestId, preparationEffects } });
    return "execute" in prepared ? { cancel: () => prepared.cancel(), execute: async () => modelResult(await prepared.execute()) } : modelResult(prepared);
  };
  return { ...tool, prepareInvocation, execute: async (id, args, signal, onUpdate) => {
    const prepared = await prepareInvocation(id, args, signal, onUpdate);
    return "execute" in prepared ? prepared.execute() : prepared;
  } };
}

export function hasToolPreparation(tool: AgentTool): tool is PreparedAgentTool {
  return "prepareInvocation" in tool && typeof tool.prepareInvocation === "function";
}
