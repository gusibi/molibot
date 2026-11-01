import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const openings = new Map<string, Promise<unknown>>();

/** Preserve a consistent v1 snapshot, including WAL, before Pi's irreversible v2 migration. */
async function preserveLegacyStorage(file: string): Promise<void> {
  if (!existsSync(file)) return;
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    if (!source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'durable_schema'").get()) return;
    const row = source.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get();
    if (row?.version !== 1) return;
    const destination = `${file}.backup-pi-schema-v1-${randomUUID()}.sqlite`;
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
      throw new Error("Pi storage migration stopped because its schema v1 backup failed.", { cause });
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
    return openNodeSqliteStorage(path);
  })();
  openings.set(path, opening);
  try { return await opening; }
  finally { if (openings.get(path) === opening) openings.delete(path); }
}
