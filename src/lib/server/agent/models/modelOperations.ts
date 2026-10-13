import { nativeModelResult } from "./nativeModelResult.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  id: string;
  kind: "classify" | "generateImages";
  key: string;
  provider: string;
  model: string;
  usage?: unknown;
  api?: string;
}

export interface GenerateImagesResult {
  model: string;
  /** Each item is ready for the sandbox `image()` helper (an MCP ImageContent block) plus a file-tool-usable path to the persisted artifact. */
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
  classify(input: { model?: string; state: Record<string, unknown>; questions: Record<string, ClassifierQuestion> }, signal?: AbortSignal, callId?: string): Promise<ClassifyResult>;
  generateImages(input: { model?: string; prompt: string; images?: string[] }, signal?: AbortSignal, callId?: string): Promise<GenerateImagesResult>;
}

export interface PiModelOperationsDeps {
  models: Models;
  /** Directory (absolute) where generated images are persisted. */
  artifactDir: string;
  /** Workspace root; returned artifact refs are made relative to it when possible. */
  workspaceDir: string;
  /** Shared side-effect gate: throws to refuse a call (Plan mode, denied approval, revoked authority). */
  authorize?: (operation: "classify" | "generateImages", details: { key: string; id: string }) => void | Promise<void>;
  /** Reserve budget before the request; throws when the run budget is exhausted. */
  beforeCall?: (operation: "classify" | "generateImages", details: { key: string; id: string }) => void;
  /** Record usage/cost after the request; a missing provider price stays unknown, never zero. */
  onUsage?: (receipt: ModelUsageReceipt) => void;
  fetch?: typeof fetch;
  media?: {
    store: import("$lib/server/agent/imageGenerate/imageTaskStore.js").SqliteImageTaskStore;
    sessionId: string;
    runId: string;
    usageScope: { channel: string; botId: string; agentId?: string; roomId?: string };
  };
}

const IMAGE_MIME_EXTENSIONS: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif" };
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

/**
 * The path a caller can hand back to the model's file tools: relative to the
 * workspace when the artifact lives inside it, otherwise the absolute path. The
 * persisted file is the source of truth — deriving the ref from `workspaceDir`
 * alone pointed at a file that did not exist.
 */
function workspaceRef(workspaceDir: string, target: string): string {
  const rel = relative(workspaceDir, target);
  return rel && !rel.startsWith("..") ? rel : target;
}

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
      if (inline) {
        if (Buffer.byteLength(inline.data, "base64") > MAX_REFERENCE_BYTES) throw new Error("Reference image exceeds 10 MiB.");
        content.push({ type: "image", mimeType: inline.mimeType, data: inline.data }); continue;
      }
      const url = new URL(entry);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Reference images must be an https URL or a data URL.");
      const response = await doFetch(url, { signal, redirect: "error" });
      if (!response.ok) throw new Error(`Reference image download failed: HTTP ${response.status}.`);
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (!mimeType?.startsWith("image/")) throw new Error("Reference URL must return an image MIME type.");
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) try {
        while (true) {
          signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_REFERENCE_BYTES) throw new Error("Reference image exceeds 10 MiB.");
          chunks.push(value);
        }
      } catch (error) {
        try { await reader.cancel(error); } catch { /* Preserve the size or cancellation error. */ }
        throw error;
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks, size);
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

    async classify(input, signal, id = randomUUID()) {
      const model = locate("classifier", input.model) as ClassifierModel<any> | undefined;
      if (!model) throw new Error(input.model ? `No classifier model for "${input.model}". Call models.list() to see valid keys.` : "No classifier model is available.");
      signal?.throwIfAborted();
      await deps.authorize?.("classify", { key: modelKey("classifier", model.provider, model.id), id });
      signal?.throwIfAborted();
      deps.beforeCall?.("classify", { key: modelKey("classifier", model.provider, model.id), id });
      const result = await nativeModelResult({ kind: "classify", model: modelKey("classifier", model.provider, model.id), input },
        () => deps.models.classify(model, { state: input.state as import("@earendil-works/pi-ai").JsonObject, questions: input.questions }, { signal, maxRetries: 0 }),
        result => deps.onUsage?.({ id, kind: "classify", key: modelKey("classifier", model.provider, model.id), provider: model.provider, model: model.id, usage: result.usage, api: result.api }));
      if (result.stopReason === "aborted") throw new DOMException("Classification aborted; the remote request may still incur charges.", "AbortError");
      if (result.stopReason === "error") throw new Error(result.errorMessage || "Classification failed.");
      return { model: result.model, answers: result.answers, usage: result.usage };
    },

    async generateImages(input, signal, id = randomUUID()) {
      const model = locate("image", input.model) as import("@earendil-works/pi-ai").ImageModel<import("@earendil-works/pi-ai").ImageApi> | undefined;
      if (!model) throw new Error(input.model ? `No image model for "${input.model}". Call models.list() to see valid keys.` : "No image model is available.");
      if (input.images?.length && (model as { input?: unknown[] }).input?.includes("image") !== true) {
        throw new Error("The selected image model does not support reference images.");
      }
      signal?.throwIfAborted();
      await deps.authorize?.("generateImages", { key: modelKey("image", model.provider, model.id), id });
      const content: ImagesInputContent[] = [{ type: "text", text: input.prompt }];
      content.push(...await referenceInputs(input.images, signal));
      signal?.throwIfAborted();
      await deps.authorize?.("generateImages", { key: modelKey("image", model.provider, model.id), id });
      deps.beforeCall?.("generateImages", { key: modelKey("image", model.provider, model.id), id });
      const taskId = `pi:${deps.media?.runId}:model:${id}`;
      if (deps.media && !deps.media.store.getTask(taskId)) deps.media.store.createTask(taskId, "pi", deps.media.sessionId, input.prompt, { model: `pi|${model.provider}|${model.id}`, usageScope: deps.media.usageScope, source: "model_operation" });
      try {
        const result = await nativeModelResult({ kind: "generateImages", model: modelKey("image", model.provider, model.id), input },
          () => deps.models.generateImages(model, { input: content }, { signal, maxRetries: 0 }),
          result => {
            deps.media?.store.recordResult(taskId, result.output.filter(block => block.type === "text").map(block => block.text).join("\n"), result.usage);
            deps.onUsage?.({ id, kind: "generateImages", key: modelKey("image", model.provider, model.id), provider: model.provider, model: model.id, usage: result.usage, api: result.api });
          });
        if (result.stopReason === "aborted") throw new DOMException("Image generation aborted; the remote request may still incur charges.", "AbortError");
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
          deps.media?.store.recordArtifact(taskId, { index: images.length, path, mimeType: block.mimeType, byteLength: Buffer.byteLength(block.data, "base64") });
          images.push({ type: "image", ref: workspaceRef(deps.workspaceDir, path), mimeType: block.mimeType, data: block.data });
        }
        if (images.length === 0) throw new Error("Pi returned no images.");
        deps.media?.store.updateTaskProgress(taskId, "completed", join(deps.artifactDir, `codemode-image-${createHash("sha256").update(`${images[0]!.data}:0`).digest("hex").slice(0, 24)}${IMAGE_MIME_EXTENSIONS[images[0]!.mimeType]}`));
        return { model: result.model, images, ...(text ? { text } : {}), usage: result.usage };
      } catch (error) {
        deps.media?.store.updateTaskProgress(taskId, signal?.aborted ? "cancelled" : "failed", undefined, `${String(error)} Remote cancellation may be unsupported; incurred charges remain recorded.`);
        throw error;
      }
    }
  };
}
