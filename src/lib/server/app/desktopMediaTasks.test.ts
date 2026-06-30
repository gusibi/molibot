import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopImageTask, buildDesktopVideoTask } from "./desktopMediaTasks";

test("desktop media task projections omit local paths, session ids, and provider parameters", () => {
  const common = {
    id: "task-1",
    engine: "agnes",
    sessionId: "private-session",
    status: "completed" as const,
    prompt: "draw a cat",
    requestParams: { apiKey: "secret" },
    errorMessage: undefined,
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:01:00.000Z"
  };
  const image = buildDesktopImageTask({ ...common, imagePath: "/private/image.png", imageUrl: "https://cdn.example/image.png" });
  const video = buildDesktopVideoTask({ ...common, progress: 100, pollParams: { token: "private" }, videoPath: "/private/video.mp4", videoUrl: "https://cdn.example/video.mp4" });

  assert.equal(image.resultUrl, "https://cdn.example/image.png");
  assert.equal(video.progress, 100);
  const serialized = JSON.stringify([image, video]);
  assert.equal(serialized.includes("/private/"), false);
  assert.equal(serialized.includes("private-session"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("pollParams"), false);
});
