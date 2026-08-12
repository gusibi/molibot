import assert from "node:assert/strict";
import test from "node:test";
import { checkProviderConnectivity, pickProbeModel } from "$lib/server/app/providerConnectivity.js";

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
