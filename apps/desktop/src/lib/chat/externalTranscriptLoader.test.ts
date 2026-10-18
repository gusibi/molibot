import assert from "node:assert/strict";
import test from "node:test";
import { ExternalTranscriptLoader, type TranscriptState } from "./externalTranscriptLoader";

function harness() {
  const requests: { endpoint: string; id: string; signal: AbortSignal; resolve(value: string): void; reject(error: Error): void }[] = [];
  const loader = new ExternalTranscriptLoader<string>((endpoint, id, signal) => new Promise((resolve, reject) => {
    requests.push({ endpoint, id, signal, resolve, reject });
  }));
  let state: TranscriptState<string> | undefined;
  const publish = (value: TranscriptState<string>) => { state = value; };
  return { loader, requests, publish, state: () => state };
}

test("late history response cannot replace the selected channel session or its loading state", async () => {
  const h = harness();
  const a = h.loader.select("server", "feishu", h.publish);
  const b = h.loader.select("server", "weixin", h.publish);
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve("old");
  await a;
  assert.deepEqual(h.state(), { transcript: null, loading: true, error: "" });
  h.requests[1].resolve("selected");
  await b;
  assert.equal(h.state()?.transcript, "selected");
});

test("revisiting history displays cache immediately and refreshes it without a blank loading screen", async () => {
  const h = harness();
  const first = h.loader.select("server", "feishu", h.publish);
  h.requests[0].resolve("history");
  await first;
  h.loader.close();
  const revisit = h.loader.select("server", "feishu", h.publish);
  assert.deepEqual(h.state(), { transcript: "history", loading: false, error: "" });
  h.requests[1].resolve("fresh history");
  await revisit;
  assert.equal(h.state()?.transcript, "fresh history");
  const other = h.loader.select("other server", "feishu", h.publish);
  assert.equal(h.state()?.transcript, null);
  h.requests[2].reject(new Error("unavailable"));
  await other;
  assert.equal(h.state()?.error, "unavailable");
});

test("closing or disconnecting invalidates in-flight results; a failed selection can retry", async () => {
  const h = harness();
  const pending = h.loader.select("server", "feishu", h.publish);
  h.loader.clear();
  h.requests[0].resolve("discarded");
  await pending;
  assert.equal(h.state()?.transcript, null);
  const failure = h.loader.select("server", "feishu", h.publish);
  h.requests[1].reject(new Error("503"));
  await failure;
  const retry = h.loader.select("server", "feishu", h.publish);
  h.requests[2].resolve("recovered");
  await retry;
  assert.equal(h.state()?.transcript, "recovered");
});

test("a failed refresh preserves cached messages and reports the failure, then recovers", async () => {
  const h = harness();
  const first = h.loader.select("server", "qq", h.publish);
  h.requests[0].resolve("yesterday");
  await first;
  const refresh = h.loader.select("server", "qq", h.publish);
  h.requests[1].reject(new Error("Service unavailable"));
  await refresh;
  assert.deepEqual(h.state(), { transcript: "yesterday", loading: false, error: "Service unavailable" });
  const recovery = h.loader.select("server", "qq", h.publish);
  h.requests[2].resolve("today");
  await recovery;
  assert.deepEqual(h.state(), { transcript: "today", loading: false, error: "" });
});
