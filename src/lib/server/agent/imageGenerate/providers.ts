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

  if (engine === "agnes" || engine === "modelscope") {
    return { submitUrl: `${cleanUrl}/v1/images/generations`, pollUrlBase: `${cleanUrl}/v1` };
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
  modelscope: modelscopeProvider,
  google: googleProvider,
  volcengine: volcengineProvider
};
