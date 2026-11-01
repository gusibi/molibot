import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteDatabase } from "@earendil-works/chord/sqlite/node";
import { applySqliteMigrations, SQLITE_MIGRATIONS } from "@earendil-works/pi-durable/storage/sqlite";
import { openPiStorage } from "./piStorage.js";

function schemaVersion(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return (db.prepare("SELECT version FROM durable_schema WHERE singleton = 1").get() as { version: number }).version; }
  finally { db.close(); }
}

test("opening a Pi 1.3 execution backs up schema v1 including WAL before migration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-upgrade-"));
  const file = join(directory, "pi.sqlite");
  const legacy = await openNodeSqliteDatabase(file, { walAutoCheckpointPages: 0 });
  try {
    await applySqliteMigrations(legacy, SQLITE_MIGRATIONS.slice(0, 1));
    await legacy.exec("CREATE TABLE upgrade_probe (value TEXT); INSERT INTO upgrade_probe VALUES ('committed WAL data')");
    assert.equal(schemaVersion(file), 1);
    const storage = await openPiStorage(file);
    await storage.close(BACKGROUND_CONTEXT);
    assert.equal(schemaVersion(file), 2);
    const backups = readdirSync(directory).filter(name => name.includes("backup-pi-schema-v1") && name.endsWith(".sqlite"));
    assert.equal(backups.length, 1);
    const backupFile = join(directory, backups[0]);
    assert.equal(schemaVersion(backupFile), 1);
    assert.equal(statSync(backupFile).mode & 0o777, 0o600);
    const copy = new DatabaseSync(backupFile, { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT value FROM upgrade_probe").get()?.value, "committed WAL data");
      assert.equal(copy.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    } finally { copy.close(); }
    const reopened = await openPiStorage(file);
    await reopened.close(BACKGROUND_CONTEXT);
    assert.deepEqual(readdirSync(directory).filter(name => name.includes("backup-pi-schema-v1") && name.endsWith(".sqlite")), backups);
  } finally { await legacy.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("new Pi executions open at schema v2 without a migration backup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-new-"));
  try {
    const file = join(directory, "pi.sqlite");
    const storage = await openPiStorage(file);
    await storage.close(BACKGROUND_CONTEXT);
    assert.equal(schemaVersion(file), 2);
    assert.equal(readdirSync(directory).filter(name => name.includes("backup-pi-schema-v1") && name.endsWith(".sqlite")).length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("a failed migration backup leaves schema v1 untouched", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-backup-failed-"));
  const file = join(directory, "pi.sqlite");
  const legacy = await openNodeSqliteDatabase(file);
  await applySqliteMigrations(legacy, SQLITE_MIGRATIONS.slice(0, 1));
  await legacy.exec("PRAGMA journal_mode = DELETE");
  await legacy.close();
  try {
    chmodSync(directory, 0o500);
    await assert.rejects(openPiStorage(file), /schema v1 backup failed/);
    assert.equal(schemaVersion(file), 1);
  } finally { chmodSync(directory, 0o700); rmSync(directory, { recursive: true, force: true }); }
});
