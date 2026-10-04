import type { Models, ImagesInputContent } from "@earendil-works/pi-ai";
import { parseModelKey } from "$lib/server/agent/routing/modelRouting.js";
import { assertPublicHttpUrl } from "$lib/server/agent/webFetch/webFetchTool.js";
import type { ImageGenerateProvider } from "./types.js";

export function listPiImageModels(models: Models) {
  return models.getAllModels().filter(model => model.type === "image").map(model => ({
    key: `pi|${model.provider}|${model.id}`, provider: model.provider, model: model.id,
    name: model.name, supportsReferenceImages: model.input.includes("image")
  }));
}

/** Uses the same provider identity and credentials as Pi chat requests. */
export function createPiImageProvider(models: Models): ImageGenerateProvider {
  return {
    id: "pi",
    async generate(input, context) {
      const selection = parseModelKey(input.model ?? context.settings.engines.pi?.model ?? "");
      const model = selection?.mode === "pi"
        ? models.getModelOfType("image", selection.provider, selection.model) : undefined;
      if (!model) throw new Error("Select an available Pi image model in image generation settings.");
      if (input.seed !== undefined) throw new Error("Pi image generation does not support the seed parameter.");
      if (input.size) throw new Error("Pi image generation does not support the size parameter.");
      if (input.images?.length && !model.input.includes("image")) {
        throw new Error("The selected Pi image model does not support reference images.");
      }
      context.signal?.throwIfAborted();
      const content: ImagesInputContent[] = [{ type: "text", text: input.prompt }];
      for (const url of input.images ?? []) {
        const target = await assertPublicHttpUrl(url);
        const response = await context.fetch(target, { signal: context.signal, redirect: "error" });
        if (!response.ok) throw new Error(`Reference image download failed: HTTP ${response.status}.`);
        const mimeType = response.headers.get("content-type")?.split(";")[0].trim();
        if (!mimeType?.startsWith("image/")) throw new Error("Reference URL must return an image MIME type.");
        const maxBytes = 10 * 1024 * 1024;
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Reference image has no response body.");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            context.signal?.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > maxBytes) throw new Error("Reference image exceeds 10 MiB.");
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        content.push({ type: "image", mimeType, data: Buffer.concat(chunks).toString("base64") });
      }
      const result = await models.generateImages(model, { input: content }, {
        signal: context.signal, fetch: context.fetch, maxRetries: 0
      });
      const text = result.output.filter(block => block.type === "text").map(block => block.text).join("\n");
      context.onProviderResult?.({ text, usage: result.usage });
      context.signal?.throwIfAborted();
      if (result.stopReason === "aborted") throw new DOMException("Image generation aborted.", "AbortError");
      if (result.stopReason === "error") throw new Error(result.errorMessage || "Pi image generation failed.");
      const images = result.output.flatMap(block => block.type === "image"
        ? [{ imageBuffer: Buffer.from(block.data, "base64"), mimeType: block.mimeType }] : []);
      if (!images.length || images.some(image => image.imageBuffer.byteLength === 0)) throw new Error("Pi returned no images.");
      return { images, text, usage: result.usage };
    }
  };
}
