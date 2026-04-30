import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VISION_SMOKE_FIXTURE_RELATIVE_PATH = "fixtures/vision-smoke.png";
export const VISION_SMOKE_FIXTURE_MIME_TYPE = "image/png";

function bundledFixtureCandidates(): string[] {
  return [
    resolve(process.cwd(), "assets/test-images/vision-smoke.png"),
    fileURLToPath(new URL("../../../../assets/test-images/vision-smoke.png", import.meta.url))
  ];
}

export function workspaceVisionSmokeFixturePath(dataDir: string): string {
  return join(dataDir, VISION_SMOKE_FIXTURE_RELATIVE_PATH);
}

export function ensureWorkspaceVisionSmokeFixture(dataDir: string): string {
  const targetPath = workspaceVisionSmokeFixturePath(dataDir);
  if (existsSync(targetPath)) return targetPath;

  const sourcePath = bundledFixtureCandidates().find((candidate) => existsSync(candidate));
  if (!sourcePath) {
    throw new Error("Bundled vision smoke fixture is missing.");
  }

  mkdirSync(join(dataDir, "fixtures"), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return targetPath;
}

export function readWorkspaceVisionSmokeImage(dataDir: string): { mimeType: string; data: string; path: string } {
  const path = ensureWorkspaceVisionSmokeFixture(dataDir);
  return {
    mimeType: VISION_SMOKE_FIXTURE_MIME_TYPE,
    data: readFileSync(path).toString("base64"),
    path
  };
}
