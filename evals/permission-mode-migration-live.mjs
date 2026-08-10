/**
 * Permission mode survives a real boot, on a fresh install and on an upgrade.
 *
 * The settings round-trip suite covers save → fresh store → load against a
 * temporary database, which is the pitfall 11 contract. It does not cover the
 * two things only a real process does: creating the column on a brand-new
 * install, and ALTERing it onto a database that predates the field. Those run
 * inside `initializeRuntime`, and a migration that throws there takes the whole
 * service down rather than failing a test — the failure mode pitfall 10 is
 * about ("first open blank / reset after restart", found only on the cold
 * path).
 *
 * The upgrade case also pins a semantic: a row written before the field existed
 * must come back with `permission_mode` NULL, meaning "follow the default",
 * never pinned to whatever the default happened to be at migration time.
 *
 *   node evals/permission-mode-migration-live.mjs
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  createScratchDataDir,
  findFreePort,
  removeScratchDataDir,
  startScratchService,
  stopScratchService
} from "./lib/service.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n         ${detail}` : ""}`);
}

function columnCount(dbFile, table, column) {
  const db = new DatabaseSync(dbFile);
  try {
    return db.prepare(
      `SELECT COUNT(*) c FROM pragma_table_info('${table}') WHERE name = ?`
    ).get(column)?.c ?? 0;
  } finally {
    db.close();
  }
}

async function withService(dataDir, fn) {
  const port = await findFreePort();
  let service = null;
  try {
    service = await startScratchService({ repoRoot, dataDir, port });
    await fn(service);
  } finally {
    if (service) await stopScratchService(service);
  }
}

async function freshInstall() {
  console.log("\nFresh install");
  const dataDir = createScratchDataDir();
  const dbFile = path.join(dataDir, "db", "settings.sqlite");
  try {
    await withService(dataDir, (service) => {
      console.log(`service ready    : ${service.endpoint}`);
      check(
        "settings_agents carries permission_mode",
        columnCount(dbFile, "settings_agents", "permission_mode") === 1
      );
      check(
        "settings_channel_instances carries it too",
        columnCount(dbFile, "settings_channel_instances", "permission_mode") === 1
      );

      // The two approval backends share one physical table; a boot that
      // recreated the legacy pair would silently split them again.
      const db = new DatabaseSync(dbFile);
      try {
        const approvals = db.prepare(
          "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='approvals'"
        ).get()?.c ?? 0;
        check("approvals is a single table", approvals === 1, `found=${approvals}`);
      } finally {
        db.close();
      }
    });
  } finally {
    removeScratchDataDir(dataDir);
  }
}

async function upgrade() {
  console.log("\nUpgrade from a database that predates the field");
  const dataDir = createScratchDataDir();
  const dbFile = path.join(dataDir, "db", "settings.sqlite");
  try {
    const seed = new DatabaseSync(dbFile);
    try {
      seed.exec(`
        CREATE TABLE settings_agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO settings_agents VALUES ('default','Momo','a row from before the field existed',1,'2026-01-01T00:00:00Z');
      `);
    } finally {
      seed.close();
    }
    check(
      "the seeded database really lacks the column",
      columnCount(dbFile, "settings_agents", "permission_mode") === 0
    );

    await withService(dataDir, (service) => {
      console.log(`service ready    : ${service.endpoint}`);
      check(
        "startup ALTERs the column onto the existing table",
        columnCount(dbFile, "settings_agents", "permission_mode") === 1
      );

      const db = new DatabaseSync(dbFile);
      try {
        const row = db.prepare("SELECT id, permission_mode FROM settings_agents WHERE id = 'default'").get();
        check(
          "the pre-existing row survives with no mode pinned",
          Boolean(row) && row.permission_mode === null,
          `row=${JSON.stringify(row)}`
        );
      } finally {
        db.close();
      }
    });
  } finally {
    removeScratchDataDir(dataDir);
  }
}

await freshInstall();
await upgrade();

const failed = checks.filter((c) => !c.ok);
console.log("\n" + "─".repeat(64));
console.log(`PERMISSION MODE MIGRATION  ${checks.length - failed.length}/${checks.length}`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
