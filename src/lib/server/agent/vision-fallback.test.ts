import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "../settings/defaults.js";
import type { RuntimeSettings } from "../settings/schema.js";
import { readWorkspaceVisionSmokeImage } from "../providers/visionSmokeFixture.js";
import { describeImageViaConfiguredProvider } from "./vision-fallback.js";

function settingsForProtocol(protocol: "openai-compatible" | "anthropic"): RuntimeSettings {
  const path = protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
  return {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      visionModelKey: "custom|vision-provider|vision-model"
    },
    customProviders: [
      {
        id: "vision-provider",
        name: "Vision Provider",
        enabled: true,
        protocol,
        baseUrl: "https://vision.example",
        apiKey: "test-key",
        path,
        defaultModel: "vision-model",
        models: [
          {
            id: "vision-model",
            tags: ["text", "vision"],
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };
}

test("OpenAI-compatible image fallback sends image_url content", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-vision-fixture-"));
  const fixture = readWorkspaceVisionSmokeImage(workspaceDir);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Description: ok" } }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await describeImageViaConfiguredProvider({
      channel: "test",
      settings: settingsForProtocol("openai-compatible"),
      image: { type: "image", mimeType: fixture.mimeType, data: fixture.data },
      maxAttempts: 1
    });

    assert.equal(result.errorMessage, null);
    assert.equal(calls[0].url, "https://vision.example/v1/chat/completions");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].content[1].type, "image_url");
    assert.equal(body.messages[1].content[1].image_url.url, `data:${fixture.mimeType};base64,${fixture.data}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Anthropic image fallback sends top-level system and image source content", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-vision-fixture-"));
  const fixture = readWorkspaceVisionSmokeImage(workspaceDir);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "Description: ok" }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await describeImageViaConfiguredProvider({
      channel: "test",
      settings: settingsForProtocol("anthropic"),
      image: { type: "image", mimeType: fixture.mimeType, data: fixture.data },
      maxAttempts: 1
    });

    assert.equal(result.errorMessage, null);
    assert.equal(calls[0].url, "https://vision.example/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["api-key"], "test-key");
    assert.equal(headers["x-api-key"], "test-key");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(typeof body.system, "string");
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content[1].type, "image");
    assert.deepEqual(body.messages[0].content[1].source, {
      type: "base64",
      media_type: fixture.mimeType,
      data: fixture.data
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
