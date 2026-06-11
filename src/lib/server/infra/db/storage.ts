import fs from "node:fs";
import path from "node:path";
import { config } from "$lib/server/app/env.js";

export const storagePaths = {
  dataDir: path.resolve(config.dataDir),
  dbDir: path.resolve(config.databaseDir),
  agentsDir: path.resolve(config.dataDir, "agents"),
  settingsFile: path.resolve(config.settingsFile),
  settingsDbFile: path.resolve(config.settingsDbFile),
  inboundQueueDbFile: path.resolve(config.databaseDir, "inbound-queue.sqlite"),
  outboxDbFile: path.resolve(config.databaseDir, "outbox.sqlite"),
  moryDbFile: path.resolve(config.databaseDir, "mory.sqlite"),
  memoryDir: path.resolve(config.dataDir, "memory"),
  webWorkspaceDir: path.resolve(config.webWorkspaceDir),
  sessionsDir: path.resolve(config.sessionsDir),
  sessionsIndexFile: path.resolve(config.sessionsIndexFile)
};

const SQLITE_SIDE_SUFFIXES = ["-wal", "-shm"];

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

function moveFileIfTargetMissing(fromPath: string, toPath: string): void {
  if (fromPath === toPath) return;
  if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) return;
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.renameSync(fromPath, toPath);
}

function migrateSqliteFile(fromPath: string, toPath: string): void {
  moveFileIfTargetMissing(fromPath, toPath);
  for (const suffix of SQLITE_SIDE_SUFFIXES) {
    moveFileIfTargetMissing(`${fromPath}${suffix}`, `${toPath}${suffix}`);
  }
}

export function ensureSqliteParentDir(dbFile: string): void {
  if (dbFile === ":memory:") return;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
}

function migrateLegacyDbFiles(): void {
  migrateSqliteFile(path.resolve(config.dataDir, "settings.sqlite"), storagePaths.settingsDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "inbound-queue.sqlite"), storagePaths.inboundQueueDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "outbox.sqlite"), storagePaths.outboxDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "memory", "mory.sqlite"), storagePaths.moryDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "sessions.db"), path.resolve(storagePaths.dbDir, "sessions.db"));
  migrateSqliteFile(
    path.resolve(config.dataDir, "moli-t", "settings.sqlite"),
    path.resolve(storagePaths.dbDir, "moli-t", "settings.sqlite")
  );
}

export function initDb(): void {
  fs.mkdirSync(storagePaths.dataDir, { recursive: true });
  ensureSqliteParentDir(storagePaths.settingsDbFile);
  fs.mkdirSync(storagePaths.dbDir, { recursive: true });
  fs.mkdirSync(storagePaths.agentsDir, { recursive: true });
  fs.mkdirSync(storagePaths.memoryDir, { recursive: true });
  fs.mkdirSync(storagePaths.webWorkspaceDir, { recursive: true });
  fs.mkdirSync(storagePaths.sessionsDir, { recursive: true });
  migrateLegacyDbFiles();

  if (!fs.existsSync(storagePaths.settingsFile)) {
    writeJsonFile(storagePaths.settingsFile, {});
  }
  if (!fs.existsSync(storagePaths.sessionsIndexFile)) {
    writeJsonFile(storagePaths.sessionsIndexFile, {});
  }
}
