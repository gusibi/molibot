import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { roomMentionIds } from "$lib/shared/roomMentions.js";
import { RoomStore } from "./store.js";
import { RoomService, type RoomRunner } from "./service.js";

function fixture(t: test.TestContext, contextAllowance?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "molibot-room-"));
  const store = new RoomStore(join(dir, "sessions.db"));
  const calls: Array<{ sessionId: string; contextId: string; snapshot: import("$lib/shared/rooms.js").RoomMessage[]; agentId: string; mode: string; text: string; finish: (text: string) => void }> = [];
  const agents = [{ id: "writer", name: "Writer", description: "", enabled: true }, { id: "reviewer", name: "Reviewer", description: "", enabled: true }];
  const projections: Array<{ sessionId: string; messages: import("$lib/shared/rooms.js").RoomMessage[] }> = [];
  const service = new RoomService({
    store,
    contextAllowance,
    syncTranscript: (sessionId, messages) => { projections.push({ sessionId, messages }); },
    memberModelKey: (_room, agent) => `pi|fixture|${agent.id}`,
    agents: () => agents,
    createSession: () => ({ id: crypto.randomUUID() }),
    isSessionAvailable: () => true,
    createRunner: (input) => {
      const runner: RoomRunner = {
        abort: () => resolve?.({ status: "cancelled", text: "partial" }),
        steer: () => true,
        run: async (hooks) => new Promise((finish) => {
          resolve = finish;
          calls.push({ sessionId: input.sessionId, contextId: input.contextId, snapshot: input.snapshot, agentId: input.agentId, mode: input.mode, text: input.text, finish: (text) => {
            hooks.onText(text);
            finish({ status: "completed", text });
          } });
        })
      };
      let resolve: ((value: { status: "cancelled"; text: string }) => void) | undefined;
      return runner;
    }
  });
  t.after(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { service, store, calls, dir, agents, projections };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an explicit quote is truncated visibly or rejected before acceptance when it cannot fit", async (t) => {
  let allowance = 6000;
  const { service, calls, store } = fixture(t, () => allowance);
  const room = service.create({ title: "Quotes", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "source", text: "Proposal" });
  await flush(); calls[0].finish("Proposal detail ".repeat(1000)); await flush();
  const quote = service.view(room.id).messages.at(-1)!;
  allowance = 100;
  const input = { submissionId: "quote", text: "Review this", replyToId: quote.id, agentIds: ["reviewer"] };
  assert.throws(() => service.send(room.id, input), /quoted message.*context allowance/i);
  assert.equal(store.dispatch(room.id, input.submissionId), null);
  assert.equal(service.view(room.id).messages.length, 2);
  allowance = 1000;
  service.send(room.id, input);
  const projected = service.view(room.id).executions.at(-1)!.snapshot.find(m => m.id === quote.id)!;
  assert.ok(projected);
  assert.match(projected.content, /\[truncated excerpt\]$/);
  await flush(); calls[1].finish("Reviewed"); await flush();
});

test("paused resume submissions survive reload, deduplicate after completion and reject conflicts", async (t) => {
  const { service, calls, store, dir } = fixture(t);
  const room = service.create({ title: "Resume", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "active", text: "Write" });
  service.send(room.id, { submissionId: "pending", text: "Review", agentIds: ["reviewer"] });
  await flush();
  const pending = service.view(room.id).executions[1];
  store.state(pending.id, "paused");
  assert.throws(() => service.resume(room.id, pending.id, ""), /Submission ID/);
  assert.throws(() => service.resume(room.id, pending.id, "active"), /different payload/);
  const dispatch = service.resume(room.id, pending.id, "resume-1");
  assert.deepEqual(service.resume(room.id, pending.id, "resume-1"), dispatch);
  assert.throws(() => service.resume(room.id, service.view(room.id).executions[0].id, "resume-1"), /different payload/);
  assert.throws(() => service.send(room.id, { submissionId: "resume-1", text: "Other request" }), /different payload/);
  calls[0].finish("Written"); await flush(); calls[1].finish("Reviewed"); await flush();
  const reopened = new RoomStore(join(dir, "sessions.db"));
  t.after(() => reopened.close());
  const recovered = new RoomService({ store: reopened, agents: () => [], createSession: () => ({ id: "unused" }), isSessionAvailable: () => true,
    createRunner: () => { throw new Error("Duplicate resume must not start a runner"); } });
  recovered.recover();
  assert.deepEqual(recovered.resume(room.id, pending.id, "resume-1"), dispatch);
  assert.equal(recovered.view(room.id).executions.length, 2);
});

test("a room routes to Primary and retains one attributed reply after reopen", async (t) => {
  const { service, calls, store, dir } = fixture(t);
  const room = service.create({ title: "Design", agentIds: ["writer", "reviewer"], primaryAgentId: "writer" });
  const dispatch = service.send(room.id, { submissionId: "send-1", text: "Explain the proposal" });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentId, "writer");
  calls[0].finish("The proposal is ready.");
  await flush();
  const view = service.view(room.id);
  assert.equal(view.messages.length, 2);
  assert.equal(view.messages[1].authorAgentId, "writer");
  assert.equal(view.messages[1].content, "The proposal is ready.");
  assert.equal(view.executions[0].dispatchId, dispatch.id);
  const reopened = new RoomStore(join(dir, "sessions.db"));
  t.after(() => reopened.close());
  assert.deepEqual(reopened.get(room.id), store.get(room.id));
  assert.deepEqual(reopened.messages(room.id), view.messages);
});

test("explicit mentions override replies and multi-member discussion streams independently", async (t) => {
  const { service, calls } = fixture(t);
  const room = service.create({ title: "Review", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "first", text: "Proposal" });
  await flush(); calls[0].finish("Draft"); await flush();
  const replyToId = service.view(room.id).messages[1].id;
  service.send(room.id, { submissionId: "redirect", text: "Check this", replyToId, agentIds: ["reviewer"] });
  await flush(); assert.equal(calls[1].agentId, "reviewer"); calls[1].finish("Reviewed"); await flush();
  service.send(room.id, { submissionId: "parallel", text: "Compare", agentIds: ["writer", "reviewer"] });
  await flush();
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(2).map(c => c.mode), ["discussion", "discussion"]);
  calls[3].finish("Fast answer"); await flush();
  assert.equal(service.view(room.id).executions.at(-1)?.status, "completed");
  assert.equal(service.view(room.id).executions.at(-2)?.status, "running");
  calls[2].finish("Slow answer"); await flush();
  assert.equal(service.view(room.id).messages.filter(m => m.content === "Compare").length, 1);
});

test("one Room serializes writers while another Room proceeds and duplicate sends do not fork", async (t) => {
  const { service, calls } = fixture(t);
  const room = service.create({ title: "One", agentIds: ["writer", "reviewer"] });
  const other = service.create({ title: "Two", agentIds: ["writer"] });
  const input = { submissionId: "write", text: "Change file" };
  const dispatch = service.send(room.id, input);
  assert.deepEqual(service.send(room.id, input), dispatch);
  assert.throws(() => service.send(room.id, { ...input, text: "Different" }), /different payload/);
  service.send(room.id, { submissionId: "next", text: "Then verify", agentIds: ["reviewer"] });
  service.send(other.id, { submissionId: "other", text: "Independent file change" });
  await flush(); assert.equal(calls.length, 2);
  assert.equal(service.view(room.id).executions[1].status, "queued");
  calls[0].finish("Done"); await flush(); assert.equal(calls.length, 3);
  assert.equal(calls[2].agentId, "reviewer");
  calls[1].finish("Other done"); calls[2].finish("Verified"); await flush();
});

test("per-run Stop leaves a sibling running and Stop All cancels pending work", async (t) => {
  const { service, calls } = fixture(t);
  const room = service.create({ title: "Discussion", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "compare", text: "Discuss", agentIds: ["writer", "reviewer"] });
  await flush();
  const [writer, reviewer] = service.view(room.id).executions;
  service.stop(room.id, writer.id); await flush();
  assert.equal(service.view(room.id).executions[0].status, "cancelled");
  assert.equal(service.view(room.id).executions[1].status, "running");
  service.send(room.id, { submissionId: "queued", text: "Another", agentIds: ["reviewer"] });
  service.stop(room.id); await flush();
  assert.equal(service.isBusy(room.id), false);
  assert.equal(service.view(room.id).executions.find(e => e.id === reviewer.id)?.status, "cancelled");
  assert.equal(calls.length, 2);
});

test("removed members retain Context without reviving cancelled requests or approvals", async (t) => {
  const { service, agents } = fixture(t);
  agents.push({ id: "outsider", name: "Writer", description: "", enabled: true });
  const room = service.create({ title: "Members", agentIds: ["writer", "reviewer"] });
  const context = service.view(room.id).session.contexts.find(p => p.agentId === "reviewer")!.contextId;
  service.send(room.id, { submissionId: "work", text: "Review", agentIds: ["reviewer"] });
  await flush();
  service.update(room.id, { agentIds: ["writer"], primaryAgentId: "writer" }); await flush();
  assert.throws(() => service.send(room.id, { submissionId: "bad", text: "Hi", agentIds: ["reviewer"] }), /current Room member/);
  const updated = service.update(room.id, { agentIds: ["writer", "reviewer"], primaryAgentId: "writer" });
  assert.equal(service.view(room.id).session.contexts.find(p => p.agentId === "reviewer")!.contextId, context);
  assert.equal(service.view(room.id).executions[0].status, "cancelled");
  assert.throws(() => service.update(room.id, { agentIds: [], primaryAgentId: "writer" }), /member and a Primary/);
});

test("turn-only quotes are rejected and derived replies retain the strongest eligible source policy", async (t) => {
  const { service, calls } = fixture(t);
  const room = service.create({ title: "Private", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "private", text: "This turn only: secret" });
  await flush(); calls[0].finish("Secret reply"); await flush();
  const secret = service.view(room.id).messages[1];
  assert.throws(() => service.send(room.id, { submissionId: "quote", text: "Quote", replyToId: secret.id }), /not eligible/);
  service.send(room.id, { submissionId: "restricted", text: "Do not remember: proposal" });
  await flush(); calls[1].finish("Restricted proposal"); await flush();
  service.send(room.id, { submissionId: "later", text: "Review", agentIds: ["reviewer"] });
  await flush();
  const execution = service.view(room.id).executions.at(-1)!;
  assert.equal(execution.retention, "no_memory");
  assert.equal(execution.snapshot.some(m => m.content.includes("secret") || m.content.includes("Secret")), false);
  calls[2].finish("Derived review"); await flush();
  assert.equal(service.view(room.id).messages.at(-1)?.retention, "no_memory");
});

test("restart interrupts active work, pauses pending entries and never replays automatically", async (t) => {
  const { service, calls, dir } = fixture(t);
  const room = service.create({ title: "Restart", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "running", text: "Write" });
  service.send(room.id, { submissionId: "pending", text: "Verify", agentIds: ["reviewer"] });
  await flush();
  const reopened = new RoomStore(join(dir, "sessions.db"));
  const active = reopened.executions(room.id)[0];
  reopened.recordContextRun(active.id, "core-run");
  const interrupted: string[] = [];
  const recovered = new RoomService({
    store: reopened, agents: () => [], createSession: () => ({ id: "unused" }),
    isSessionAvailable: () => true, createRunner: () => { throw new Error("Recovery must not start a runner"); },
    interruptExecution: e => interrupted.push(reopened.contextRun(e.id)!)
  });
  recovered.recover();
  assert.deepEqual(interrupted, ["core-run"]);
  assert.deepEqual(reopened.executions(room.id).map(e => e.status), ["interrupted", "paused"]);
  assert.equal(calls.length, 1);
  calls[0].finish("Settled old process"); await flush();
  reopened.close();
});

test("Desktop dispatch API rejects invalid targets and returns the same dispatch for retries", async (t) => {
  const { handleRoomRequest } = await import("$lib/server/app/desktopRooms.js");
  const { service, calls } = fixture(t);
  const room = service.create({ title: "API", agentIds: ["writer"] });
  const send = async (body: unknown) => handleRoomRequest(service, new Request("http://localhost/api/desktop/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), new URL("http://localhost/api/desktop/rooms"));
  const input = { action: "send", roomId: room.id, sessionId: room.id, submissionId: "api-1", text: "Hello" };
  const first = await (await send(input)).json();
  const duplicate = await (await send(input)).json();
  assert.equal(first.dispatch.id, duplicate.dispatch.id);
  const invalid = await send({ ...input, submissionId: "api-2", agentIds: ["missing"] });
  assert.equal(invalid.status, 400);
  await flush(); assert.equal(calls.length, 1);
  calls[0].finish("Hello back"); await flush();
  const response = await handleRoomRequest(service, new Request(`http://localhost/api/desktop/rooms?id=${room.id}`), new URL(`http://localhost/api/desktop/rooms?id=${room.id}`));
  const view = await response.json();
  assert.equal(view.view.messages[1].authorAgentId, "writer");
});

test("an approval wait retains writer ownership until actual cancellation completes", async (t) => {
  const { service, store, calls } = fixture(t);
  const room = service.create({ title: "Approval", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "writer", text: "Write" }); await flush();
  const e = service.view(room.id).executions[0];
  store.state(e.id, "waiting_approval", undefined, "approval-1");
  service.send(room.id, { submissionId: "reviewer", text: "Review", agentIds: ["reviewer"] });
  await flush(); assert.equal(calls.length, 1);
  const other = service.create({ title: "Other", agentIds: ["writer"] });
  service.send(other.id, { submissionId: "other", text: "Independent" });
  await flush(); assert.equal(calls.length, 2);
  service.stop(room.id, e.id);
  assert.equal(service.view(room.id).executions[0].status, "cancelling");
  await flush(); assert.equal(calls.length, 3);
  calls[1].finish("Other finished"); calls[2].finish("Reviewer finished"); await flush();
});

test("unknown side effects block continuation until an explicit reconciliation", async (t) => {
  const { service, store, calls } = fixture(t);
  const room = service.create({ title: "Unknown", agentIds: ["writer"] });
  service.send(room.id, { submissionId: "original", text: "Send operation" }); await flush();
  calls[0].finish("Partial"); await flush();
  const e = service.view(room.id).executions[0];
  store.state(e.id, "failed");
  store.operation(e.id, "external-1", "unknown", "External request timed out");
  assert.throws(() => service.resume(room.id, e.id, "retry"), /unknown outcome/);
  service.reconcileOperation(room.id, e.id, "external-1", "completed");
  const retry = service.resume(room.id, e.id, "retry"); await flush();
  assert.deepEqual(service.resume(room.id, e.id, "retry"), retry);
  const entries = service.view(room.id).executions;
  assert.equal(entries[1].retryOf, e.id);
  assert.equal(entries[0].status, "failed");
  calls[1].finish("Continued"); await flush();
  assert.deepEqual(service.resume(room.id, e.id, "retry"), retry);
  assert.throws(() => service.resume(room.id, entries[1].id, "retry"), /different payload/);
});

test("steering is visible once and cannot smuggle stricter retention into an active run", async (t) => {
  const { service, calls } = fixture(t);
  const room = service.create({ title: "Steer", agentIds: ["writer"] });
  service.send(room.id, { submissionId: "start", text: "Draft" });
  await flush();
  const execution = service.view(room.id).executions[0];
  assert.throws(() => service.steer(room.id, execution.id, "this turn only: private"), /retention/);
  assert.equal(service.view(room.id).messages.length, 1);
  assert.equal(service.steer(room.id, execution.id, "Focus on readability"), true);
  assert.equal(service.view(room.id).messages.filter(m => m.content === "Focus on readability").length, 1);
  calls[0].finish("Done"); await flush();
});

test("Desktop creation preserves a permission ceiling and rejects invalid permission modes", async (t) => {
  const { service } = fixture(t);
  const { handleRoomRequest } = await import("../app/desktopRooms.js");
  const request = (mode: string) => new Request("http://localhost/api/desktop/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", title: "Restricted", agentIds: ["writer"], permissionMode: mode }) });
  const response = await handleRoomRequest(service, request("plan"), new URL("http://localhost/api/desktop/rooms"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).room.permissionMode, "plan");
  assert.equal((await handleRoomRequest(service, request("invalid"), new URL("http://localhost/api/desktop/rooms"))).status, 400);
});

test("purging a Room removes its owned transcript, execution evidence and attachments", async (t) => {
  const { service, store, calls } = fixture(t);
  const room = service.create({ title: "Disposable", agentIds: ["writer"] });
  service.send(room.id, { submissionId: "start", text: "Draft" });
  await flush(); calls[0].finish("Done"); await flush();
  const e = service.view(room.id).executions[0];
  store.operation(e.id, "write", "completed", "Saved");
  store.state(e.id, "failed");
  const retry = service.resume(room.id, e.id, "retry");
  await flush(); calls[1].finish("Continued"); await flush();
  store.saveFile("f", room.id, { original: "a.txt", local: "a.txt", mediaType: "file" });
  store.purge(room.id);
  assert.equal(store.get(room.id), null);
  assert.deepEqual(store.messages(room.id), []);
  assert.deepEqual(store.executions(room.id), []);
  assert.deepEqual(store.operations(e.id), []);
  assert.deepEqual(store.events(room.id), []);
  assert.equal(store.resumeSubmission(room.id, retry.submissionId), null);
  assert.equal(store.fileByLocal(room.id, "a.txt"), undefined);
});

test("Room model and Thinking selections survive persistence and remain idempotent", async (t) => {
  const { service, store, dir } = fixture(t);
  const room = service.create({ title: "Models", agentIds: ["writer"] });
  const input = { submissionId: "model-pick", text: "hello", modelKey: "custom|test|model", thinkingLevel: "high" as const };
  const dispatch = service.send(room.id, input);
  const reopened = new RoomStore(join(dir, "sessions.db"));
  try {
    assert.equal(reopened.dispatchesInput(dispatch.id)?.modelKey, input.modelKey);
    assert.equal(reopened.dispatchesInput(dispatch.id)?.thinkingLevel, "high");
    assert.deepEqual(service.view(room.id).composerSelection, {modelKey: input.modelKey, thinkingLevel: "high"});
    assert.deepEqual(service.send(room.id, input), dispatch);
    assert.throws(() => service.send(room.id, {...input, thinkingLevel: "low"}), /different payload/);
  } finally { reopened.close(); }
});

 test("typed mentions route to the named members instead of the default, including multi-member discussion", async t => {
  const {service, calls} = fixture(t);
  const room = service.create({title: "mentions", agentIds: ["writer", "reviewer"], primaryAgentId: "writer"});
  service.send(room.id, {submissionId: "mention-one", text: "@reviewer review this"});
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls.map(call => [call.agentId, call.mode]), [["reviewer", "direct"]]);
  calls[0].finish("done");
  await new Promise(resolve => setTimeout(resolve, 10));
  service.send(room.id, {submissionId: "mention-two", text: "@WRITER @Reviewer discuss"});
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls.slice(1).map(call => [call.agentId, call.mode]).sort(), [["reviewer", "discussion"], ["writer", "discussion"]]);
 });
 test("text mentioning outsiders falls back to the Room primary", t => {
  const {service, store} = fixture(t);
  const room = service.create({title: "mentions", agentIds: ["writer"]});
  service.send(room.id, {submissionId: "outside", text: "@Reviewer review"});
  assert.equal(service.view(room.id).executions[0].agentId, "writer");
  assert.throws(() => service.send(room.id, {submissionId: "explicit", text: "review", agentIds: ["reviewer"]}), /current Room member/);
 });

test("Room mentions resolve Chinese and spaced names, deduplicate aliases and ignore emails", () => {
 const members = [{id: "buffett", name: "Buffett"}, {id: "analyst", name: "价值投资研究员"}, {id: "coach", name: "Fitness Coach"}];
 assert.deepEqual(roomMentionIds("@buffett @Buffett @价值投资研究员，也分析一下 @Fitness Coach hello a@buffett.com", members), ["buffett", "analyst", "coach"]);
 assert.deepEqual(roomMentionIds("@buffetttest", members), []);
 assert.throws(() => roomMentionIds("@Same hello", [{id:"a",name:"Same"},{id:"b",name:"Same"}]), /Ambiguous/);
});

test("the exact screenshot mentions select Buffett and the research member", () => {
 assert.deepEqual(roomMentionIds("@agent-buffett @value-investment-researcher   你们两个也分析一下", [
 {id:"agent-buffett",name:"Buffett"}, {id:"agent-smart-momo",name:"聪明的魔魔"}, {id:"value-investment-researcher",name:"价值投资研究员"}
 ]), ["agent-buffett", "value-investment-researcher"]);
});

test("native recovery preserves the original Room execution and rechecks revoked membership", async (t) => {
  const { service, store, calls } = fixture(t);
  const room = service.create({ title: "Native recovery", agentIds: ["writer", "reviewer"] });
  service.send(room.id, { submissionId: "original", text: "Write" });
  await flush();
  const execution = store.executions(room.id)[0];
  let effects = 0;
  const recovered = new RoomService({ store, agents: () => [{ id: "writer", name: "Writer", description: "", enabled: true }],
    createSession: () => ({ id: "unused" }), isSessionAvailable: () => true,
    createRunner: () => { effects++; throw new Error("Revoked member must not create a runner"); } });
  recovered.recover(new Set([execution.id]));
  assert.equal(store.executions(room.id)[0].status, "running");
  store.update({ ...room, participants: room.participants.map(member => ({ ...member, active: member.agentId !== "writer" })) });
  assert.equal(recovered.resumeNativeExecution(room.id, execution.id), false);
  assert.equal(effects, 0);
  assert.equal(store.executions(room.id)[0].status, "failed");
  calls[0].finish("Old process settled"); await flush();
});


test("failed native checkpoint inspection releases the preserved Room writer", async t => {
  const { service, store, calls } = fixture(t);
  const room = service.create({ title: "Checkpoint failure", agentIds: ["writer"] });
  service.send(room.id, { submissionId: "original", text: "Write" });
  await flush();
  const execution = store.executions(room.id)[0];
  const recovered = new RoomService({ store, agents: () => [{ id: "writer", name: "Writer", description: "", enabled: true }],
    createSession: () => ({ id: "unused" }), isSessionAvailable: () => true,
    createRunner: () => { throw new Error("Inspection failure must not execute"); } });
  recovered.recover(new Set([execution.id]));
  assert.equal(recovered.isBusy(room.id), true);
  recovered.failNativeRecovery(room.id, execution.id, "No committed poll handle");
  assert.equal(recovered.isBusy(room.id), false);
  assert.equal(store.executions(room.id)[0].status, "failed");
  const next = { ...execution, id: "next-writer", status: "queued" as const };
  store.addExecution(next);
  assert.equal(store.claim(next), true);
  store.release(next);
  store.state(next.id, "cancelled");
  recovered.failNativeRecovery(room.id, next.id, "Late inspection");
  assert.equal(store.executions(room.id).find(e => e.id === next.id)?.status, "cancelled");
  calls[0].finish("Old process settled"); await flush();
});

 test("unavailable members do not prevent Room projection", async (t) => {
  const { store, service } = fixture(t);
  const room = service.create({ title: "Available", agentIds: ["writer", "reviewer"] });
  const viewer = new RoomService({ store, agents: () => [{ id: "writer", name: "Writer", description: "", enabled: false }],
    memberModelKey: () => { throw new Error("unavailable member must not be resolved"); },
    isSessionAvailable: () => true, createSession: () => ({ id: "unused" }),
    createRunner: () => { throw new Error("unused"); } });
  assert.deepEqual(viewer.view(room.id).memberModelKeys, { writer: "", reviewer: "" });
  await viewer.dispose();
});
 test("mentions ignore outsiders and their duplicate aliases", async (t) => {
  const { service, agents } = fixture(t);
  agents.push({ id: "outsider", name: "Writer", description: "", enabled: true });
  const room = service.create({ title: "Members", agentIds: ["writer"] });
  service.send(room.id, { submissionId: "outsider", text: "cc @Reviewer" });
  assert.equal(service.view(room.id).executions[0].agentId, "writer");
  service.send(room.id, { submissionId: "duplicate-alias", text: "@Writer" });
  assert.equal(service.view(room.id).executions[1].agentId, "writer");
});


test("a room starts fresh conversations while background replies stay in their originating session", async (t) => {
  const { service, calls, store, dir } = fixture(t);
  const room = service.create({ title: "Team", agentIds: ["writer", "reviewer"], primaryAgentId: "reviewer", projectId: "project", permissionMode: "manual" });
  const first = service.view(room.id).session;
  service.send(room.id, { submissionId: "first", text: "Old proposal" }, first.id);
  await flush();
  const second = service.newSession(room.id);
  assert.notEqual(first.id, second.id);
  for (const context of second.contexts) assert.notEqual(context.contextId, first.contexts.find(c => c.agentId === context.agentId)?.contextId);
  assert.equal(service.list().length, 1);
  assert.deepEqual(service.view(room.id, second.id).room, room);
  assert.deepEqual(service.view(room.id, second.id).messages, []);
  assert.deepEqual(service.view(room.id, second.id).executions, []);
  service.send(room.id, { submissionId: "second", text: "Fresh proposal" }, second.id);
  await flush();
  assert.equal(calls.length, 1, "the room writer slot spans conversations");
  calls[0].finish("Old answer"); await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sessionId, second.id);
  assert.deepEqual(calls[1].snapshot, []);
  assert.equal(calls[1].agentId, "reviewer");
  assert.deepEqual(service.view(room.id, first.id).messages.map(m => m.content), ["Old proposal", "Old answer"]);
  assert.deepEqual(service.view(room.id, second.id).messages.map(m => m.content), ["Fresh proposal"]);
  assert.throws(() => service.send(room.id, { submissionId: "cross-quote", text: "Quote", replyToId: service.view(room.id, first.id).messages[1].id }, second.id), /Reply target unavailable/);
  assert.throws(() => service.send(room.id, { submissionId: "first", text: "Old proposal" }, second.id), /different payload/);
  calls[1].finish("Fresh answer"); await flush();
  const reopened = new RoomStore(join(dir, "sessions.db")); t.after(() => reopened.close());
  assert.deepEqual(reopened.sessions(room.id), store.sessions(room.id));
  assert.equal(reopened.messages(room.id, second.id).length, 2);
  assert.equal(reopened.messages(room.id, first.id).length, 2);
  assert.ok(store.events(room.id).filter(e => e.type === "text").every(e => e.sessionId === first.id || e.sessionId === second.id));
});

test("new members get independent contexts in every conversation and rejoining preserves each", async (t) => {
  const { service } = fixture(t);
  const room = service.create({ title: "Team", agentIds: ["writer"] });
  const first = service.view(room.id).session;
  const second = service.newSession(room.id);
  service.update(room.id, { agentIds: ["writer", "reviewer"], primaryAgentId: "writer" });
  const a = service.view(room.id, first.id).session.contexts.find(c => c.agentId === "reviewer")!.contextId;
  const b = service.view(room.id, second.id).session.contexts.find(c => c.agentId === "reviewer")!.contextId;
  assert.notEqual(a, b);
  service.update(room.id, { agentIds: ["writer"], primaryAgentId: "writer" });
  service.update(room.id, { agentIds: ["writer", "reviewer"], primaryAgentId: "writer" });
  assert.equal(service.view(room.id, first.id).session.contexts.find(c => c.agentId === "reviewer")!.contextId, a);
  assert.equal(service.view(room.id, second.id).session.contexts.find(c => c.agentId === "reviewer")!.contextId, b);
  const other = service.create({ title: "Other", agentIds: ["writer"] });
  assert.throws(() => service.view(other.id, first.id), /conversation unavailable/);
  assert.throws(() => service.send(other.id, { submissionId: "invalid", text: "Hello" }, second.id), /conversation unavailable/);
});


test("the Desktop API creates conversations, selects history and requires an explicit send destination", async (t) => {
  const { service } = fixture(t);
  const { handleRoomRequest } = await import("$lib/server/app/desktopRooms.js");
  const room = service.create({ title: "API conversations", agentIds: ["writer"] });
  const request = (body: unknown) => handleRoomRequest(service, new Request("http://localhost/api/desktop/rooms", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }), new URL("http://localhost/api/desktop/rooms"));
  const created = await (await request({ action: "new_session", roomId: room.id })).json();
  assert.ok(created.session.id);
  assert.notEqual(created.session.id, room.id);
  const url = new URL(`http://localhost/api/desktop/rooms?id=${room.id}&sessionId=${room.id}`);
  const response = await handleRoomRequest(service, new Request(url), url);
  const view = (await response.json()).view;
  assert.equal(view.session.id, room.id);
  assert.equal(view.sessions.length, 2);
  assert.equal((await request({ action: "send", roomId: room.id, submissionId: "missing", text: "Hello" })).status, 400);
  assert.equal((await request({ action: "send", roomId: room.id, sessionId: "foreign", submissionId: "foreign", text: "Hello" })).status, 400);
});

test("stopping a conversation keeps work from other conversations and purge is scoped", async (t) => {
  const { service, calls, store } = fixture(t);
  const room = service.create({ title: "Team", agentIds: ["writer", "reviewer"] });
  const first = service.view(room.id).session;
  service.send(room.id, { submissionId: "first", text: "Discuss old", agentIds: ["writer", "reviewer"] }, first.id);
  await flush();
  const second = service.newSession(room.id);
  service.send(room.id, { submissionId: "second", text: "Discuss new", agentIds: ["writer", "reviewer"] }, second.id);
  await flush();
  assert.equal(calls.length, 4, "separate contexts may discuss concurrently");
  service.stop(room.id, undefined, second.id); await flush();
  assert.ok(service.view(room.id, second.id).executions.every(e => e.status === "cancelled"));
  assert.ok(service.view(room.id, first.id).executions.every(e => e.status === "running"));
  calls[0].finish("Old writer"); calls[1].finish("Old reviewer"); await flush();
  store.purgeSession(second.id);
  assert.equal(store.sessions(room.id).length, 1);
  assert.equal(store.messages(room.id).length, 3);
  assert.equal(store.executions(room.id).length, 2);
  assert.deepEqual(service.view(room.id, first.id).messages.map(m => m.content), ["Discuss old", "Old writer", "Old reviewer"]);
});


test("existing room data is backed up and upgraded once without losing contexts, history or retry identity", async (t) => {
  const { service, calls, store, dir } = fixture(t);
  const room = service.create({ title: "Existing room", agentIds: ["writer", "reviewer"], projectId: "project", permissionMode: "manual" });
  service.send(room.id, { submissionId: "old-first", text: "Original conversation" });
  await flush(); calls[0].finish("Original answer"); await flush();
  const second = service.send(room.id, { submissionId: "old-second", text: "Follow-up" });
  await flush(); calls[1].finish("Follow-up answer"); await flush();
  const before = service.view(room.id);
  store.addResumeSubmission({ ...second, submissionId: "old-resume" }, before.executions[1].id);
  store.saveFile("old-file", room.id, { original: "old.txt", local: "attachments/old.txt", mediaType: "file", size: 3 });
  const file = join(dir, "sessions.db");
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    ALTER TABLE room_participants ADD COLUMN context_id TEXT NOT NULL DEFAULT '';
    UPDATE room_participants SET context_id=(SELECT context_id FROM room_session_contexts c WHERE c.session_id=room_participants.room_id AND c.agent_id=room_participants.agent_id);
    ALTER TABLE room_dispatches RENAME TO room_dispatches_new;
    CREATE TABLE room_dispatches (id TEXT PRIMARY KEY,room_id TEXT NOT NULL,submission_id TEXT NOT NULL,input_json TEXT NOT NULL,UNIQUE(room_id,submission_id));
    INSERT INTO room_dispatches SELECT id,room_id,submission_id,input_json FROM room_dispatches_new;
    DROP TABLE room_dispatches_new;
    DROP TABLE room_session_contexts;
    DROP TABLE room_sessions;
  `);
  for (const row of legacy.prepare("SELECT id,snapshot_json FROM room_executions").all()) {
    const snapshot = JSON.parse(String(row.snapshot_json)).map(({sessionId, ...message}: import("$lib/shared/rooms.js").RoomMessage) => message);
    legacy.prepare("UPDATE room_executions SET snapshot_json=? WHERE id=?").run(JSON.stringify(snapshot), String(row.id));
  }
  legacy.close();
  const upgraded = new RoomStore(file); t.after(() => upgraded.close());
  assert.deepEqual(upgraded.get(room.id), before.room);
  const [first] = upgraded.sessions(room.id);
  assert.equal(first.id, room.id);
  assert.deepEqual(first.contexts, before.session.contexts);
  assert.deepEqual(upgraded.messages(room.id, room.id), before.messages);
  assert.deepEqual(upgraded.executions(room.id, room.id), before.executions.map(({operations, blockedBy, ...execution}) => execution));
  assert.equal(upgraded.resumeSubmission(room.id, "old-resume")?.dispatch.sessionId, room.id);
  assert.equal(upgraded.files(room.id, ["old-file"])[0].original, "old.txt");
  const backups = readdirSync(dir).filter(name => name.startsWith("sessions.db.backup-"));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
  assert.ok(backup.prepare("PRAGMA table_info(room_participants)").all().some(column => column.name === "context_id"));
  assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM room_messages").get()?.n, 4);
  backup.close();
  const reopened = new RoomStore(file); t.after(() => reopened.close());
  assert.deepEqual(reopened.sessions(room.id), upgraded.sessions(room.id));
  assert.equal(readdirSync(dir).filter(name => name.startsWith("sessions.db.backup-")).length, 1);
  const next = service.newSession(room.id);
  assert.notEqual(next.contexts[0].contextId, first.contexts[0].contextId);
  assert.deepEqual(service.view(room.id, next.id).messages, []);
});


test("room execution changes project only their conversation, while recovery projects every conversation", async (t) => {
  const { service, calls, projections } = fixture(t);
  const room = service.create({ title: "Projection", agentIds: ["writer"] });
  const first = service.view(room.id).session;
  const second = service.newSession(room.id);
  projections.length = 0;
  service.send(room.id, { submissionId: "first", text: "First conversation" }, first.id);
  await flush();
  assert.ok(projections.length > 0);
  assert.ok(projections.every(p => p.sessionId === first.id));
  projections.length = 0;
  calls[0].finish("First answer");
  await flush();
  assert.ok(projections.length > 0);
  assert.ok(projections.every(p => p.sessionId === first.id));
  assert.equal(projections.at(-1)!.messages.at(-1)!.content, "First answer");
  projections.length = 0;
  service.send(room.id, { submissionId: "second", text: "Second conversation" }, second.id);
  await flush();
  calls[1].finish("Second answer");
  await flush();
  assert.ok(projections.every(p => p.sessionId === second.id));
  projections.length = 0;
  service.recover();
  assert.deepEqual(new Set(projections.map(p => p.sessionId)), new Set([first.id, second.id]));
});
