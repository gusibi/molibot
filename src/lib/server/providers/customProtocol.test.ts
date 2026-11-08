import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildAnthropicBaseUrl,
  buildAnthropicCompatibleHeaders,
  buildOpenAICompatibleHeaders,
  callDirectCustomProvider,
  testCustomProvider
} from "$lib/server/providers/customProtocol.js";
import { readWorkspaceVisionSmokeImage } from "$lib/server/providers/visionSmokeFixture.js";
import type { CustomProviderConfig } from "$lib/server/settings/index.js";

for (const protocol of ["openai-compatible", "anthropic"] as const) {
  test(`${protocol} provider probes share one session header across capability checks`, async (t) => {
    const sessions: string[] = [];
    t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      const session = new Headers(init?.headers).get("x-molibot-session");
      sessions.push(session ?? "");
      return new Response(JSON.stringify(session ? { choices: [{ message: { content: "ok" } }] } : { error: "MissingSessionID" }), {
        status: session ? 200 : 400
      });
    });
    const payload = { protocol, baseUrl: "https://example.invalid", apiKey: "fixture-key", model: "fixture-unknown-model", tags: ["text", "vision"] as ("text" | "vision")[] };
    const first = await testCustomProvider(payload);
    assert.equal(first.ok, true, first.message);
    assert.equal(first.verification.vision, "passed");
    const count = sessions.length;
    assert.equal(count, protocol === "anthropic" ? 2 : 3);
    assert.ok(sessions[0]);
    assert.ok(sessions.every(session => session === sessions[0]));
    assert.equal((await testCustomProvider(payload)).ok, true);
    assert.ok(sessions[count]);
    assert.notEqual(sessions[0], sessions[count]);
  });
}

test("custom protocol helpers build documented image-capable request headers", () => {
  assert.deepEqual(buildOpenAICompatibleHeaders({ apiKey: "test-key" }), {
    "Content-Type": "application/json",
    Authorization: "Bearer test-key"
  });
  assert.deepEqual(buildAnthropicCompatibleHeaders({ apiKey: "test-key" }), {
    "Content-Type": "application/json",
    "api-key": "test-key",
    "x-api-key": "test-key",
    "anthropic-version": "2023-06-01"
  });
});

test("background direct provider calls carry the session affinity header", async () => {
  const originalFetch = globalThis.fetch;
  const headers: Headers[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    headers.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  const provider: CustomProviderConfig = {
    id: "cli-proxy",
    name: "CliProxy",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "https://example.invalid",
    apiKey: "test-key",
    models: [],
    defaultModel: "model",
    path: "/v1/chat/completions"
  };
  const history = [{ id: "m1", conversationId: "c1", role: "user", content: "hi", createdAt: "2026-10-26T00:00:00.000Z" }] as never;
  const settings = { defaultThinkingLevel: "off", systemPrompt: "system", maxOutputTokens: 100 } as never;
  try {
    await callDirectCustomProvider(provider, "model", history, settings, "", "s-test");
    await callDirectCustomProvider(provider, "model", history, settings, "");
    assert.equal(headers[0]?.get("x-molibot-session"), "s-test");
    assert.equal(headers[1]?.get("x-molibot-session"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("direct provider usage follows the shared ledger contract on both protocols", async (t) => {
  const history = [{ id: "m1", conversationId: "c1", role: "user", content: "hi", createdAt: "2026-10-26T00:00:00.000Z" }] as never;
  const settings = { defaultThinkingLevel: "off", systemPrompt: "system", maxOutputTokens: 100 } as never;
  const provider = (protocol: CustomProviderConfig["protocol"]): CustomProviderConfig => ({
    id: "fixture", name: "Fixture", enabled: true, protocol, baseUrl: "https://example.invalid",
    apiKey: "test-key", models: [], defaultModel: "model", path: "/v1/chat/completions"
  });

  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 800 } }
  }), { status: 200 }));
  // prompt_tokens includes the cached prefix: uncached input is 200, never 1000 + 800.
  assert.deepEqual((await callDirectCustomProvider(provider("openai-compatible"), "model", history, settings, "")).usage, {
    input: 200, output: 50, cacheRead: 800, cacheWrite: 0, totalTokens: 1050
  });

  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 }
  }), { status: 200 }));
  // Anthropic reports cache separately from input_tokens; the total must include it.
  assert.deepEqual((await callDirectCustomProvider(provider("anthropic"), "model", history, settings, "")).usage, {
    input: 20, output: 30, cacheRead: 900, cacheWrite: 100, totalTokens: 1050
  });
});

test("MiMo Anthropic path preserves the /anthropic prefix for SDK baseUrl", () => {
  assert.equal(
    buildAnthropicBaseUrl(
      "https://api.xiaomimimo.com",
      "/anthropic/v1/messages"
    ),
    "https://api.xiaomimimo.com/anthropic"
  );
});

test("custom provider vision probe uses the workspace smoke image", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-provider-fixture-"));
  const fixture = readWorkspaceVisionSmokeImage(workspaceDir);
  const requests: Array<Record<string, any>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await testCustomProvider({
      protocol: "openai-compatible",
      baseUrl: "https://provider.example",
      apiKey: "test-key",
      path: "/v1/chat/completions",
      model: "vision-model",
      tags: ["text", "vision"],
      testImage: {
        mimeType: fixture.mimeType,
        data: fixture.data
      }
    });

    assert.equal(result.verification.vision, "passed");
    const visionRequest = requests[2];
    assert.equal(
      visionRequest.messages[0].content[1].image_url.url,
      `data:${fixture.mimeType};base64,${fixture.data}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
