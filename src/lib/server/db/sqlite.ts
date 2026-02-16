import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export const storagePaths = {
  dataDir: path.resolve(config.dataDir),
  settingsFile: path.resolve(config.settingsFile),
  sessionsDir: path.resolve(config.sessionsDir),
  sessionsIndexFile: path.resolve(config.sessionsIndexFile)
};

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function initDb(): void {
  fs.mkdirSync(storagePaths.dataDir, { recursive: true });
  fs.mkdirSync(storagePaths.sessionsDir, { recursive: true });

  if (!fs.existsSync(storagePaths.settingsFile)) {
    writeJsonFile(storagePaths.settingsFile, {});
  }
  if (!fs.existsSync(storagePaths.sessionsIndexFile)) {
    writeJsonFile(storagePaths.sessionsIndexFile, {});
  }
}
