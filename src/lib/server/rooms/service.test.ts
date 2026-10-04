import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomStore } from "./store.js";
import { RoomService, type RoomRunner } from "./service.js";

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "molibot-room-"));
  const store = new RoomStore(join(dir, "sessions.db"));
  const calls: Array<{ agentId: string; mode: string; text: string; finish: (text: string) => void }> = [];
  const service = new RoomService({
    store,
    agents: () => [{ id: "writer", name: "Writer", description: "", enabled: true }, { id: "reviewer", name: "Reviewer", description: "", enabled: true }],
    createSession: () => ({ id: crypto.randomUUID() }),
    isSessionAvailable: () => true,
    createRunner: (input) => {
      const runner: RoomRunner = {
        abort: () => resolve?.({ status: "cancelled", text: "partial" }),
        steer: () => true,
        run: async (hooks) => new Promise((finish) => {
          resolve = finish;
          calls.push({ agentId: input.agentId, mode: input.mode, text: input.text, finish: (text) => {
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
  return { service, store, calls, dir };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  assert.deepEqual(calls.slice(2).map(c => c.mode), ["plan", "plan"]);
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
  const { service } = fixture(t);
  const room = service.create({ title: "Members", agentIds: ["writer", "reviewer"] });
  const context = room.participants.find(p => p.agentId === "reviewer")!.contextId;
  service.send(room.id, { submissionId: "work", text: "Review", agentIds: ["reviewer"] });
  await flush();
  service.update(room.id, { agentIds: ["writer"], primaryAgentId: "writer" }); await flush();
  assert.throws(() => service.send(room.id, { submissionId: "bad", text: "Hi", agentIds: ["reviewer"] }), /current Room member/);
  const updated = service.update(room.id, { agentIds: ["writer", "reviewer"], primaryAgentId: "writer" });
  assert.equal(updated.participants.find(p => p.agentId === "reviewer")!.contextId, context);
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
  const input = { action: "send", roomId: room.id, submissionId: "api-1", text: "Hello" };
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
  service.resume(room.id, e.id, "retry"); await flush();
  const entries = service.view(room.id).executions;
  assert.equal(entries[1].retryOf, e.id);
  assert.equal(entries[0].status, "failed");
  calls[1].finish("Continued"); await flush();
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
  store.saveFile("f", room.id, { original: "a.txt", local: "a.txt", mediaType: "file" });
  store.purge(room.id);
  assert.equal(store.get(room.id), null);
  assert.deepEqual(store.messages(room.id), []);
  assert.deepEqual(store.executions(room.id), []);
  assert.deepEqual(store.operations(e.id), []);
  assert.deepEqual(store.events(room.id), []);
  assert.equal(store.fileByLocal(room.id, "a.txt"), undefined);
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
