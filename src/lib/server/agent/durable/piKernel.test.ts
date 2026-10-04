import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModels, createAssistantMessageEventStream, Type, type Api, type AssistantMessage, type Message, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import { PiDurableKernel } from "./piKernel.js";
import type { PiDurableKernelOptions } from "./piKernel.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { DurableExecutionStore } from "./store.js";
import type { DurableAttemptHooks } from "$lib/server/agent/core/types.js";
import type { MomEvent } from "$lib/server/agent/events.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";

const model: Model<"openai-completions"> = {
  api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};

function fixtureModels(toolCall = { name: "sendReport", arguments: {} }) {
  const models = createModels();
  let requests = 0;
  models.setProvider({
    id: "fixture", name: "Fixture", getModels: () => [model],
    auth: { apiKey: { name: "Fixture key", resolve: async () => ({ auth: { apiKey: "fixture-key" } }) } },
    stream: stream, streamSimple: stream
  });
  function stream<T extends Api>(_model: Model<T>, context: TranscriptContext) {
    requests += 1;
    const stream = createAssistantMessageEventStream();
    const answer: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: context.messages.some((item) => item.role === "toolResult")
        ? [{ type: "text", text: "Report sent." }]
        : [{ type: "toolCall", id: "send-report", ...toolCall }],
      stopReason: context.messages.some((item) => item.role === "toolResult") ? "stop" : "toolUse",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    };
    stream.push({ type: "done", reason: answer.stopReason as "stop" | "toolUse", message: answer });
    stream.end();
    return stream;
  }
  return { models, requests: () => requests };
}

function kernelOptions(directory: string, send: () => void): PiDurableKernelOptions {
  return {
    storagePath: join(directory, "execution.sqlite"), models: fixtureModels().models,
    scope: { ownerId: "owner", executionId: "goal", stepId: "step", planVersion: 1, authorityKey: "manual" },
    model: { provider: "fixture", modelId: "fixture" }, instructions: "Send the approved report.",
    assertAuthority: () => undefined,
    assertStorageOwnership: () => undefined,
    tools: [{
      name: "sendReport", label: "Send report", description: "Send report", parameters: Type.Object({}),
      execute: async () => { send(); return { content: [{ type: "text", text: "sent" }], details: {} }; }
    }]
  };
}

test("committed entries repair interrupted Session projection without repeating execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-projection-"));
  try {
    let sends = 0;
    let failProjection = true;
    const options = kernelOptions(directory, () => { sends += 1; });
    const store = new MomRuntimeStore(join(directory, "workspace"));
    options.projectEntry = async (entry, sourceId) => {
      if (failProjection && entry.model?.[0]?.role === "toolResult") throw new Error("projection unavailable");
      for (const [index, message] of (entry.model ?? []).entries()) {
        store.appendContextMessage("chat", message, "session", { runId: "goal", sourceId: `${sourceId}:${index}` });
      }
    };
    await assert.rejects(new PiDurableKernel(options).run({ requestId: "request", text: "Send" }), /projection unavailable/);
    assert.equal(sends, 1);
    failProjection = false;
    const reopened = await new PiDurableKernel(options).run({ requestId: "request", text: "Send" });
    assert.equal(reopened.status, "completed");
    assert.equal(sends, 1);
    assert.deepEqual(store.loadContext("chat", "session"), reopened.messages);
    await new PiDurableKernel(options).run({ requestId: "request", text: "Send" });
    assert.equal(store.loadContext("chat", "session").length, reopened.messages.length);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("request-only controls reach the provider without becoming committed conversation entries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-controls-"));
  try {
    const options = kernelOptions(directory, () => undefined);
    const history: Message[] = [{ role: "user", content: "Prior real input", timestamp: 1 }];
    options.initialMessages = history;
    let requests = 0;
    options.beforeRequest = async messages => {
      requests += 1;
      assert.ok(messages.some(message => message.role === "user" && message.content === "Prior real input"));
      return [...messages, { role: "user", content: "TRANSIENT_CONTROL", timestamp: 2 }];
    };
    const result = await new PiDurableKernel(options).run({ requestId: "request", text: "Send" });
    assert.equal(result.status, "completed");
    assert.equal(requests, 2);
    assert.doesNotMatch(JSON.stringify(result.entries), /TRANSIENT_CONTROL/);
    assert.match(JSON.stringify(result.messages), /Prior real input/);
    options.initialMessages = [{ role: "user", timestamp: 1, content: "Different history" }];
    await assert.rejects(new PiDurableKernel(options).run({ requestId: "request", text: "Send" }), /binding differs/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("service ownership loss aborts in-flight tool work and rejects further dispatch", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-lease-loss-"));
  try {
    let owned = true;
    let cancelled = false;
    let executions = 0;
    const options = kernelOptions(directory, () => undefined);
    options.assertStorageOwnership = () => { if (!owned) throw new Error("service lease lost"); };
    options.tools = [{ ...options.tools[0], execute: async (_id, _args, signal) => {
      executions += 1;
      owned = false;
      assert.ok(signal);
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      cancelled = true;
      return { content: [{ type: "text", text: "Cancelled by ownership loss" }], details: {}, isError: true };
    } }];
    await assert.rejects(new PiDurableKernel(options).run({ requestId: "request", text: "Send" }), /service lease lost/);
    assert.equal(cancelled, true);
    assert.equal(executions, 1);
    await assert.rejects(new PiDurableKernel(options).run({ requestId: "request", text: "Send" }), /service lease lost/);
    assert.equal(executions, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("SIGKILL after deferred admission resumes the same remote handle without resubmission", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-deferred-"));
  const children: ReturnType<typeof fork>[] = [];
  const worker = (mode: string) => {
    const child = fork("evals/fixtures/pi-deferred-worker.ts", [], {
      execArgv: ["--import", "./scripts/register-loader.js", "--import", "tsx"],
      env: { ...process.env, DATA_DIR: directory, PI_DEFERRED_FIXTURE_MODE: mode },
      stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    children.push(child);
    return child;
  };
  try {
    const interrupted = worker("interrupt");
    const [barrier] = await once(interrupted, "message");
    assert.equal(barrier.type, "barrier", barrier.error);
    assert.equal(barrier.handle.id, "remote-job-42");
    const interruptedExit = once(interrupted, "exit");
    interrupted.kill("SIGKILL");
    await interruptedExit;
    for (let index = 0; index < 2; index += 1) {
      const resumed = worker("resume");
      const resumedExit = once(resumed, "exit");
      const [completion] = await once(resumed, "message");
      assert.equal(completion.type, "result", completion.error);
      assert.equal(completion.result.status, "completed", completion.result.error);
      const assistants = completion.result.messages.filter((message: Message) => message.role === "assistant");
      assert.equal(assistants.length, 1);
      assert.equal(assistants[0].usage.totalTokens, 2);
      await resumedExit;
    }
    const ledger = readFileSync(join(directory, "provider-ledger.txt"), "utf8").trim().split("\n");
    assert.equal(ledger.filter(line => line === "submit").length, 1);
    assert.equal(ledger.filter(line => line === "poll:remote-job-42").length, 2);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an answered logical request is reused after opening the same execution storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-kernel-"));
  try {
    const { models, requests } = fixtureModels();
    let sends = 0;
    const options = {
      storagePath: join(directory, "execution.sqlite"), models,
      scope: { ownerId: "owner", executionId: "goal", stepId: "step", planVersion: 1, authorityKey: "manual" },
      model: { provider: "fixture", modelId: "fixture" },
      instructions: "Send the approved report.",
      assertAuthority: () => undefined,
      assertStorageOwnership: () => undefined,
      tools: [{
        name: "sendReport", label: "Send report", description: "Send report", parameters: Type.Object({}),
        execute: async () => { sends += 1; return { content: [{ type: "text" as const, text: "sent" }], details: {} }; }
      }]
    };
    const first = await new PiDurableKernel(options).run({ requestId: "approved-goal-step", text: "Send report" });
    assert.equal(first.status, "completed", first.error);
    const requestCount = requests();
    const second = await new PiDurableKernel(options).run({ requestId: "approved-goal-step", text: "Send report" });
    assert.equal(second.status, "completed");
    assert.equal(second.submissionId, first.submissionId);
    assert.equal(sends, 1);
    assert.equal(requests(), requestCount, "reopening must not submit a new paid model request");
    assert.match(JSON.stringify(second.messages), /Report sent/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tool usage is committed with the result and reused without another paid call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-tool-usage-"));
  try {
    let paidCalls = 0;
    const options = kernelOptions(directory, () => undefined);
    const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
    options.tools = [{ ...options.tools[0], execute: async () => {
      paidCalls++;
      return { content: [{ type: "text", text: "sent" }], details: {}, usage };
    } }];
    const input = { requestId: "paid-report", text: "Send report" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await new PiDurableKernel(options).run(input);
      assert.equal(result.status, "completed");
      const receipts = result.messages.filter(message => message.role === "toolResult");
      assert.equal(receipts.length, 1);
      assert.deepEqual(receipts[0].usage, usage);
    }
    assert.equal(paidCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reopening cannot change the owner, authority, model or logical request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-authority-"));
  try {
    let sends = 0;
    const options = kernelOptions(directory, () => { sends += 1; });
    const input = { requestId: "approved-goal-step", text: "Send report" };
    assert.equal((await new PiDurableKernel(options).run(input)).status, "completed");
    for (const patch of [
      { scope: { ...options.scope, ownerId: "another-owner" } },
      { scope: { ...options.scope, authorityKey: "auto" } },
      { model: { provider: "fixture", modelId: "another-model" } }
    ]) {
      await assert.rejects(() => new PiDurableKernel({ ...options, ...patch }).run(input), /binding|pinned model/);
    }
    await assert.rejects(() => new PiDurableKernel(options).run({ ...input, text: "Send something else" }), /binding/);
    const reroutedModels = fixtureModels().models;
    reroutedModels.setProvider({
      ...reroutedModels.getProvider("fixture")!,
      getModels: () => [{ ...model, baseUrl: "http://another-provider.invalid" }]
    });
    await assert.rejects(() => new PiDurableKernel({ ...options, models: reroutedModels }).run(input), /binding/);
    assert.equal(sends, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approval is persisted before execution and the same tool call resumes after approval", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-approval-"));
  try {
    let sends = 0;
    let approved = false;
    let requestedCallId: string | undefined;
    const options = {
      ...kernelOptions(directory, () => { sends += 1; }),
      beforeTool: async (call: { id: string }) => {
        if (approved) {
          assert.equal(call.id, requestedCallId);
          return { kind: "allow" as const };
        }
        requestedCallId = call.id;
        return { kind: "wait" as const, requestId: "approval-1" };
      }
    };
    const input = { requestId: "approved-goal-step", text: "Send report" };
    const waiting = await new PiDurableKernel(options).run(input);
    assert.equal(waiting.status, "waiting_for_approval");
    assert.equal(waiting.approvalRequestId, "approval-1");
    assert.equal(sends, 0);
    approved = true;
    const completed = await new PiDurableKernel(options).run(input);
    assert.equal(completed.status, "completed");
    assert.equal(completed.submissionId, waiting.submissionId);
    assert.equal(sends, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const mode of ["after-committed-result", "unknown-side-effect"]) {
  test(`SIGKILL recovery: ${mode}`, { timeout: 15_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "molibot-pi-kill-"));
    const provider = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      appendFileSync(join(directory, "provider-ledger.txt"), "request\n");
      const sent = input.messages.some((message: { role: string; tool_call_id?: string }) => message.role === "tool" && message.tool_call_id === "send-call");
      const recorded = input.messages.some((message: { role: string; tool_call_id?: string }) => message.role === "tool" && message.tool_call_id === "record-call");
      const chunk = (delta: unknown, finish_reason: string | null) => ({
        id: "fixture-completion", object: "chat.completion.chunk", created: 1, model: "fixture",
        choices: [{ index: 0, delta, finish_reason }],
        usage: finish_reason ? { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } : undefined
      });
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify(chunk(recorded
        ? { role: "assistant", content: "Report delivered and recorded." }
        : { role: "assistant", tool_calls: [{ index: 0, id: sent ? "record-call" : "send-call", type: "function", function: { name: sent ? "writeRecord" : "sendReport", arguments: "{}" } }] }, null))}\n\n`);
      response.end(`data: ${JSON.stringify(chunk({}, recorded ? "stop" : "tool_calls"))}\n\ndata: [DONE]\n\n`);
    });
    const children: ReturnType<typeof fork>[] = [];
    let port: number;
    const worker = (mode: string) => {
      const child = fork("evals/fixtures/pi-durable-worker.ts", [], {
        execArgv: ["--import", "./scripts/register-loader.js", "--import", "tsx"],
        env: { ...process.env, DATA_DIR: directory, PI_KERNEL_FIXTURE_MODE: mode, PI_KERNEL_FIXTURE_BASE_URL: `http://127.0.0.1:${port}/v1` },
        stdio: ["ignore", "ignore", "pipe", "ipc"]
      });
      children.push(child);
      return child;
    };
    try {
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      port = (provider.address() as { port: number }).port;
      const interrupted = worker(mode);
      const [checkpoint] = await once(interrupted, "message");
      assert.equal(checkpoint.type, "barrier");
      const requestsBeforeResume = readFileSync(join(directory, "provider-ledger.txt"), "utf8");
      const exited = once(interrupted, "exit");
      interrupted.kill("SIGKILL");
      await exited;
      const resumed = worker("resume");
      const resumedExit = once(resumed, "exit");
      const [completion] = await once(resumed, "message");
      assert.equal(completion.type, "result", completion.error);
      assert.equal(completion.result.status, mode === "unknown-side-effect" ? "recovery_required" : "completed");
      await resumedExit;
      const actions = readFileSync(join(directory, "external-ledger.txt"), "utf8").trim().split("\n");
      assert.equal(actions.filter((action) => action === "send").length, 1);
      assert.equal(actions.filter((action) => action === "record").length, mode === "unknown-side-effect" ? 0 : 1);
      if (mode === "unknown-side-effect") {
        assert.equal(readFileSync(join(directory, "provider-ledger.txt"), "utf8"), requestsBeforeResume,
          "an uncertain external operation must block model continuation too");
      }
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("Stop aborts the active tool and reopening cannot turn it into success", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-stop-"));
  try {
    let started!: () => void;
    const toolStarted = new Promise<void>((resolve) => { started = resolve; });
    let observedAbort = false;
    const options = kernelOptions(directory, () => undefined);
    options.tools = [{
      ...options.tools[0],
      execute: async (_id, _args, signal) => {
        started();
        await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(signal.reason);
        }, { once: true }));
        return { content: [{ type: "text", text: "late success" }], details: {} };
      }
    }];
    const controller = new AbortController();
    const input = { requestId: "approved-goal-step", text: "Send report" };
    const running = new PiDurableKernel(options).run({ ...input, signal: controller.signal });
    await toolStarted;
    controller.abort();
    assert.equal((await running).status, "cancelled");
    assert.equal(observedAbort, true);
    const reopened = await new PiDurableKernel(options).run(input);
    assert.equal(reopened.status, "cancelled");
    assert.doesNotMatch(JSON.stringify(reopened.messages), /late success/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the shared Durable entrance retains approval, receipts and acceptance with Pi execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-business-"));
  const businessPath = join(directory, "business.sqlite");
  let store = new DurableExecutionStore(businessPath);
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", directory);
    const created = coordinator.create({
      ownerId: "owner", botId: "bot", sourceChannel: "web", sourceChatId: "web:owner:bot",
      goal: "Send the approved report", constraints: [], activationPath: "deterministic",
      steps: [{ title: "Send report", sideEffectClass: "non_idempotent" }],
      acceptanceCriteria: [{ description: "All steps complete", checkerType: "deterministic", checkerKey: "steps_completed" }]
    });
    coordinator.activate({ ownerId: "owner", executionId: created.execution.id, expectedVersion: created.execution.version });
    const kernelBase = kernelOptions(directory, () => undefined);
    let sends = 0;
    const createRuntime = () => new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: directory,
      channelManagers: new Map([["web", new Map([["bot", {
        runDurableAttempt: async (_message: unknown, hooks: DurableAttemptHooks) => {
          const stepId = store.getDetail(created.execution.id)!.steps[0].id;
          const result = await new PiDurableKernel({
            ...kernelBase,
            scope: { ...kernelBase.scope, executionId: created.execution.id, stepId },
            beforeTool: async () => {
              const approved = await hooks.consumeDurableApproval!({
                backend: "approval_broker", actionKey: "sendReport:report:ephemeral", toolId: "sendReport", command: "report"
              });
              if (approved) return { kind: "allow" };
              await hooks.onApprovalRequest!({
                requestId: "send-approval", backend: "approval_broker",
                prompt: {
                  type: "host_bash_approval", requestId: "send-approval",
                  title: "Approve send", body: "Send report",
                  request: {
                    toolId: "sendReport", displayName: "Send report", command: "report", args: [], approvalMode: "ephemeral",
                    reason: "External send requires approval", requestedAt: new Date().toISOString(),
                    permissions: { envAllowlist: [], filesystem: "none", network: "internet" }
                  },
                  options: [{ id: "approve_once", label: "Allow once", style: "primary" }]
                }
              });
              return { kind: "wait", requestId: "send-approval" };
            },
            tools: [{
              ...kernelBase.tools[0],
              execute: async (toolCallId) => {
                const effect = { toolId: "sendReport", toolCallId, sideEffectClass: "non_idempotent" as const,
                  idempotencyKey: "approved-report", targetSummary: "mail service", contentSummary: "send report" };
                await hooks.onToolSideEffectPreflight!(effect);
                sends += 1;
                await hooks.onToolSideEffectReceipt!(effect, { ok: true, content: "sent" });
                return { content: [{ type: "text", text: "sent" }], details: {} };
              }
            }]
          }).run({ requestId: "approved-report", text: "Send report" });
          return { result: { stopReason: result.status === "completed" ? "stop" : result.status } };
        }
      }]])]]) as any
    });
    let runtime = createRuntime();
    const run = async () => {
      const version = store.getById(created.execution.id)!.version;
      await runtime.run({ internal: { kind: "durable-execution", durable: { executionId: created.execution.id, expectedVersion: version } } } as MomEvent, join(directory, "continuation.json"));
    };
    await run();
    const waiting = store.getDetail(created.execution.id)!;
    assert.equal(waiting.execution.status, "waiting_for_approval");
    assert.equal(sends, 0);
    store.close();
    store = new DurableExecutionStore(businessPath);
    runtime = createRuntime();
    new DurableExecutionCoordinator(store, "process-a", directory).resolveApproval({
      ownerId: "owner", executionId: created.execution.id, expectedVersion: waiting.execution.version,
      approvalId: waiting.approvals[0].id, status: "approved", selectedScope: "once", actionId: "approve-send"
    });
    await run();
    const executed = store.getDetail(created.execution.id)!;
    assert.equal(executed.execution.status, "verifying", "a model answer does not complete the user's goal");
    assert.deepEqual(executed.sideEffects.map((effect) => effect.phase), ["intent", "receipt"]);
    assert.equal(sends, 1);
    await run();
    assert.equal(store.getById(created.execution.id)!.status, "completed");
    assert.equal(sends, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a second caller cannot run the same storage while its first execution is active", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-exclusive-"));
  const controller = new AbortController();
  let started!: () => void;
  const toolStarted = new Promise<void>((resolve) => { started = resolve; });
  const options = kernelOptions(directory, () => undefined);
  options.tools = [{
    ...options.tools[0],
    execute: async (_id, _args, signal) => {
      started();
      return await new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  }];
  const input = { requestId: "approved-goal-step", text: "Send report" };
  const first = new PiDurableKernel(options).run({ ...input, signal: controller.signal });
  try {
    await toolStarted;
    await assert.rejects(() => new PiDurableKernel(options).run(input), /already active/);
  } finally {
    controller.abort();
    await first;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shared authorization parks before Pi intent, then consumes one prepared invocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-prepared-approval-"));
  const [{ ToolRuntime, ToolRegistry }, { ApprovalBroker }, { SqliteApprovalStore }] = await Promise.all([
    import("$lib/server/agent/tools/toolRuntime.js"), import("$lib/server/approval/approvalBroker.js"), import("$lib/server/approval/approvalStore.js")
  ]);
  const approvalStore = new SqliteApprovalStore(join(directory, "approvals.sqlite"));
  const broker = new ApprovalBroker(approvalStore);
  const registry = new ToolRegistry();
  let sends = 0;
  let requestId = "";
  const effects: string[] = [];
  registry.register({ id: "sendReport", name: "Send report", description: "fixture", inputSchema: Type.Object({}), risk: "high", source: "host", effect: "execute",
    handler: async () => { sends++; return { ok: true, content: [{ type: "text", text: "sent" }] }; } });
  const runtime = new ToolRuntime(registry, { approvalBroker: broker });
  let prepared: { execute(): Promise<import("$lib/server/agent/tools/toolTypes.js").ToolResult> } | undefined;
  const options = kernelOptions(directory, () => {});
  options.beforeTool = async call => {
    const outcome = await runtime.prepareToolCall({ toolId: call.name, input: call.arguments, context: {
      runId: "prepared-run", sessionId: "prepared-session", workspaceId: "", actorId: "owner", cwd: directory, toolCallId: call.id,
      fs: { readText: async () => "", writeText: async () => {} }, shell: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) }, network: { fetch: async () => ({}) }, emit: () => {},
      onApprovalRequest: async request => { requestId = request.requestId; return "defer"; },
      onSideEffectPreflight: async () => { effects.push("intent"); }, onSideEffectReceipt: async () => { effects.push("receipt"); }
    } });
    if ("execute" in outcome) { prepared = outcome; return { kind: "allow" }; }
    if (outcome.terminate) return { kind: "wait", requestId };
    return { kind: "deny", reason: outcome.error ?? "Denied" };
  };
  options.tools = [{ ...options.tools[0], execute: async () => {
    assert.ok(prepared);
    const result = await prepared.execute();
    return { content: result.content as any, details: { ok: result.ok } };
  } }];
  try {
    const input = { requestId: "prepared-request", text: "Send report" };
    const first = await new PiDurableKernel(options).run(input);
    assert.equal(first.status, "waiting_for_approval");
    assert.equal(sends, 0);
    assert.deepEqual(effects, []);
    const { Harness, createRegistry } = await import("@earendil-works/pi-durable");
    const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const harness = await Harness.open(await openNodeSqliteStorage(options.storagePath), { models: options.models, registry: createRegistry() }, BACKGROUND_CONTEXT);
    try {
      const inspection = await harness.inspect(BACKGROUND_CONTEXT);
      const task = inspection.tasks.find(task => task.record.kind === "pi.tool")!;
      assert.ok(task);
      assert.equal((task.record.state as any).checkpoint.phase, "call");
    } finally { await harness.close(BACKGROUND_CONTEXT); }
    broker.resolveRequest({ requestId, status: "approved", selectedScope: "session" });
    const second = await new PiDurableKernel(options).run(input);
    assert.equal(second.status, "completed", second.error);
    assert.equal(sends, 1);
    assert.deepEqual(effects, ["intent", "receipt"]);
    const third = await new PiDurableKernel(options).run(input);
    assert.equal(third.status, "completed");
    assert.equal(sends, 1);
  } finally { approvalStore.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("real Host Bash authorization survives Pi reopen before intent and executes one original invocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-host-approval-"));
  try {
    const [{ ToolRuntime, ToolRegistry }, { HostBashStore }, { getBashToolDefinition }] = await Promise.all([
      import("$lib/server/agent/tools/toolRuntime.js"), import("$lib/server/hostBash/store.js"), import("$lib/server/agent/tools/bash.js")
    ]);
    const storePath = join(directory, "approvals.sqlite");
    let hostStore = new HostBashStore(storePath);
    const params = { label: "Write receipt", command: "printf one >> external-ledger.txt", hostApproval: { reason: "test" } };
    const { models, requests } = fixtureModels({ name: "bash", arguments: params });
    const effects: string[] = [];
    let approvalRequestId = "";
    const options = kernelOptions(directory, () => undefined);
    options.models = models;
    const definition = () => getBashToolDefinition({ cwd: directory, hostApproval: {
      channel: "web", chatId: "chat", scopeId: "scope", sessionId: "session", runId: "run",
      hostBashStore: hostStore, store: new MomRuntimeStore(join(directory, "workspace"))
    } });
    const { bindToolRuntime } = await import("$lib/server/agent/tools/preparedTool.js");
    const buildTools = () => {
      const registry = new ToolRegistry();
      const def = definition();
      registry.register(def);
      const runtime = new ToolRuntime(registry, { decidePolicy: () => ({ type: "allow" }) });
      return [bindToolRuntime({
        name: "bash", label: "Bash", description: "fixture", parameters: Type.Object({
          label: Type.String(), command: Type.String(), hostApproval: Type.Object({ reason: Type.String() })
        })
      }, runtime, (signal, toolCallId) => ({
        runId: "run", sessionId: "session", workspaceId: "", actorId: "owner", cwd: directory, signal, toolCallId,
        fs: { readText: async () => "", writeText: async () => {} },
        shell: { run: async () => { throw new Error("Approved host execution must not run in the sandbox."); } },
        network: { fetch: async () => ({}) }, emit: () => {},
        onApprovalRequest: async request => { approvalRequestId = request.requestId; return "defer"; },
        onSideEffectPreflight: async () => { effects.push("intent"); },
        onSideEffectReceipt: async () => { effects.push("receipt"); }
      }))];
    };
    options.tools = buildTools();
    const input = { requestId: "host-request", text: "Write approved receipt" };
    const first = await new PiDurableKernel(options).run(input);
    assert.equal(first.status, "waiting_for_approval");
    assert.ok(approvalRequestId);
    assert.deepEqual(effects, []);
    assert.equal(existsSync(join(directory, "external-ledger.txt")), false);
    const [{ Harness, createRegistry }, { openNodeSqliteStorage }, { BACKGROUND_CONTEXT }] = await Promise.all([
      import("@earendil-works/pi-durable"), import("@earendil-works/pi-durable/storage/sqlite/node"), import("@earendil-works/chord/context")
    ]);
    const inspectionHarness = await Harness.open(await openNodeSqliteStorage(options.storagePath),
      { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
    try {
      const inspection = await inspectionHarness.inspect(BACKGROUND_CONTEXT);
      const task = inspection.tasks.find(item => item.record.kind === "pi.tool");
      assert.ok(task);
      assert.equal((task.record.state as any).checkpoint.phase, "call");
    } finally { await inspectionHarness.close(BACKGROUND_CONTEXT); }
    hostStore = new HostBashStore(storePath);
    options.tools = buildTools();
    assert.ok(hostStore.approve("scope", approvalRequestId, { scope: "once", sessionId: "session" }));
    const second = await new PiDurableKernel(options).run(input);
    assert.equal(second.status, "completed", second.error);
    assert.equal(readFileSync(join(directory, "external-ledger.txt"), "utf8"), "one");
    assert.deepEqual(effects, ["intent", "receipt"]);
    assert.equal(hostStore.getApprovalRecord(approvalRequestId)?.status, "executed");
    const requestCount = requests();
    const third = await new PiDurableKernel(options).run(input);
    assert.equal(third.status, "completed");
    assert.equal(requests(), requestCount);
    assert.equal(readFileSync(join(directory, "external-ledger.txt"), "utf8"), "one");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a failed preparation cancellation still closes the real Harness and permits safe reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-cleanup-"));
  const { Harness } = await import("@earendil-works/pi-durable");
  const open = Harness.open;
  let closes = 0;
  Harness.open = async (...args) => {
    const harness = await open(...args);
    const close = harness.close.bind(harness);
    harness.close = async (...closeArgs) => { closes += 1; return close(...closeArgs); };
    return harness;
  };
  try {
    let checks = 0;
    let executions = 0;
    let cancellations = 0;
    const options = kernelOptions(directory, () => undefined);
    options.assertAuthority = () => { if (++checks === 4) throw new Error("Authority revoked before execution"); };
    const tool = {
      ...options.tools[0], prepareInvocation: async () => ({
        execute: async () => { executions += 1; return { content: [{ type: "text" as const, text: "executed" }], details: {} }; },
        cancel: () => { cancellations += 1; throw new Error("Approval store write failed"); }
      })
    };
    options.tools = [tool];
    const input = { requestId: "request", text: "Send" };
    await assert.rejects(new PiDurableKernel(options).run(input), /Prepared tool cleanup failed/);
    assert.equal(cancellations, 1);
    assert.equal(closes, 1, "cancellation failure must not skip the actual Harness close");
    assert.equal(executions, 0);
    const reopened = await new PiDurableKernel(options).run(input);
    assert.equal(reopened.status, "completed");
    assert.equal(executions, 0);
    assert.equal(closes, 2);
  } finally {
    Harness.open = open;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native live events deliver committed results and reopen from a snapshot without replaying work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-live-events-"));
  try {
    let executions = 0;
    const options = kernelOptions(directory, () => { executions += 1; });
    const events: import("@earendil-works/pi-durable").AgentEvent[] = [];
    options.onEvent = async event => { events.push(event); };
    const input = { requestId: "request", text: "Send" };
    const first = await new PiDurableKernel(options).run(input);
    assert.equal(first.status, "completed");
    assert.equal(executions, 1);
    assert.equal(events[0].type, "snapshot");
    const starts = events.filter(event => event.type === "tool_execution_start");
    assert.equal(starts.length, 1);
    const ends = events.filter(event => event.type === "tool_execution_end");
    assert.equal(ends.length, 1);
    assert.ok(ends[0].entry?.model?.some(message => message.role === "toolResult"));
    assert.ok(events.some(event => event.type === "message_end" && event.entry.model?.some(message => message.role === "assistant")));
    events.length = 0;
    const reopened = await new PiDurableKernel(options).run(input);
    assert.equal(reopened.status, "completed");
    assert.equal(executions, 1);
    assert.equal(events[0].type, "snapshot");
    if (events[0].type !== "snapshot") throw new Error("Missing snapshot");
    assert.ok(events[0].entries.some(entry => entry.model?.some(message => message.role === "toolResult")));
    assert.equal(events.filter(event => event.type === "tool_execution_start").length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a live display failure closes the Harness and committed work is reused on reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-live-failure-"));
  try {
    let executions = 0;
    const options = kernelOptions(directory, () => { executions += 1; });
    options.onEvent = async event => {
      if (event.type === "tool_execution_end") throw new Error("Display unavailable");
    };
    const input = { requestId: "request", text: "Send" };
    await assert.rejects(new PiDurableKernel(options).run(input), /Display unavailable/);
    assert.equal(executions, 1);
    options.onEvent = async () => {};
    const reopened = await new PiDurableKernel(options).run(input);
    assert.equal(reopened.status, "completed", reopened.error);
    assert.equal(executions, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a reopened pending tool cannot prepare or execute before admission binding is verified", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-admission-order-"));
  const { Harness } = await import("@earendil-works/pi-durable");
  const open = Harness.open;
  try {
    let executions = 0;
    let preparations = 0;
    let permitted = false;
    const options = kernelOptions(directory, () => { executions += 1; });
    options.beforeTool = async () => {
      preparations += 1;
      return permitted ? { kind: "allow" } : { kind: "wait", requestId: "approval" };
    };
    const input = { requestId: "request", text: "Send" };
    assert.equal((await new PiDurableKernel(options).run(input)).status, "waiting_for_approval");
    preparations = 0;
    permitted = true;
    Harness.open = async (...args) => {
      const harness = await open(...args);
      const root = harness.root.bind(harness);
      harness.root = async (...rootArgs) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return root(...rootArgs);
      };
      return harness;
    };
    await assert.rejects(new PiDurableKernel({ ...options, scope: { ...options.scope, authorityKey: "another-owner" } }).run(input), /binding differs/);
    assert.equal(preparations, 0, "a stale authority must not prepare a resumed tool");
    assert.equal(executions, 0, "the immutable binding must precede resumed execution");
    Harness.open = open;
    assert.equal((await new PiDurableKernel(options).run(input)).status, "completed");
    assert.equal(executions, 1);
  } finally { Harness.open = open; rmSync(directory, { recursive: true, force: true }); }
});

test("resume uses the admitted input and context rather than a new attempt's prompt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-pinned-admission-"));
  try {
    let permitted = false;
    let executions = 0;
    const options = kernelOptions(directory, () => { executions += 1; });
    options.initialMessages = [{ role: "user", content: "original history", timestamp: 1 }];
    options.beforeTool = async () => permitted ? { kind: "allow" } : { kind: "wait", requestId: "approval" };
    assert.equal((await new PiDurableKernel(options).run({ requestId: "request", text: "original input" })).status, "waiting_for_approval");
    permitted = true;
    const current = { ...options, instructions: "new attempt instructions",
      initialMessages: [{ role: "user" as const, content: "new attempt history", timestamp: 2 }] };
    const result = await new PiDurableKernel(current).resume({ requestId: "request" });
    assert.equal(result.status, "completed", result.error);
    assert.equal(executions, 1);
    const history = JSON.stringify(result.messages);
    assert.match(history, /original history/);
    assert.match(history, /original input/);
    assert.doesNotMatch(history, /new attempt history|new attempt instructions/);
    await assert.rejects(new PiDurableKernel({ ...current, scope: { ...current.scope, authorityKey: "another-owner" } }).resume({ requestId: "request" }), /binding differs/);
    await assert.rejects(new PiDurableKernel(current).resume({ requestId: "another-request" }), /binding differs/);
    assert.equal(executions, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("resume never creates a new execution when admission is absent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-no-admission-"));
  try {
    const options = kernelOptions(directory, () => { throw new Error("No operation may start"); });
    await assert.rejects(new PiDurableKernel(options).resume({ requestId: "request" }), /no admitted input/);
    assert.equal(existsSync(options.storagePath), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
