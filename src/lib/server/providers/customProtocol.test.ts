import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildAnthropicBaseUrl,
  buildAnthropicCompatibleHeaders,
  buildOpenAICompatibleHeaders,
  testCustomProvider
} from "./customProtocol.js";
import { readWorkspaceVisionSmokeImage } from "./visionSmokeFixture.js";

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
