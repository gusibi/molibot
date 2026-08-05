import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings, type RuntimeSettings } from "$lib/server/settings/index.js";
import { prepareEnrichedInput } from "$lib/server/agent/core/runnerInputEnricher.js";
import type { MomContext } from "$lib/server/agent/core/types.js";

function imageContext(): MomContext {
  return {
    channel: "web",
    workspaceDir: "/tmp/molibot-enricher-test",
    message: {
      chatId: "web:default:web-anonymous",
      chatType: "private",
      messageId: 1,
      userId: "web-anonymous",
      userName: "web",
      text: "这张图片是什么内容",
      ts: "1785901038.683",
      attachments: [
        {
          original: "Screenshot.png",
          local: "web/attachments/1_Screenshot.png",
          mediaType: "image",
          mimeType: "image/png",
          size: 4,
          isImage: true,
          isAudio: false,
          isVideo: false
        }
      ],
      imageContents: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }]
    }
  } as unknown as MomContext;
}

async function enrich(settings: RuntimeSettings, ctx: MomContext) {
  const notices: string[] = [];
  const result = await prepareEnrichedInput({
    ctx,
    settings,
    respondInThread: async (text) => {
      notices.push(text);
    },
    runId: "run-1",
    chatId: ctx.message.chatId,
    sessionId: "s-1"
  });
  return { result, notices };
}

test("an image the fallback route could not describe is reported as unreadable, not silently dropped", async () => {
  // The shipped failure: nothing readable ever reached the model, which was
  // handed only the attachment path and spent the turn hunting for an OCR tool.
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|cpa|doubao-seed-2.0-lite",
      // Declared `vision` but unverified: the route exists, so the runtime
      // describes the image out-of-band instead of sending it natively.
      visionModelKey: "custom|cpa|seer"
    },
    customProviders: [
      {
        id: "cpa",
        name: "CLI Proxy",
        enabled: true,
        baseUrl: "https://proxy.example/v1",
        apiKey: "sk-proxy-secret-12345678",
        path: "/chat/completions",
        defaultModel: "doubao-seed-2.0-lite",
        models: [
          {
            id: "doubao-seed-2.0-lite",
            enabled: true,
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool"]
          },
          {
            id: "seer",
            enabled: true,
            tags: ["vision"],
            supportedRoles: ["system", "user", "assistant", "tool"]
          }
        ]
      }
    ]
  } as RuntimeSettings;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("upstream is down", { status: 503 })) as typeof globalThis.fetch;
  try {
    const ctx = imageContext();
    const { result, notices } = await enrich(settings, ctx);

    assert.equal(result.visionDecision.sendImagesNatively, false);
    assert.equal(result.unreadableImageCount, 1, "the runner must be told the image went unread");
    // The text handed to the model must not pretend an analysis happened.
    assert.ok(!result.enrichedText.includes("[image analysis"));
    assert.equal(result.enrichedText, ctx.message.text);
    // And the user still gets the downgrade notice.
    assert.equal(notices.length, 1);
    assert.match(notices[0], /图片识别不可用/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a native vision route leaves nothing unreadable", async () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|cpa|text-only",
      visionModelKey: "custom|cpa|seer"
    },
    customProviders: [
      {
        id: "cpa",
        name: "CLI Proxy",
        enabled: true,
        baseUrl: "https://proxy.example/v1",
        apiKey: "sk-proxy-secret-12345678",
        path: "/chat/completions",
        defaultModel: "text-only",
        models: [
          {
            id: "text-only",
            enabled: true,
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool"]
          },
          {
            id: "seer",
            enabled: true,
            tags: ["vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant", "tool"]
          }
        ]
      }
    ]
  } as RuntimeSettings;

  const { result, notices } = await enrich(settings, imageContext());

  assert.equal(result.visionDecision.sendImagesNatively, true);
  assert.equal(result.modelUseCase, "vision");
  assert.equal(result.unreadableImageCount, 0);
  assert.deepEqual(notices, []);
});

test("a turn with no image attachment has nothing unreadable", async () => {
  const ctx = imageContext();
  ctx.message.attachments = [];
  ctx.message.imageContents = [];

  const { result, notices } = await enrich(defaultRuntimeSettings, ctx);

  assert.equal(result.unreadableImageCount, 0);
  assert.deepEqual(notices, []);
});
