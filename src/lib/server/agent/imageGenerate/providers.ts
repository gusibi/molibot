import type {
  ImageGenerateEngine,
  ImageGenerateInput,
  ImageGenerateProvider,
  ImageGenerateProviderContext,
  ImageGenerateProviderResult
} from "./types.js";

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
  });

function requireApiKey(context: ImageGenerateProviderContext, engine: ImageGenerateEngine): string {
  const apiKey = context.settings.engines[engine]?.apiKey?.trim();
  if (!apiKey) throw new Error(`${engine} API key is not configured`);
  return apiKey;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

export function getEffectiveBaseUrl(engine: string, inputUrl: string): { submitUrl: string; pollUrlBase?: string } {
  const defaultBaseUrls = {
    agnes: "https://apihub.agnes-ai.com",
    openai: "https://api.openai.com",
    "openai-chat": "https://api.openai.com",
    modelscope: "https://api-inference.modelscope.cn",
    google: "https://generativelanguage.googleapis.com",
    volcengine: "https://ark.cn-beijing.volces.com"
  };

  const rawUrl = inputUrl.trim() || defaultBaseUrls[engine as keyof typeof defaultBaseUrls];
  const cleanUrl = rawUrl.replace(/\/+$/, "");

  try {
    let parseUrl = cleanUrl;
    if (!/^https?:\/\//i.test(parseUrl)) {
      parseUrl = "https://" + parseUrl;
    }
    const urlObj = new URL(parseUrl);
    const pathname = urlObj.pathname.replace(/\/+$/, "");

    if (engine === "agnes") {
      if (pathname === "" || pathname === "/") {
        return { submitUrl: `${cleanUrl}/v1/images/generations` };
      } else if (pathname.endsWith("/v1")) {
        return { submitUrl: `${cleanUrl}/images/generations` };
      } else {
        return { submitUrl: cleanUrl };
      }
    }

    if (engine === "openai") {
      if (pathname === "" || pathname === "/") {
        return { submitUrl: `${cleanUrl}/v1/images/generations` };
      } else if (pathname.endsWith("/v1")) {
        return { submitUrl: `${cleanUrl}/images/generations` };
      } else {
        return { submitUrl: cleanUrl };
      }
    }

    if (engine === "openai-chat") {
      if (pathname === "" || pathname === "/") {
        return { submitUrl: `${cleanUrl}/v1/chat/completions` };
      } else if (pathname.endsWith("/v1")) {
        return { submitUrl: `${cleanUrl}/chat/completions` };
      } else {
        return { submitUrl: cleanUrl };
      }
    }

    if (engine === "modelscope") {
      if (pathname === "" || pathname === "/") {
        return {
          submitUrl: `${cleanUrl}/v1/images/generations`,
          pollUrlBase: `${cleanUrl}/v1`
        };
      } else if (pathname.endsWith("/v1")) {
        return {
          submitUrl: `${cleanUrl}/images/generations`,
          pollUrlBase: cleanUrl
        };
      } else {
        const lastSlash = cleanUrl.lastIndexOf("/");
        const parentPath = lastSlash > 8 ? cleanUrl.substring(0, lastSlash) : cleanUrl;
        return {
          submitUrl: cleanUrl,
          pollUrlBase: parentPath
        };
      }
    }

    if (engine === "volcengine") {
      if (pathname === "" || pathname === "/") {
        return { submitUrl: `${cleanUrl}/api/v3/images/generations` };
      } else if (pathname.endsWith("/api/v3")) {
        return { submitUrl: `${cleanUrl}/images/generations` };
      } else if (pathname.endsWith("/api")) {
        return { submitUrl: `${cleanUrl}/v3/images/generations` };
      } else {
        return { submitUrl: cleanUrl };
      }
    }

    if (engine === "google") {
      if (pathname === "" || pathname === "/") {
        return { submitUrl: `${cleanUrl}/v1beta/models/MODEL_NAME:predict` };
      } else if (pathname.endsWith("/v1beta")) {
        return { submitUrl: `${cleanUrl}/models/MODEL_NAME:predict` };
      } else {
        return { submitUrl: cleanUrl };
      }
    }
  } catch {
    // fallback
  }

  if (engine === "agnes" || engine === "openai" || engine === "modelscope") {
    return { submitUrl: `${cleanUrl}/v1/images/generations`, pollUrlBase: `${cleanUrl}/v1` };
  } else if (engine === "openai-chat") {
    return { submitUrl: `${cleanUrl}/v1/chat/completions` };
  } else if (engine === "volcengine") {
    return { submitUrl: `${cleanUrl}/api/v3/images/generations` };
  } else {
    return { submitUrl: `${cleanUrl}/v1beta/models/MODEL_NAME:predict` };
  }
}

const agnesProvider: ImageGenerateProvider = {
  id: "agnes",
  generate: async (input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "agnes");
    const baseUrl = context.settings.engines.agnes.baseUrl?.trim() || "https://apihub.agnes-ai.com";
    const resolved = getEffectiveBaseUrl("agnes", baseUrl);
    const url = resolved.submitUrl;

    const model = input.model || "agnes-image-2.0-flash";
    const payload: Record<string, any> = {
      model,
      prompt: input.prompt
    };

    if (input.size) payload.size = input.size;
    if (input.seed !== undefined) payload.seed = input.seed;

    if (input.images && input.images.length > 0) {
      payload.tags = ["img2img"];
      payload.extra_body = {
        image: input.images,
        response_format: "url"
      };
    }

    const response = await context.fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const data = await readJson(response);
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error(`Agnes API did not return an image URL. Response: ${JSON.stringify(data)}`);
    }

    return { imageUrl };
  }
};

function imageResultFromString(text: string): ImageGenerateProviderResult | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const dataUrlMatch = trimmed.match(/data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=_-]+)/i);
  if (dataUrlMatch?.[1]) {
    return { imageBase64: dataUrlMatch[1] };
  }

  if (/^[A-Za-z0-9+/=_-]{80,}$/.test(trimmed)) {
    return { imageBase64: trimmed };
  }

  const markdownImageUrl = trimmed.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownImageUrl?.[1]) {
    return { imageUrl: markdownImageUrl[1] };
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>)]*/i);
  if (urlMatch?.[0]) {
    return { imageUrl: urlMatch[0] };
  }

  try {
    return imageResultFromValue(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function imageResultFromValue(value: unknown): ImageGenerateProviderResult | undefined {
  if (typeof value === "string") {
    return imageResultFromString(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = imageResultFromValue(item);
      if (result) return result;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["b64_json", "image_base64", "imageBase64", "base64"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return { imageBase64: record[key].trim() };
    }
  }
  for (const key of ["url", "image_url", "imageUrl"]) {
    const raw = record[key];
    if (typeof raw === "string") {
      const result = imageResultFromString(raw);
      if (result) return result;
    } else if (raw && typeof raw === "object") {
      const nestedUrl = (raw as Record<string, unknown>).url;
      if (typeof nestedUrl === "string") {
        const result = imageResultFromString(nestedUrl);
        if (result) return result;
      }
    }
  }

  for (const item of Object.values(record)) {
    const result = imageResultFromValue(item);
    if (result) return result;
  }
  return undefined;
}

const openaiProvider: ImageGenerateProvider = {
  id: "openai",
  generate: async (input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "openai");
    const baseUrl = context.settings.engines.openai.baseUrl?.trim() || "https://api.openai.com";
    const resolved = getEffectiveBaseUrl("openai", baseUrl);
    const url = resolved.submitUrl;

    const model = input.model || "gpt-image-2";
    const payload: Record<string, any> = {
      model,
      prompt: input.prompt,
      n: 1
    };

    if (input.size) payload.size = input.size;

    const response = await context.fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const data = await readJson(response);
    const item = data?.data?.[0];
    const b64 = item?.b64_json;
    const imageUrl = item?.url;
    if (!b64 && !imageUrl) {
      throw new Error(`OpenAI Images API did not return image data. Response: ${JSON.stringify(data)}`);
    }

    return b64 ? { imageBase64: b64 } : { imageUrl };
  }
};

const openaiChatProvider: ImageGenerateProvider = {
  id: "openai-chat",
  generate: async (input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "openai-chat");
    const baseUrl = context.settings.engines["openai-chat"].baseUrl?.trim() || "https://api.openai.com";
    const resolved = getEffectiveBaseUrl("openai-chat", baseUrl);
    const url = resolved.submitUrl;

    const model = input.model || "gpt-4o";
    const content = [
      input.prompt,
      "",
      "Return exactly one generated image as either a public image URL, a data:image/...;base64 URL, or a JSON object with one of these fields: url, image_url, b64_json, base64."
    ].join("\n");
    const payload: Record<string, any> = {
      model,
      messages: [{ role: "user", content }]
    };

    const response = await context.fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const data = await readJson(response);
    const result = imageResultFromValue(data?.choices?.[0]?.message?.content ?? data);
    if (!result) {
      throw new Error(`OpenAI Chat Completions image API did not return image data. Response: ${JSON.stringify(data)}`);
    }

    return result;
  }
};

const modelscopeProvider: ImageGenerateProvider = {
  id: "modelscope",
  generate: async (input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "modelscope");
    const baseUrl = context.settings.engines.modelscope.baseUrl?.trim() || "https://api-inference.modelscope.cn";
    const resolved = getEffectiveBaseUrl("modelscope", baseUrl);
    const submitUrl = resolved.submitUrl;

    const model = input.model || "Tongyi-MAI/Z-Image-Turbo";

    // Submit task
    const response = await context.fetch(submitUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
      },
      body: JSON.stringify({ model, prompt: input.prompt }),
      signal: context.signal
    });

    const submitData = await readJson(response);
    const taskId = submitData?.task_id;
    if (!taskId) {
      throw new Error(`ModelScope failed to submit task. Response: ${JSON.stringify(submitData)}`);
    }

    // Poll for results
    const pollUrlBase = resolved.pollUrlBase || resolved.submitUrl.substring(0, resolved.submitUrl.lastIndexOf("/"));
    const pollUrl = `${pollUrlBase}/tasks/${taskId}`;
    const pollHeaders = {
      "Authorization": `Bearer ${apiKey}`,
      "X-ModelScope-Task-Type": "image_generation"
    };

    for (let i = 0; i < 60; i++) {
      if (context.signal?.aborted) {
        throw new Error("Aborted");
      }

      const pollResponse = await context.fetch(pollUrl, {
        headers: pollHeaders,
        signal: context.signal
      });

      const pollData = await readJson(pollResponse);
      const status = pollData?.task_status;

      if (status === "SUCCEED") {
        const imageUrl = pollData?.output_images?.[0];
        if (!imageUrl) {
          throw new Error(`ModelScope task succeeded but returned no image. Response: ${JSON.stringify(pollData)}`);
        }
        return { imageUrl };
      } else if (status === "FAILED") {
        throw new Error(`ModelScope task failed: ${pollData?.error || "Unknown error"}`);
      }

      await delay(5000, context.signal);
    }

    throw new Error("ModelScope task execution timed out");
  }
};

const googleProvider: ImageGenerateProvider = {
  id: "google",
  generate: async (input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "google");
    const model = input.model || "imagen-3.0-generate-001";
    const baseUrl = context.settings.engines.google.baseUrl?.trim() || "https://generativelanguage.googleapis.com";
    const resolved = getEffectiveBaseUrl("google", baseUrl);
    let url = resolved.submitUrl;

    if (url.includes("MODEL_NAME")) {
      url = url.replace("MODEL_NAME", model);
    }

    if (!url.includes("key=")) {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}key=${apiKey}`;
    }

    const payload = {
      instances: [{ prompt: input.prompt }],
      parameters: { sampleCount: 1 }
    };

    const response = await context.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const data = await readJson(response);
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
      throw new Error(`Google Imagen API did not return image bytes. Response: ${JSON.stringify(data)}`);
    }

    return { imageBase64: b64 };
  }
};

const volcengineProvider: ImageGenerateProvider = {
  id: "volcengine",
  generate: async (input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "volcengine");
    const baseUrl = context.settings.engines.volcengine.baseUrl?.trim() || "https://ark.cn-beijing.volces.com";
    const resolved = getEffectiveBaseUrl("volcengine", baseUrl);
    const url = resolved.submitUrl;

    const model = input.model || "cv_vit_huge_p14_laion2b_s32b_b64_seedream";
    
    // Newer Seedream models (like 5.0-lite) require at least 3,686,400 pixels (1920x1920).
    // We default to 2048x2048 (2K) for those.
    const isNewSeedream = model.toLowerCase().includes("seedream") && !model.toLowerCase().includes("cv_vit_huge");
    const defaultSize = isNewSeedream ? "2048x2048" : "1024x1024";

    const payload = {
      model,
      prompt: input.prompt,
      n: 1,
      size: input.size || defaultSize
    };

    const response = await context.fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const data = await readJson(response);
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error(`Volcengine API did not return an image URL. Response: ${JSON.stringify(data)}`);
    }

    return { imageUrl };
  }
};

export const IMAGE_GENERATE_PROVIDERS: Record<ImageGenerateEngine, ImageGenerateProvider> = {
  agnes: agnesProvider,
  openai: openaiProvider,
  "openai-chat": openaiChatProvider,
  modelscope: modelscopeProvider,
  google: googleProvider,
  volcengine: volcengineProvider
};
