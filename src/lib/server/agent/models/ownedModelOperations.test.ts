import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedModelStream } from "./ownedModelOperations.js";

test("native callbacks remain transient while the committed model arguments stay JSON", async () => {
  const onPayload = async (payload: unknown, _model?: unknown) => ({ payload, transformed: true });
  let persisted: any;
  let calls = 0;
  const owned = createOwnedModelStream(async (input, emit) => {
    calls++;
    assert.equal(input.onPayload, onPayload);
    assert.deepEqual(await input.onPayload?.("request", {} as any), { payload: "request", transformed: true });
    emit("partial");
    return { message: { stopReason: "stop" } as any };
  }, { wrap: tool => tool, invoke: async (tool, id, args, signal) => {
    persisted = structuredClone(args);
    assert.equal(JSON.stringify(persisted).includes("onPayload"), false);
    return { result: await tool.execute(id, persisted, signal), isError: false };
  }});
  const events: unknown[] = [];
  await owned.stream({ model: { provider: "fixture", id: "fixture" }, context: {} as any, simple: false, options: {}, onPayload }, event => events.push(event), new AbortController().signal);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["partial"]);
  assert.equal(persisted.requiresNativeCallbacks, true);
  await assert.rejects(owned.tool.execute("recovered", persisted, new AbortController().signal), /callbacks are unavailable after restart/);
  assert.equal(calls, 1, "recovery must not send another billable request without its original transforms");
});
