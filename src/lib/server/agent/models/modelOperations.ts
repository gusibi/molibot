import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  ClassifierModel,
  ClassifierQuestion,
  ImagesInputContent,
  Model,
  Models
} from "@earendil-works/pi-ai";

/** One model a script may ask for; `available` reflects credentials, not permission. */
export interface ModelCatalogEntry {
  /** Stable `type|provider|id` key accepted by classify/generateImages. */
  key: string;
  type: "classifier" | "image";
  provider: string;
  model: string;
  name: string;
  /** Provider credentials are configured; a call may still be refused by policy. */
  available: boolean;
  supportsReferenceImages?: boolean;
}

export interface ModelUsageReceipt {
  kind: "classify" | "generateImages";
  key: string;
  provider: string;
  model: string;
  usage?: unknown;
}

export interface GenerateImagesResult {
  model: string;
  /** Each item is ready for the sandbox `image()` helper (an MCP ImageContent block plus a workspace ref). */
  images: Array<{ type: "image"; ref: string; mimeType: string; data: string }>;
  text?: string;
  usage?: unknown;
}

export interface ClassifyResult {
  model: string;
  answers: Record<string, unknown>;
  usage?: unknown;
}

/**
 * The one entry Codemode and pi extensions share for model work. The host
 * resolves the model and credentials; callers only ever see catalog metadata
 * and serialized results — never a Provider object or a raw credential.
 */
export interface ModelOperations {
  catalog(): Promise<ModelCatalogEntry[]>;
  classify(input: { model?: string; state: Record<string, unknown>; questions: Record<string, ClassifierQuestion> }, signal?: AbortSignal): Promise<ClassifyResult>;
  generateImages(input: { model?: string; prompt: string; images?: string[] }, signal?: AbortSignal): Promise<GenerateImagesResult>;
}

export interface PiModelOperationsDeps {
  models: Models;
  /** Directory (absolute) where generated images are persisted. */
  artifactDir: string;
  /** Workspace-relative prefix used for returned artifact refs. */
  workspaceDir: string;
  /** Shared side-effect gate: throws to refuse a call (Plan mode, denied approval, revoked authority). */
  authorize?: (operation: "classify" | "generateImages", details: { key: string }) => void | Promise<void>;
  /** Reserve budget before the request; throws when the run budget is exhausted. */
  beforeCall?: (operation: "classify" | "generateImages", details: { key: string }) => void;
  /** Record usage/cost after the request; a missing provider price stays unknown, never zero. */
  onUsage?: (receipt: ModelUsageReceipt) => void;
  fetch?: typeof fetch;
}

const IMAGE_MIME_EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif" };

function modelKey(type: "classifier" | "image", provider: string, id: string): string {
  return `${type}|${provider}|${id}`;
}

function parseKey(key: string): { type: "classifier" | "image"; provider: string; id: string } | undefined {
  const [type, provider, ...rest] = key.split("|");
  const id = rest.join("|");
  if ((type !== "classifier" && type !== "image") || !provider || !id) return undefined;
  return { type, provider, id };
}

function decodeDataUrl(url: string): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url.trim());
  return match ? { mimeType: match[1]!, data: match[2]! } : undefined;
}

export function createPiModelOperations(deps: PiModelOperationsDeps): ModelOperations {
  const doFetch = deps.fetch ?? globalThis.fetch;

  function locate(type: "classifier" | "image", key?: string) {
    if (key) {
      const parsed = parseKey(key);
      if (!parsed || parsed.type !== type) return undefined;
      return type === "classifier"
        ? deps.models.getModelOfType("classifier", parsed.provider, parsed.id)
        : deps.models.getModelOfType("image", parsed.provider, parsed.id);
    }
    const candidates = type === "classifier" ? deps.models.getModelsOfType("classifier") : deps.models.getModelsOfType("image");
    return candidates[0];
  }

  async function referenceInputs(images: string[] | undefined, signal: AbortSignal | undefined): Promise<ImagesInputContent[]> {
    const content: ImagesInputContent[] = [];
    for (const entry of images ?? []) {
      signal?.throwIfAborted();
      const inline = decodeDataUrl(entry);
      if (inline) { content.push({ type: "image", mimeType: inline.mimeType, data: inline.data }); continue; }
      const url = new URL(entry);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Reference images must be an https URL or a data URL.");
      const response = await doFetch(url, { signal, redirect: "error" });
      if (!response.ok) throw new Error(`Reference image download failed: HTTP ${response.status}.`);
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (!mimeType?.startsWith("image/")) throw new Error("Reference URL must return an image MIME type.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Reference image exceeds 10 MiB.");
      content.push({ type: "image", mimeType, data: bytes.toString("base64") });
    }
    return content;
  }

  return {
    async catalog(): Promise<ModelCatalogEntry[]> {
      const entries: ModelCatalogEntry[] = [];
      for (const type of ["classifier", "image"] as const) {
        const models = type === "classifier" ? deps.models.getModelsOfType("classifier") : deps.models.getModelsOfType("image");
        for (const model of models) {
          let available = false;
          try { available = (await deps.models.checkAuth(model.provider)) !== undefined; }
          catch { available = false; }
          entries.push({ key: modelKey(type, model.provider, model.id), type, provider: model.provider, model: model.id,
            name: model.name, available,
            ...(type === "image" ? { supportsReferenceImages: (model as { input?: unknown[] }).input?.includes("image") === true } : {}) });
        }
      }
      return entries;
    },

    async classify(input, signal) {
      const model = locate("classifier", input.model) as ClassifierModel<any> | undefined;
      if (!model) throw new Error(input.model ? `No classifier model for "${input.model}". Call models.list() to see valid keys.` : "No classifier model is available.");
      await deps.authorize?.("classify", { key: modelKey("classifier", model.provider, model.id) });
      deps.beforeCall?.("classify", { key: modelKey("classifier", model.provider, model.id) });
      const result = await deps.models.classify(model, { state: input.state as import("@earendil-works/pi-ai").JsonObject, questions: input.questions }, { signal });
      if (result.stopReason === "aborted") throw new DOMException("Classification aborted.", "AbortError");
      if (result.stopReason === "error") throw new Error(result.errorMessage || "Classification failed.");
      deps.onUsage?.({ kind: "classify", key: modelKey("classifier", model.provider, model.id), provider: model.provider, model: model.id, usage: result.usage });
      return { model: result.model, answers: result.answers, usage: result.usage };
    },

    async generateImages(input, signal) {
      const model = locate("image", input.model) as import("@earendil-works/pi-ai").ImageModel<import("@earendil-works/pi-ai").ImageApi> | undefined;
      if (!model) throw new Error(input.model ? `No image model for "${input.model}". Call models.list() to see valid keys.` : "No image model is available.");
      if (input.images?.length && (model as { input?: unknown[] }).input?.includes("image") !== true) {
        throw new Error("The selected image model does not support reference images.");
      }
      await deps.authorize?.("generateImages", { key: modelKey("image", model.provider, model.id) });
      deps.beforeCall?.("generateImages", { key: modelKey("image", model.provider, model.id) });
      const content: ImagesInputContent[] = [{ type: "text", text: input.prompt }];
      content.push(...await referenceInputs(input.images, signal));
      const result = await deps.models.generateImages(model, { input: content }, { signal, maxRetries: 0 });
      if (result.stopReason === "aborted") throw new DOMException("Image generation aborted.", "AbortError");
      if (result.stopReason === "error") throw new Error(result.errorMessage || "Image generation failed.");
      const text = result.output.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      const images: GenerateImagesResult["images"] = [];
      await mkdir(deps.artifactDir, { recursive: true, mode: 0o700 });
      for (const block of result.output) {
        if (block.type !== "image") continue;
        signal?.throwIfAborted();
        const extension = IMAGE_MIME_EXTENSIONS[block.mimeType];
        if (!extension) throw new Error(`Unsupported generated image MIME type: ${block.mimeType}`);
        const name = `codemode-image-${createHash("sha256").update(`${block.data}:${images.length}`).digest("hex").slice(0, 24)}${extension}`;
        const path = join(deps.artifactDir, name);
        await writeFile(path, Buffer.from(block.data, "base64"), { mode: 0o600 });
        images.push({ type: "image", ref: join(deps.workspaceDir, name), mimeType: block.mimeType, data: block.data });
      }
      if (images.length === 0) throw new Error("Pi returned no images.");
      deps.onUsage?.({ kind: "generateImages", key: modelKey("image", model.provider, model.id), provider: model.provider, model: model.id, usage: result.usage });
      return { model: result.model, images, ...(text ? { text } : {}), usage: result.usage };
    }
  };
}
