import { createModels, Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

/** Execute tests with real native task documents rather than a mock journal. */
export function inCodemodeSession(tool: AgentTool<any>, directory: string, nativeTools: readonly AgentTool<any>[] = []): AgentTool<any> {
  return { ...tool, execute: async (id, args, signal, onUpdate) => {
    const { PiConversationRuntime } = await import("../../durable/piConversation.js");
    const path = await mkdtemp(join(directory, "native-"));
    const model = { api: "openai-completions" as const, provider: "fixture", id: "fixture", name: "Fixture", baseUrl: "http://fixture.invalid",
      reasoning: false, input: ["text" as const], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const models = createModels();
    const unusedStream = () => { throw new Error("The tool fixture must not call a model."); };
    models.setProvider({ id: "fixture", name: "Fixture", getModels: () => [model], stream: unusedStream, streamSimple: unusedStream,
      auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } } });
    let result: Awaited<ReturnType<typeof tool.execute>> | undefined;
    const entry: AgentTool<any> = { name: "fixture_entry", label: "Fixture", description: "Fixture", parameters: Type.Object({}),
      execute: async () => {
        result = await tool.execute(id, args, signal, onUpdate);
        return result;
      } };
    const runtime = new PiConversationRuntime({ storagePath: join(path, "pi.sqlite"), models,
      scope: { ownerId: "fixture", executionId: "fixture", stepId: "fixture", planVersion: 1, authorityKey: "fixture" },
      model: { provider: "fixture", modelId: "fixture" }, instructions: "Fixture", tools: [entry, ...nativeTools], assertStorageOwnership: () => {}, assertAuthority: () => {} });
    try {
      await runtime.open({ requestId: id, content: "Fixture" });
      await runtime.runToolCall({ name: entry.name, args: {} });
      if (!result) throw new Error("Codemode fixture did not execute.");
      return result;
    } finally { await runtime.close(); }
  } };
}
