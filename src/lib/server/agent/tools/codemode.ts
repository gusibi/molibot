import { mkdir, mkdtemp } from "node:fs/promises";
import { join, relative } from "node:path";
import { Type } from "@sinclair/typebox";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import type { ToolExecutionApi, NestedToolExecutionResult } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { ModelOperations } from "$lib/server/agent/models/modelOperations.js";
import { currentPiInvocation } from "$lib/server/agent/durable/piInvocation.js";

interface CodemodeOptions {
  getTools(): AgentTool<any>[];
  invoke(tool: AgentTool<any>, id: string, args: unknown, signal: AbortSignal): Promise<{ result: AgentToolResult<unknown>; isError: boolean }>;
  artifactDir: string;
  workspaceDir: string;
  models?: ModelOperations;
  modelCatalog?: Models;
}

const INLINE_IMAGE_MAX_BASE64 = 700_000;

/** Oversized image bytes stay in artifacts, outside the model context. */
export function inlineOrReferenceImages(images: Array<{ type: "image"; ref?: string; data: string; mimeType: string }>): AgentToolResult<unknown>["content"] {
  return images.map(block => block.data.length <= INLINE_IMAGE_MAX_BASE64
    ? { type: "image", data: block.data, mimeType: block.mimeType }
    : { type: "text", text: `[Generated image too large to inline (${block.mimeType}); saved to this run's workspace artifacts${block.ref ? `: ${block.ref}` : ""}.]` });
}

/** Official Codemode owns execution, discovery, store and journals; the host owns effects and artifacts. */
export function createCodemodeTool(options: CodemodeOptions): AgentTool<any> {
  // No VM exists until execute(). The official sandbox owns its worker lifecycle.
  const createOfficial = (sandbox: CodemodeSandbox) => createCodemodeExtension({ sandbox, models: Boolean(options.models) });
  const declaration = createOfficial(new CodemodeSandbox()).tools!.find(tool => tool.name === "codemode")!;
  return {
    name: declaration.name, label: "Codemode", description: declaration.description,
    constrainedSampling: declaration.constrainedSampling,
    outputLimits: declaration.outputLimits,
    parameters: declaration.parameters as AgentTool<any>["parameters"],
    replay: "safe",
    classification: { risk: "low", source: "builtin", effect: "read" },
    async execute(toolCallId, params, signal) {
      signal?.throwIfAborted();
      const invocation = currentPiInvocation();
      if (!invocation) throw new Error("Codemode requires an active native execution owner.");
      const { api, context } = invocation;
      const sandbox = new CodemodeSandbox({ memoryLimitBytes: 64 * 1024 * 1024, timeoutMs: 300_000 });
      const extension = createOfficial(sandbox);
      const official = extension.tools!.find(tool => tool.name === "codemode")!;
      const modelTools = extension.tools!.filter(tool => tool.name !== "codemode");
      let partialOutput: AgentToolResult<unknown>["content"] = [];
      const start = sandbox.start.bind(sandbox);
      sandbox.start = (source, runOptions) => {
        const run = start(source, { ...runOptions, timeoutMs: Math.min(runOptions?.timeoutMs ?? 300_000, 300_000) });
        void run.result.then(result => { partialOutput = result.output.filter(block => block.type === "text" || block.type === "image") as typeof partialOutput; }).catch(() => {});
        return run;
      };
      const controller = new AbortController();
      const ownedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const ownedContext = { ...context, abortSignal: ownedSignal };
      const tools = options.getTools().filter(tool => tool.name !== "codemode");
      const pending = new Set<Promise<unknown>>();
      const invocationIds: string[] = [];
      const imageRefs = new Map<string, string>();
      let suspension: (AgentToolResult<unknown> & { metadata?: Record<string, unknown> }) | undefined;
      const env = new NodeExecutionEnv({ cwd: options.workspaceDir });
      // The formatter writes only into this run's scratch directory.
      env.createTempDir = async prefix => {
        await mkdir(options.artifactDir, { recursive: true });
        return { ok: true, value: await mkdtemp(join(options.artifactDir, prefix ?? "pi-codemode-")) };
      };
      const bridge: ToolExecutionApi = {
        ...api, env,
        agent: async ctx => ({ ...await api.agent(ctx), callable: [
          ...tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters, structuredOutputSchema: Type.Any() })),
          ...modelTools
        ] } as Awaited<ReturnType<ToolExecutionApi["agent"]>>),
        models: options.modelCatalog ?? api.models,
        executeTool: (name, args, _ctx, nested) => {
          const id = `${toolCallId}:codemode:${nested?.key?.replace(/^c/, "")}`;
          invocationIds.push(id);
          const work = (async (): Promise<NestedToolExecutionResult> => {
            ownedSignal.throwIfAborted();
            const tool = tools.find(tool => tool.name === name);
            const modelTool = modelTools.find(tool => tool.name === name);
            if (modelTool && options.models) {
              // Keep official model argument validation and results, but route paid calls
              // through the host's owned model tools for approval, budget and media usage.
              const models = new Proxy(bridge.models, { get(target, key) {
                if (key === "classify") return async (model: { provider: string; id: string }, input: any) => {
                  if (input.images?.length) throw new Error("Classifier reference images are not supported by this host.");
                  const value = await options.models!.classify({ model: `classifier|${model.provider}|${model.id}`, state: input.state, questions: input.questions }, ownedSignal, id);
                  return { ...value, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now() };
                };
                if (key === "generateImages") return async (model: { provider: string; id: string }, input: any) => {
                  const value = await options.models!.generateImages({ model: `image|${model.provider}|${model.id}`,
                    prompt: input.input.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n"),
                    images: input.input.filter((block: any) => block.type === "image").map((block: any) => `data:${block.mimeType};base64,${block.data}`) }, ownedSignal, id);
                  for (const image of value.images) imageRefs.set(image.data.replace(/\s+/g, ""), image.ref);
                  return { provider: model.provider, model: model.id, output: [...(value.text ? [{ type: "text", text: value.text }] : []), ...value.images], usage: value.usage, stopReason: "stop", timestamp: Date.now() };
                };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              } });
              const value = await modelTool.execute!(args, { ...bridge, models }, ownedContext);
              return { taskId: api.taskId, structuredOutput: value.structuredOutput, isError: Boolean(value.isError), diagnostics: value.diagnostics ?? [] };
            }
            if (!tool) throw new Error("Tool is not available to this script.");
            const outcome = await options.invoke(tool, id, args, ownedSignal);
            const result = outcome.result as AgentToolResult<unknown> & { terminate?: boolean; error?: string; metadata?: Record<string, unknown> };
            if (result.terminate) {
              suspension = result;
              controller.abort(new Error("Codemode awaits a decision."));
              throw new Error("Codemode awaits a decision.");
            }
            const isError = outcome.isError || Boolean(result.error);
            const error = result.error || result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
            return { taskId: api.taskId, ...(!isError ? { structuredOutput: JSON.parse(JSON.stringify(result)) as JsonValue } : {}),
              isError, diagnostics: isError ? [{ severity: "error", message: error || "Tool call failed." }] : [] };
          })().catch(error => {
            const suspended = (error as { suspendedResult?: typeof suspension }).suspendedResult;
            if (suspended) { suspension = suspended; controller.abort(error); }
            if (ownedSignal.aborted) throw error;
            return { taskId: api.taskId, isError: true, diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : String(error) }] } satisfies NestedToolExecutionResult;
          });
          pending.add(work);
          void work.finally(() => pending.delete(work)).catch(() => {});
          return work;
        }
      };
      try {
        const result = await official.execute!(params, bridge, ownedContext);
        const content = (result.output ?? []).flatMap(block => block.type === "image"
          ? inlineOrReferenceImages([{ ...block, ref: imageRefs.get(block.data.replace(/\s+/g, "")) }])
          : [{ ...block, text: block.text.split(`${options.workspaceDir}/`).join("") }]);
        const details = result.details as Record<string, JsonValue> | undefined;
        const fullOutputPath = typeof details?.fullOutputPath === "string" ? details.fullOutputPath : undefined;
        return { content, details: { ...details, invocationIds, ...(fullOutputPath ? { outputRef: relative(options.workspaceDir, fullOutputPath) } : {}), requiresReplan: Boolean(result.isError) },
          ...(result.isError ? { error: content.filter(block => block.type === "text").map(block => block.text).join("\n"), isError: true } : {}) };
      } catch (error) {
        let remaining = 8000;
        const partial = partialOutput.flatMap(block => block.type === "image"
          ? inlineOrReferenceImages([{ ...block, ref: imageRefs.get(block.data.replace(/\s+/g, "")) }])
          : (() => {
              const text = block.text.slice(0, remaining);
              remaining -= text.length;
              return text ? [{ type: "text" as const, text }] : [];
            })());
        if (suspension) return { ...suspension, content: [...partial, ...suspension.content], terminate: true };
        if (ownedSignal.aborted) return { content: [...partial, { type: "text", text: "Codemode cancelled. Completed operations were not rolled back." }], details: { invocationIds, errorKind: "aborted", requiresReplan: true }, error: "Codemode cancelled." };
        throw error;
      } finally {
        controller.abort();
        await sandbox.close();
        await Promise.allSettled([...pending]);
      }
    }
  } as AgentTool<any>;
}
