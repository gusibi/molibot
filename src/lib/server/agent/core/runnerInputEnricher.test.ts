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

test("a text-only primary model keeps the image available for on-demand reading", async () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|cpa|doubao-seed-2.0-lite"
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

  const ctx = imageContext();
  const { result, notices } = await enrich(settings, ctx);

  assert.equal(result.visionDecision.sendImagesNatively, false);
  assert.equal(result.imageAttachmentCount, 1);
  assert.equal(result.enrichedText, ctx.message.text);
  assert.equal(result.modelUseCase, "text");
  assert.equal(result.activeSelection.modelId, "doubao-seed-2.0-lite");
  assert.deepEqual(notices, []);
});

test("another configured vision model does not replace the text-only primary model", async () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|cpa|text-only"
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

  assert.equal(result.visionDecision.sendImagesNatively, false);
  assert.equal(result.modelUseCase, "text");
  assert.equal(result.activeSelection.modelId, "text-only");
  assert.equal(result.imageAttachmentCount, 1);
  assert.deepEqual(notices, []);
});

test("a turn with no image attachment exposes no image read hint", async () => {
  const ctx = imageContext();
  ctx.message.attachments = [];
  ctx.message.imageContents = [];

  const { result, notices } = await enrich(defaultRuntimeSettings, ctx);

  assert.equal(result.imageAttachmentCount, 0);
  assert.deepEqual(notices, []);
});
