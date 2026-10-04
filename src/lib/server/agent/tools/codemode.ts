import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

const schema = Type.Object({ code: Type.String() });

type NestedResult = { result: AgentToolResult<unknown>; isError: boolean };
interface CodemodeOptions {
  getTools(): AgentTool<any>[];
  invoke(tool: AgentTool<any>, id: string, args: unknown, signal: AbortSignal): Promise<NestedResult>;
  artifactDir: string;
  workspaceDir: string;
}

/** The VM has no host I/O; every external operation re-enters the tool dispatcher. */
export function createCodemodeTool(options: CodemodeOptions): AgentTool<typeof schema> {
  return {
    name: "codemode", label: "Codemode",
    description: "Run bounded JavaScript using await tools.<name>(args), ALL_TOOLS, searchTools(query), describeTool(name), text(value), and return. Tools return their result object with content and details. No direct files, network, Node, credentials, timers, models or nested Codemode. Parallelize independent reads with Promise.all; await every operation. Failed scripts keep partial output; completed operations are not rolled back. A suspended script cannot be replayed: use its receipts to plan remaining work. Optional first line: // @options: {\"timeout_ms\":60000,\"max_output_tokens\":2000}. store/load values are local to this execution.",
    parameters: schema,
    // Only nested calls act on the host; each has its own permission boundary.
    classification: { risk: "low", source: "builtin", effect: "read" },
    async execute(toolCallId, params, signal) {
      signal?.throwIfAborted();
      const parsed = parseCodemodeSource(params.code);
      const timeoutMs = Math.min(parsed.options.timeoutMs ?? 60_000, 300_000);
      const maxChars = Math.min(parsed.options.maxOutputTokens ?? 2_000, 8_000) * 4;
      const catalog = options.getTools().filter(tool => tool.name !== "codemode");
      const calls = new Map<number, { controller: AbortController; promise: Promise<void> }>();
      const invocationIds: string[] = [];
      let terminal = false;
      let suspension: Record<string, any> | undefined;
      const outputName = `codemode-${createHash("sha256").update(toolCallId).digest("hex").slice(0, 24)}.txt`;
      await mkdir(options.artifactDir, { recursive: true });
      const outputPath = join(options.artifactDir, outputName);
      const outputRef = relative(options.workspaceDir, outputPath);
      const child = fork(join(process.env.MOLIBOT_APP_ROOT?.trim() || process.cwd(), "scripts/runtime/codemode-worker.mjs"), [], {
        execArgv: ["--max-old-space-size=128"], serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }
      });
      let finish!: (value: any) => void;
      const completed = new Promise<any>(resolve => { finish = resolve; });
      let requestedStop: any;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finalize = (result: any) => { child.kill("SIGKILL"); finish(result); };
      const stop = (result: any, preserveOutput = false) => {
        if (terminal) return;
        terminal = true;
        for (const call of calls.values()) call.controller.abort();
        if (preserveOutput && child.connected) {
          requestedStop = result;
          child.send({ kind: "abort" });
          forceTimer = setTimeout(() => finalize(result), 2_000);
        } else finalize(result);
      };
      const abort = () => stop({ ok: false, errorKind: "aborted", text: "Codemode cancelled. Completed tool operations were not rolled back." }, true);
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => stop({ ok: false, errorKind: "timeout", text: "Codemode deadline exceeded. Completed tool operations were not rolled back." }, true), timeoutMs + 2_000);
      child.on("error", error => stop({ ok: false, errorKind: "sandbox", text: error.message }));
      child.on("exit", () => requestedStop ? finalize(requestedStop) : stop({ ok: false, errorKind: "sandbox", text: "Codemode process exited without a result. Inspect completed tool receipts before replanning." }));
      child.on("message", (message: any) => {
        if (message.kind === "result" && requestedStop) {
          finalize({ ...message, ...requestedStop, text: [message.text, requestedStop.text].filter(Boolean).join("\n") });
          return;
        }
        if (terminal) return;
        if (message.kind === "result") { stop(message); return; }
        if (message.kind === "cancel") { calls.get(message.id)?.controller.abort(); return; }
        if (message.kind !== "call") return;
        const controller = new AbortController();
        const id = `${toolCallId}:codemode:${message.id}`;
        invocationIds.push(id);
        const promise = (async () => {
          try {
            const tool = catalog.find(tool => tool.name === message.name);
            if (!tool || tool.name === "codemode") throw new Error("Tool is not available to this script.");
            const outcome = await options.invoke(tool, id, message.args, controller.signal);
            const result = outcome.result as AgentToolResult<unknown> & { terminate?: boolean; error?: string; metadata?: Record<string, unknown> };
            if (result.terminate) {
              suspension = { details: result.details, metadata: result.metadata };
              const reason = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
              stop({ ok: false, text: `${reason}\nCodemode stopped. Completed receipts are retained. Do not replay this script; replan only the remaining operations.` }, true);
              return;
            }
            if (outcome.isError || result.error) throw new Error(result.error || result.content.filter(block => block.type === "text").map(block => block.text).join("\n") || "Tool call failed.");
            if (!terminal && child.connected) child.send({ kind: "reply", id: message.id, value: result });
          } catch (error) {
            if (!terminal && child.connected) child.send({ kind: "reply", id: message.id, error: error instanceof Error ? error.message : String(error) });
          }
        })();
        calls.set(message.id, { controller, promise });
      });
      const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
      try {
        child.send({ kind: "execute", code: parsed.code, timeoutMs, maxChars, outputPath, outputRef,
          tools: catalog.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) });
        if (signal?.aborted) abort();
        const result = await completed;
        await Promise.allSettled([...calls.values()].map(call => call.promise));
        await exited;
        return { content: [{ type: "text", text: result.text || "Script completed." }],
          details: { ...suspension?.details, invocationIds, calls: result.calls ?? [], errorKind: result.errorKind,
            ...(result.truncated ? { outputRef } : {}), requiresReplan: !result.ok },
          ...(suspension ? { terminate: true, metadata: suspension.metadata } : {}),
          ...(!result.ok ? { error: result.text || "Codemode failed." } : {}) };
      } finally {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        signal?.removeEventListener("abort", abort);
        if (!terminal) abort();
      }
    }
  } as AgentTool<typeof schema>;
}
