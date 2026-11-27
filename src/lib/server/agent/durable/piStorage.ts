import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const PI_TASK_FORMAT = 1601;

const openings = new Map<string, Promise<unknown>>();

/** Preserve the old task format and schema, including committed WAL data. */
async function preserveLegacyStorage(file: string): Promise<void> {
  if (!existsSync(file)) return;
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    if (!source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'durable_schema'").get()) return;
    const row = source.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get();
    const version = source.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof version === "number" && version >= PI_TASK_FORMAT) return;
    if (row?.version !== 1 && row?.version !== 2) return;
    const format = row.version === 1 ? "schema-v1" : "before-1.6";
    const destination = `${file}.backup-pi-${format}-${randomUUID()}.sqlite`;
    let created = false;
    try {
      const descriptor = openSync(destination, "wx", 0o600);
      created = true;
      closeSync(descriptor);
      await backup(source, destination);
      const snapshot = new DatabaseSync(destination);
      try { snapshot.exec("PRAGMA journal_mode = DELETE"); }
      finally { snapshot.close(); }
    } catch (cause) {
      if (created) {
        try { rmSync(destination, { force: true }); } catch { /* Preserve the backup failure if cleanup is also denied. */ }
      }
      throw new Error(`Pi storage migration stopped because its ${format.replace("-", " ")} backup failed.`, { cause });
    }
  } finally { source.close(); }
}

/** Both execution and startup recovery must enter through this backup-before-migration path. */
export async function openPiStorage(file: string): ReturnType<typeof openNodeSqliteStorage> {
  const path = resolve(file);
  const previous = openings.get(path);
  const opening = (async () => {
    await previous?.catch(() => undefined);
    await preserveLegacyStorage(path);
    const storage = await openNodeSqliteStorage(path);
    try {
      const database = new DatabaseSync(path);
      try {
        const version = database.prepare("PRAGMA user_version").get()?.user_version;
        if (typeof version === "number" && version < PI_TASK_FORMAT) database.exec(`PRAGMA user_version = ${PI_TASK_FORMAT}`);
      } finally { database.close(); }
      return storage;
    } catch (error) {
      await storage.close(BACKGROUND_CONTEXT);
      throw error;
    }
  })();
  openings.set(path, opening);
  try { return await opening; }
  finally { if (openings.get(path) === opening) openings.delete(path); }
}
