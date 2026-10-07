import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { AgentMessage, AgentEvent, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

export interface NativeChildOptions {
  key: string;
  model: Model<any>;
  allowedModels?: readonly Model<any>[];
  thinkingLevel?: ThinkingLevel;
  instructions: string;
  tools: readonly string[];
  readOnlyShell: boolean;
  deadlineMs?: number;
}
export interface NativeChildSession {
  state: { messages: AgentMessage[]; runtimeStop?: { kind: "budget_exceeded" | "timeout" | "execution_error" | "length_exceeded"; reason: string }; usage?: import("@earendil-works/pi-ai").Usage; budget?: import("$lib/server/agent/core/runtimeBudget.js").RunBudgetSnapshot };
  model: Model<any>;
  sessionId: string;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}
export interface NativeInvocation {
  api: ToolExecutionApi;
  context: Context;
  child(options: NativeChildOptions): Promise<NativeChildSession>;
  nested(tool: import("@earendil-works/pi-agent-core").AgentTool, id: string, args: unknown): Promise<{ result: import("@earendil-works/pi-agent-core").AgentToolResult<unknown>; isError: boolean }>;
}
const invocation = new AsyncLocalStorage<NativeInvocation>();
export const currentPiInvocation = (): NativeInvocation | undefined => invocation.getStore();
export function withPiInvocation<T>(value: NativeInvocation, work: () => Promise<T>): Promise<T> {
  return invocation.run(value, work);
}
