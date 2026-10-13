/**
 * Drives a real Room execution through the production runtime so the recovery
 * review wiring can be exercised end to end.
 *
 * `start` phase: boots the runtime, points a custom provider at an in-process
 * HTTP server that never answers, and starts a Room run. The first provider
 * request means Pi has already committed a live `request` checkpoint; the
 * worker then SIGKILLs itself, exactly like a service restart killed mid-call.
 *
 * `resolve` phase: reboots the same data directory, waits for startup to park
 * the Room execution behind a `recovery_review` Decision Request, reports the
 * parked state, then resolves the approval through the real Desktop broker path
 * and reports the outcome.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

const phase = process.env.PI_ROOM_REVIEW_PHASE;
const channelMode = process.env.PI_REVIEW_KIND === "channel";
const decision = process.env.PI_ROOM_REVIEW_DECISION === "reject" ? "reject" : "approve_once";
const port = Number(process.env.PI_ROOM_REVIEW_PORT || 0);
const directory = process.env.DATA_DIR!;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
const report = (payload: Record<string, unknown>) => process.send?.({ phase, ...payload });
const fail = (error: unknown) => {
  if (finished) return;
  finished = true;
  process.send?.({ phase, type: "error", error: String(error) });
  process.exitCode = 1;
};

function addProvider(runtime: { getSettings(): any; updateSettings(settings: any): void }, providerPort: number): void {
  const settings = runtime.getSettings();
  runtime.updateSettings({
    defaultAgentId: "a",
    providerMode: "custom",
    defaultCustomProviderId: "review-test",
    permissionMode: "accept_edits",
    modelRouting: { ...settings.modelRouting, textModelKey: "custom|review-test|model-a" },
    customProviders: [{
      id: "review-test", name: "Review Test", enabled: true, protocol: "openai-compatible",
      baseUrl: `http://127.0.0.1:${providerPort}/v1`, apiKey: "test", path: "/chat/completions", defaultModel: "model-a",
      models: [{ id: "model-a", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }]
    }],
    agents: [...settings.agents.filter((agent: { id: string }) => agent.id !== "a"),
      { id: "a", name: "Agent A", description: "", enabled: true, modelRouting: { textModelKey: "custom|review-test|model-a" } }]
  });
}

function listen(server: Server, listenPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

/** Start phase: hang the first model request, then die mid-flight. */
async function startPhase(): Promise<void> {
  const { getRuntime } = await import("../../src/lib/server/app/runtime.js");
  const { getRoomService } = await import("../../src/lib/server/rooms/runtime.js");
  const { getAgentDir } = await import("../../src/lib/server/agent/prompts/profiles.js");

  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    // Pi commits the `request` checkpoint before it calls the provider, so the
    // SIGKILL below leaves a live request without a committed result.
    process.send?.({ phase, type: "request" });
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 100);
    res.on("close", () => undefined);
  });
  const providerPort = await listen(server, port);
  report({ type: "port", port: providerPort });

  const runtime = getRuntime();
  addProvider(runtime, providerPort);
  mkdirSync(getAgentDir("a"), { recursive: true });
  writeFileSync(join(getAgentDir("a"), "IDENTITY.md"), "You are identity-a.");

  if (channelMode) {
    const { MomRuntimeStore } = await import("../../src/lib/server/agent/session/store.js");
    const { RunnerPool } = await import("../../src/lib/server/agent/core/runnerPool.js");
    const { runBackgroundConversation } = await import("../../src/lib/server/app/backgroundConversation.js");
    const workspaceDir = join(directory, "sessions", "a");
    const session = runtime.sessions.getOrCreateConversation("telegram", "actor", undefined, { agentId: "a" });
    const store = new MomRuntimeStore(workspaceDir, { source: { channel: "telegram", botId: "fixture" } });
    const pool = new RunnerPool("telegram", store, runtime.getSettings, runtime.updateSettings, runtime.usageTracker, runtime.modelErrorTracker, runtime.memory, runtime.hookManager, { agentId: "a" });
    await runBackgroundConversation(pool.get("actor", session.id), { channel: "telegram", workspaceDir, chatDir: store.getChatDir("actor"), deliveryTarget: { channel: "telegram", instanceId: "fixture", chatId: "actor", workspaceDir }, message: { chatId: "actor", sessionId: session.id, runId: "channel-review", userId: "actor", userName: "actor", text: "CHANNEL_REVIEW_REQUEST", messageId: 1, ts: "1", attachments: [], imageContents: [], chatType: "private" } }, runtime.sessions);
    throw new Error("Channel execution must have been interrupted.");
  }
  const service = getRoomService();
  const room = service.create({ title: "Review room", agentIds: ["a"], primaryAgentId: "a" });
  service.send(room.id, { submissionId: "review", text: "ROOM_REVIEW_REQUEST", agentIds: ["a"] });
  // Idle until the provider request arrives and this process kills itself.
  await new Promise<never>(() => undefined);
}

/** Resolve phase: expect a parked execution, then approve or reject it. */
async function resolvePhase(): Promise<void> {
  const { getRuntime } = await import("../../src/lib/server/app/runtime.js");
  const { getRoomService } = await import("../../src/lib/server/rooms/runtime.js");
  const { getApprovalBroker } = await import("../../src/lib/server/approval/approvalBroker.js");
  const { resolveDesktopBrokerApproval } = await import("../../src/lib/server/app/desktopApprovals.js");
  const { getTurnOrchestrator } = await import("../../src/lib/server/agent/core/turnOrchestrator.js");
  const { PiRecoveryStore } = await import("../../src/lib/server/agent/core/piRecoveryStore.js");

  const runtime = getRuntime();
  const delivered: string[] = [];
  if (channelMode) runtime.channelManagers.set("telegram", new Map([["fixture", { getWorkspaceDir: () => join(directory, "sessions", "a"), getBotId: () => "fixture", start: () => {}, stop: () => {}, sendInternalNotice: async (_chatId: string, text: string) => { delivered.push(text); } }]]));
  const service = getRoomService();

  // The resumed run must reach a provider. The admitted model baked in the
  // original baseUrl, so the responder binds the same port.
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    process.send?.({ phase, type: "request" });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = { id: "review", object: "chat.completion.chunk", created: 1, model: payload.model };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Reviewed and continued." }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await listen(server, port);

  if (channelMode) {
    const orchestrator = getTurnOrchestrator();
    const deadline = Date.now() + 40000;
    while (orchestrator.getRunStatus("channel-review") !== "recovery_review") { if (Date.now() > deadline) throw new Error("Channel execution was not parked."); await sleep(20); }
    const broker = getApprovalBroker();
    const request = broker.getRequest("recovery-review:channel-review");
    if (!request) throw new Error("Channel review request is missing.");
    report({ type: "parked", runId: "channel-review", executionStatus: "waiting_approval", approvalId: request.id, approvalCommand: request.action.toolName, runStatus: orchestrator.getRunStatus("channel-review"), requestStatus: request.status, requestCapability: request.capability });
    const resolved = resolveDesktopBrokerApproval(broker, { sessionId: request.sessionId, requestId: request.id, decision });
    while (orchestrator.getRunStatus("channel-review") === "running" || (decision === "approve_once" && delivered.every(text => !text.includes("Reviewed and continued.")))) { if (Date.now() > deadline) throw new Error(`Channel execution did not settle: ${orchestrator.getRunStatus("channel-review")}`); await sleep(20); }
    const recovery = new PiRecoveryStore(directory);
    const recordExists = Boolean(recovery.read("channel-review")); recovery.close();
    const { MomRuntimeStore } = await import("../../src/lib/server/agent/session/store.js");
    const answers = new MomRuntimeStore(join(directory, "sessions", "a"), { source: { channel: "telegram", botId: "fixture" } }).loadContext("actor", request.sessionId).filter(message => message.role === "assistant" && message.content.some(block => block.type === "text" && block.text.includes("Reviewed and continued.")));
    finished = true;
    report({ type: "resolved", resolved: resolved.status, executionStatus: decision === "reject" ? "failed" : "completed", runStatus: orchestrator.getRunStatus("channel-review"), recordExists, delivered, answerCount: answers.length });
    await sleep(100); process.exit(0);
  }
  const room = service.list()[0];
  if (!room) throw new Error("The Room did not survive the restart.");
  const deadline = Date.now() + 40_000;
  let execution = service.view(room.id).executions[0];
  while (execution?.status !== "waiting_approval") {
    if (Date.now() > deadline) throw new Error(`The Room execution was never parked; status=${execution?.status}`);
    await sleep(20);
    execution = service.view(room.id).executions[0];
  }

  const broker = getApprovalBroker();
  const request = execution.approvalId ? broker.getRequest(execution.approvalId) : null;
  report({ type: "parked", runId: execution.id, executionStatus: execution.status, approvalId: execution.approvalId,
    approvalCommand: execution.approval?.command, runStatus: getTurnOrchestrator().getRunStatus(execution.id),
    requestStatus: request?.status, requestCapability: request?.capability });
  if (!request) throw new Error("The parked execution has no Decision Request.");

  const resolved = resolveDesktopBrokerApproval(broker, { sessionId: request.sessionId, requestId: request.id, decision });

  const settleDeadline = Date.now() + 40_000;
  while (service.isBusy(room.id)) {
    if (Date.now() > settleDeadline) throw new Error("The resolved Room execution never settled.");
    await sleep(20);
  }
  execution = service.view(room.id).executions[0];

  const recovery = new PiRecoveryStore(directory);
  let recordExists = false;
  try { recordExists = Boolean(recovery.read(execution.id)); } finally { recovery.close(); }

  finished = true;
  report({ type: "resolved", resolved: resolved?.status, executionStatus: execution.status,
    runStatus: getTurnOrchestrator().getRunStatus(execution.id), recordExists });
  await sleep(100);
  process.exit(0);
}

const run = phase === "start" ? startPhase() : resolvePhase();
run.catch(fail);
