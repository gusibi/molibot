import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ownedNativeModelRuntime } from "./pi-native-model-runtime.mjs";

const model = {provider:"custom",id:"fixture",api:"fixture"};
const message = {role:"assistant",content:[],provider:model.provider,model:model.id,api:model.api,stopReason:"stop",usage:{totalTokens:3}};
function runtime() {
  return {calls:0, getRegisteredNativeProvider() {}, stream(_model,_context,options) {
    this.calls++; assert.equal(options.maxRetries,0);
    const events = createAssistantMessageEventStream();
    events.push({type:"done",reason:"stop",message}); events.end(message); return events;
  }};
}

test("extension providers require host admission before any work and report usage once", async () => {
  const base = runtime();
  const ledger = [];
  const wrapped = ownedNativeModelRuntime(base,new Map(),async(method,input)=> {
    ledger.push([method,input]); return {permit:"receipt"};
  });
  assert.deepEqual(await wrapped.complete(model,{},{}),message);
  assert.equal(base.calls,1);
  assert.equal(ledger[0][0],"nativeModel.before");
  assert.deepEqual(ledger[1],["nativeModel.usage",{permit:"receipt",usage:{totalTokens:3}}]);
});

test("denied native providers never reach the provider, including a replacement of a host provider", async () => {
  const base = runtime();
  const bridge = {};
  const wrapped = ownedNativeModelRuntime(base,new Map([["custom",bridge]]),async()=> {throw new Error("budget exhausted");});
  const result = await wrapped.complete(model,{},{});
  assert.equal(base.calls,0);
  assert.equal(result.stopReason,"error");
  assert.match(result.errorMessage,/budget exhausted/);
});

test("denied classifier and image work returns native error results without provider execution", async () => {
  const base = runtime();
  const wrapped = ownedNativeModelRuntime(base,new Map(),async()=>{throw new Error("not authorized");});
  const classified = await wrapped.classify(model,{},{});
  assert.equal(classified.stopReason,"error");
  assert.deepEqual(classified.answers,{});
  const generated = await wrapped.generateImages(model,{},{});
  assert.equal(generated.stopReason,"error");
  assert.deepEqual(generated.output,[]);
  assert.equal(base.calls,0);
});
