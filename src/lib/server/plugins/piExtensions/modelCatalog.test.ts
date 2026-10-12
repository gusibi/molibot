import assert from "node:assert/strict";
import test from "node:test";
import type { Models } from "@earendil-works/pi-ai";
import { createPiExtensionModelCatalog } from "$lib/server/plugins/piExtensions/modelCatalog.js";

function fakeModels(): Models {
  return {
    getModels: () => [{ provider: "openai", id: "gpt", name: "GPT", api: "openai", headers: { authorization: "secret" } }],
    getModelsOfType: (type: string) => type === "classifier"
      ? [{ provider: "openai", id: "typesafe", api: "classifier" }]
      : [{ provider: "anthropic", id: "dalle", name: "DALL-E", api: "image" }],
    checkAuth: async (provider: string) => provider === "openai" ? { ok: true } : undefined
  } as unknown as Models;
}

test("the catalog exposes identity only and resolves provider availability", async () => {
  const catalog = await createPiExtensionModelCatalog(fakeModels())();
  assert.deepEqual(catalog.chat, [{ provider: "openai", id: "gpt", name: "GPT", api: "openai" }]);
  assert.deepEqual(catalog.classifier, [{ provider: "openai", id: "typesafe", name: "typesafe", api: "classifier" }]);
  assert.deepEqual(catalog.image, [{ provider: "anthropic", id: "dalle", name: "DALL-E", api: "image" }]);
  assert.deepEqual(catalog.providerAuth, { openai: true, anthropic: false });
  assert.equal(JSON.stringify(catalog).includes("secret"), false);
});

test("a credential lookup that throws is reported as unavailable", async () => {
  const models = fakeModels();
  (models as unknown as { checkAuth: () => Promise<unknown> }).checkAuth = async () => { throw new Error("boom"); };
  const catalog = await createPiExtensionModelCatalog(models)();
  assert.deepEqual(catalog.providerAuth, { openai: false, anthropic: false });
});
