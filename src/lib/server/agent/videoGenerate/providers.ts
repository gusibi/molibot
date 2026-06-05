import type {
  VideoGenerateEngine,
  VideoGenerateInput,
  VideoGenerateProvider,
  VideoGenerateProviderContext,
  VideoGenerateProviderResult
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

function requireApiKey(context: VideoGenerateProviderContext, engine: VideoGenerateEngine): string {
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

export function getEffectiveVideoBaseUrl(engine: string, inputUrl: string): { submitUrl: string; pollUrlBase: string } {
  const defaultBaseUrls = {
    agnes: "https://apihub.agnes-ai.com",
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
        return {
          submitUrl: `${cleanUrl}/v1/videos`,
          pollUrlBase: `${cleanUrl}/v1/videos`
        };
      } else if (pathname.endsWith("/v1")) {
        return {
          submitUrl: `${cleanUrl}/videos`,
          pollUrlBase: `${cleanUrl}/videos`
        };
      } else {
        return {
          submitUrl: cleanUrl,
          pollUrlBase: cleanUrl
        };
      }
    }

    if (engine === "volcengine") {
      if (pathname === "" || pathname === "/") {
        return {
          submitUrl: `${cleanUrl}/api/plan/v3/contents/generations/tasks`,
          pollUrlBase: `${cleanUrl}/api/plan/v3/contents/generations/tasks`
        };
      } else if (pathname.endsWith("/api/plan/v3")) {
        return {
          submitUrl: `${cleanUrl}/contents/generations/tasks`,
          pollUrlBase: `${cleanUrl}/contents/generations/tasks`
        };
      } else {
        return {
          submitUrl: cleanUrl,
          pollUrlBase: cleanUrl
        };
      }
    }
  } catch {
    // fallback
  }

  if (engine === "agnes") {
    return {
      submitUrl: `${cleanUrl}/v1/videos`,
      pollUrlBase: `${cleanUrl}/v1/videos`
    };
  } else {
    return {
      submitUrl: `${cleanUrl}/api/plan/v3/contents/generations/tasks`,
      pollUrlBase: `${cleanUrl}/api/plan/v3/contents/generations/tasks`
    };
  }
}

const agnesProvider: VideoGenerateProvider = {
  id: "agnes",
  generate: async (input: VideoGenerateInput, context: VideoGenerateProviderContext): Promise<VideoGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "agnes");
    const baseUrl = context.settings.engines.agnes.baseUrl?.trim() || "https://apihub.agnes-ai.com";
    const resolved = getEffectiveVideoBaseUrl("agnes", baseUrl);
    const submitUrl = resolved.submitUrl;

    const model = input.model || context.settings.engines.agnes.model || "agnes-video-v2.0";
    const payload: Record<string, any> = {
      model,
      prompt: input.prompt
    };

    if (input.seed !== undefined) payload.seed = input.seed;

    // Map duration for Agnes
    if (input.duration !== undefined) {
      const targetFrames = input.duration * 24;
      const framesList = [81, 121, 161, 241, 441];
      const bestFrames = framesList.reduce((prev, curr) => 
        Math.abs(curr - targetFrames) < Math.abs(prev - targetFrames) ? curr : prev
      );
      payload.num_frames = bestFrames;
      payload.frame_rate = 24;
    }

    // Map ratio for Agnes
    let width = 1152;
    let height = 768;
    if (input.ratio) {
      if (input.ratio === "16:9") {
        width = 1280;
        height = 720;
      } else if (input.ratio === "9:16") {
        width = 720;
        height = 1280;
      } else if (input.ratio === "4:3") {
        width = 1024;
        height = 768;
      } else if (input.ratio === "3:4") {
        width = 768;
        height = 1024;
      } else if (input.ratio === "1:1") {
        width = 768;
        height = 768;
      }
    }
    payload.width = width;
    payload.height = height;

    // Handle reference images for Agnes
    if (input.images && input.images.length > 0) {
      if (input.images.length === 1) {
        payload.image = input.images[0];
      } else {
        payload.extra_body = {
          image: input.images
        };
        if (/keyframes?/i.test(input.prompt)) {
          payload.extra_body.mode = "keyframes";
        }
      }
    }

    // Submit Task
    const response = await context.fetch(submitUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const submitData = await readJson(response);
    const taskId = submitData?.id || submitData?.task_id;
    if (!taskId) {
      throw new Error(`Agnes failed to submit video task. Response: ${JSON.stringify(submitData)}`);
    }

    // Poll for results
    const pollUrl = `${resolved.pollUrlBase}/${taskId}`;
    for (let i = 0; i < 60; i++) {
      if (context.signal?.aborted) {
        throw new Error("Aborted");
      }

      const pollResponse = await context.fetch(pollUrl, {
        headers: {
          "Authorization": `Bearer ${apiKey}`
        },
        signal: context.signal
      });

      const pollData = await readJson(pollResponse);
      const status = pollData?.status;

      if (status === "completed") {
        const videoUrl = pollData?.video_url || pollData?.remixed_from_video_id;
        if (!videoUrl) {
          throw new Error(`Agnes task completed but returned no video URL. Response: ${JSON.stringify(pollData)}`);
        }
        return { videoUrl };
      } else if (status === "failed") {
        throw new Error(`Agnes video generation failed: ${pollData?.error || "Unknown error"}`);
      }

      await delay(5000, context.signal);
    }

    throw new Error("Agnes video generation task timed out");
  }
};

const volcengineProvider: VideoGenerateProvider = {
  id: "volcengine",
  generate: async (input: VideoGenerateInput, context: VideoGenerateProviderContext): Promise<VideoGenerateProviderResult> => {
    const apiKey = requireApiKey(context, "volcengine");
    const baseUrl = context.settings.engines.volcengine.baseUrl?.trim() || "https://ark.cn-beijing.volces.com";
    const resolved = getEffectiveVideoBaseUrl("volcengine", baseUrl);
    const submitUrl = resolved.submitUrl;

    const model = input.model || context.settings.engines.volcengine.model || "doubao-seedance-2.0";
    
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: input.prompt }
    ];

    if (input.images && input.images.length > 0) {
      for (const imgUrl of input.images) {
        content.push({
          type: "image_url",
          image_url: { url: imgUrl }
        });
      }
    }

    const payload: Record<string, any> = {
      model,
      content,
      generate_audio: input.generateAudio !== false,
      ratio: input.ratio || "adaptive",
      duration: input.duration || 5,
      watermark: input.watermark === true
    };

    const response = await context.fetch(submitUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });

    const submitData = await readJson(response);
    const taskId = submitData?.id;
    if (!taskId) {
      throw new Error(`Volcengine failed to submit video task. Response: ${JSON.stringify(submitData)}`);
    }

    // Poll for results
    const pollUrl = `${resolved.pollUrlBase}/${taskId}`;
    for (let i = 0; i < 60; i++) {
      if (context.signal?.aborted) {
        throw new Error("Aborted");
      }

      const pollResponse = await context.fetch(pollUrl, {
        headers: {
          "Authorization": `Bearer ${apiKey}`
        },
        signal: context.signal
      });

      const pollData = await readJson(pollResponse);
      const status = pollData?.status;

      if (status === "succeeded") {
        const videoUrl = pollData?.content?.video_url;
        if (!videoUrl) {
          throw new Error(`Volcengine task succeeded but returned no video URL. Response: ${JSON.stringify(pollData)}`);
        }
        return { videoUrl };
      } else if (status === "failed") {
        throw new Error(`Volcengine video generation failed: ${pollData?.error || "Unknown error"}`);
      }

      await delay(5000, context.signal);
    }

    throw new Error("Volcengine video generation task timed out");
  }
};

export const VIDEO_GENERATE_PROVIDERS: Record<VideoGenerateEngine, VideoGenerateProvider> = {
  agnes: agnesProvider,
  volcengine: volcengineProvider
};
