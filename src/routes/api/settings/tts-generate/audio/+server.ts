import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";

const TEST_ROOT = resolve(`${storagePaths.dataDir}/settings-tts-tests`);

export const GET: RequestHandler = async ({ url }) => {
  const filePath = url.searchParams.get("file");
  if (!filePath) {
    return json({ ok: false, error: "Missing file parameter" }, { status: 400 });
  }

  // Only allow files under the test audio directory
  const resolved = resolve(TEST_ROOT, filePath);
  if (!resolved.startsWith(TEST_ROOT)) {
    return json({ ok: false, error: "Invalid file path" }, { status: 403 });
  }

  if (!existsSync(resolved)) {
    return json({ ok: false, error: "Audio file not found" }, { status: 404 });
  }

  const buffer = readFileSync(resolved);
  const ext = basename(resolved).split(".").pop()?.toLowerCase();

  const contentTypes: Record<string, string> = {
    ogg: "audio/ogg",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    aiff: "audio/aiff",
    m4a: "audio/mp4",
    caf: "audio/x-caf"
  };

  return new Response(buffer, {
    headers: {
      "Content-Type": contentTypes[ext ?? ""] || "audio/ogg",
      "Content-Disposition": `inline; filename="${basename(resolved)}"`,
      "Cache-Control": "no-cache"
    }
  });
};
