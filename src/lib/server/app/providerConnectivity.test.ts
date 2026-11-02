import assert from "node:assert/strict";
import test from "node:test";
import { checkProviderConnectivity, pickProbeModel } from "$lib/server/app/providerConnectivity.js";
import { getPiModels } from "$lib/server/providers/piRuntime.js";

for (const providerId of ["opencode", "opencode-go"]) {
  test(`${providerId} connectivity probes send a fresh session header through Pi`, async (t) => {
    const model = getPiModels().getModels(providerId).find(model => model.api === "openai-completions")!;
    assert.ok(model);
    const sessions: string[] = [];
    t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      const session = new Headers(init?.headers).get("x-opencode-session");
      sessions.push(session ?? "");
      if (!session) return new Response(JSON.stringify({ error: { type: "MissingSessionID" } }), { status: 400 });
      return new Response('data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"PONG"},"finish_reason":null}]}\n\ndata: {"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" }
      });
    });
    for (let index = 0; index < 2; index++) {
      const result = await checkProviderConnectivity({ providerId, modelId: model.id, apiKey: "fixture-key" });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.reply, "PONG");
    }
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every(Boolean));
    assert.notEqual(sessions[0], sessions[1]);
  });
}

const catalog = [
  { id: "model-a", provider: "fake", api: "anthropic-messages" },
  { id: "model-b", provider: "fake", api: "anthropic-messages" }
] as any[];

function streamOf(events: unknown[]) {
  return () => (async function* () {
    for (const event of events) yield event;
  })() as any;
}

test("a named model is honoured, and an unknown one falls back instead of failing the probe", () => {
  assert.equal(pickProbeModel(catalog, "model-b")?.id, "model-b");
  // A stale defaultModel saved in settings must not make a working credential
  // look broken.
  assert.equal(pickProbeModel(catalog, "gone")?.id, "model-a");
  assert.equal(pickProbeModel(catalog, undefined)?.id, "model-a");
  assert.equal(pickProbeModel([], "model-a"), undefined);
});

test("a reply through the shared stream path counts as reachable", async () => {
  const result = await checkProviderConnectivity({
    providerId: "fake",
    catalog: () => catalog,
    streamFn: streamOf([
      { type: "text_delta", delta: "PONG" },
      { type: "done", message: { stopReason: "stop" } }
    ])
  });

  assert.equal(result.ok, true);
  assert.equal(result.modelId, "model-a");
  assert.equal(result.reply, "PONG");
});

test("a saved built-in API key is forwarded to the real Pi stream", async () => {
  let receivedOptions: Record<string, unknown> | undefined;
  const result = await checkProviderConnectivity({
    providerId: "fake",
    catalog: () => catalog,
    apiKey: "saved-key",
    streamFn: ((_model: unknown, _context: unknown, options: Record<string, unknown>) => {
      receivedOptions = options;
      return streamOf([
        { type: "text_delta", delta: "PONG" },
        { type: "done", message: { stopReason: "stop" } }
      ])();
    }) as any
  } as any);

  assert.equal(result.ok, true);
  assert.equal(receivedOptions?.apiKey, "saved-key");
});

test("a provider error is reported as unreachable with the credential stripped out", async () => {
  const result = await checkProviderConnectivity({
    providerId: "fake",
    catalog: () => catalog,
    streamFn: streamOf([
      {
        type: "done",
        message: {
          stopReason: "error",
          errorMessage: 'refused with Authorization: Bearer sk-live-abcdef and {"access_token":"zzz"}'
        }
      }
    ])
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.includes("sk-live-abcdef"), false);
  assert.equal(result.error?.includes("zzz"), false);
  assert.match(result.error ?? "", /redacted/);
});

test("an accepted request that returns nothing is not a working route", async () => {
  const result = await checkProviderConnectivity({
    providerId: "fake",
    catalog: () => catalog,
    streamFn: streamOf([{ type: "done", message: { stopReason: "stop" } }])
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no content/i);
});

test("a provider with no built-in models reports that instead of throwing", async () => {
  const result = await checkProviderConnectivity({
    providerId: "empty",
    catalog: () => [],
    streamFn: streamOf([])
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /No built-in models/);
});

test("a stalled provider is cut off by the timeout rather than held open", async () => {
  const result = await checkProviderConnectivity({
    providerId: "fake",
    catalog: () => catalog,
    timeoutMs: 10,
    streamFn: ((_model: unknown, _context: unknown, options: { signal?: AbortSignal }) =>
      (async function* () {
        await new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          setTimeout(resolve, 5_000);
        });
        yield { type: "text_delta", delta: "too late" };
      })()) as any
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /did not respond within/);
});
