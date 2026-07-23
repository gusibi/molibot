import { join } from "node:path";
import { config } from "$lib/server/app/env.js";

export function resolveAuthFilePath(): string {
  const explicit = String(process.env.PI_AI_AUTH_FILE ?? "").trim();
  return explicit || join(config.dataDir, "auth.json");
}
