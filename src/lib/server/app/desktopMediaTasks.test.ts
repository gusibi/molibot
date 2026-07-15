import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopImageTask, buildDesktopVideoTask } from "./desktopMediaTasks";

test("desktop media task projections keep safe params but omit local paths, session ids, and secrets", () => {
  const common = {
    id: "task-1",
    engine: "agnes",
    sessionId: "private-session",
    status: "completed" as const,
    prompt: "draw a cat",
    requestParams: { apiKey: "secret", baseUrl: "https://internal.example", model: "seedream-3", size: "1024x1024", seed: 42 },
    errorMessage: undefined,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:01:00.000Z"
  };
  const image = buildDesktopImageTask({ ...common, imagePath: "/private/image.png", imageUrl: "https://cdn.example/image.png" });
  const video = buildDesktopVideoTask({ ...common, progress: 100, pollParams: { token: "private" }, videoPath: "/private/video.mp4", videoUrl: "https://cdn.example/video.mp4" });

  assert.equal(image.resultUrl, "https://cdn.example/image.png");
  assert.equal(video.progress, 100);
  // Safe, primitive display params survive.
  assert.equal(image.requestParams?.model, "seedream-3");
  assert.equal(image.requestParams?.size, "1024x1024");
  assert.equal(image.requestParams?.seed, 42);
  const serialized = JSON.stringify([image, video]);
  // Secrets, internal endpoints, host paths, session ids, and poll tokens never leak.
  assert.equal(serialized.includes("/private/"), false);
  assert.equal(serialized.includes("private-session"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("baseUrl"), false);
  assert.equal(serialized.includes("pollParams"), false);
});
