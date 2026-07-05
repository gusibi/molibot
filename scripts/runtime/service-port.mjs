import { readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_SERVICE_PORT = 3000;

export function normalizeServicePort(value, fallback = DEFAULT_SERVICE_PORT) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}

export function readConfiguredServicePort(dataDir, fallback = DEFAULT_SERVICE_PORT) {
  try {
    const settings = JSON.parse(readFileSync(path.join(dataDir, "settings.json"), "utf8"));
    return normalizeServicePort(settings.serverPort, fallback);
  } catch {
    return fallback;
  }
}
