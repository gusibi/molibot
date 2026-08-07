import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ALLOW_EXTERNAL_PATHS_ENV,
  DataDirScopeError,
  createDataDirScope,
  isInsideDir
} from "$lib/server/app/dataDirScope.js";

const HOME = os.homedir();
const PRODUCTION_DATA_DIR = path.join(HOME, ".molibot");
const PRODUCTION_DB_DIR = path.join(PRODUCTION_DATA_DIR, "db");

function expandHomePath(input: string): string {
  if (input === "~") return HOME;
  if (input.startsWith("~/")) return path.join(HOME, input.slice(2));
  return input;
}

function scope(options: {
  dataDir: string;
  dataDirFromOsEnv?: boolean;
  dataDirIsDefault?: boolean;
  cwdEnvOnly?: string[];
  allowExternal?: boolean;
}) {
  const cwdOnly = new Set(options.cwdEnvOnly ?? []);
  return createDataDirScope({
    dataDir: options.dataDir,
    dataDirFromOsEnv: options.dataDirFromOsEnv ?? false,
    dataDirIsDefault: options.dataDirIsDefault ?? false,
    isCwdEnvOnly: (name) => cwdOnly.has(name),
    allowExternal: options.allowExternal ?? false,
    expandHomePath
  });
}

// The incident itself: `DATA_DIR=/tmp/molibot-smoke node build/index.js` run
// from the repository, whose `.env` pins `DB_DIR=~/.molibot/db`. Sessions went
// to /tmp while the production settings database — holding the live WeChat
// token — was opened read-write.
test("an explicit DATA_DIR overrides a DB_DIR pinned only by the repository .env", () => {
  const subject = scope({
    dataDir: "/tmp/molibot-smoke",
    dataDirFromOsEnv: true,
    cwdEnvOnly: ["DB_DIR"]
  });

  const resolved = subject.resolve("DB_DIR", "~/.molibot/db", "/tmp/molibot-smoke/db");

  assert.equal(resolved, "/tmp/molibot-smoke/db");
  assert.deepEqual(subject.ignoredOverrides(), ["DB_DIR"]);
  assert.equal(isInsideDir("/tmp/molibot-smoke", resolved), true);
});

test("a repository .env override still applies when DATA_DIR is not set at all", () => {
  const subject = scope({
    dataDir: PRODUCTION_DATA_DIR,
    dataDirFromOsEnv: false,
    dataDirIsDefault: true,
    cwdEnvOnly: ["DB_DIR"]
  });

  // `pnpm dev` against the default data dir: nothing is being isolated, so the
  // repository's own configuration must keep working exactly as before.
  assert.equal(
    subject.resolve("DB_DIR", "~/.molibot/db", path.join(PRODUCTION_DATA_DIR, "db")),
    PRODUCTION_DB_DIR
  );
  assert.deepEqual(subject.ignoredOverrides(), []);
});

test("an override from the OS environment wins, because it is the same layer as DATA_DIR", () => {
  const subject = scope({
    dataDir: "/srv/molibot",
    dataDirFromOsEnv: true,
    cwdEnvOnly: [],
    allowExternal: true
  });

  assert.equal(subject.resolve("DB_DIR", "/mnt/volume/db", "/srv/molibot/db"), "/mnt/volume/db");
  assert.deepEqual(subject.ignoredOverrides(), []);
});

test("a non-default DATA_DIR whose data escapes it refuses to start", () => {
  const subject = scope({ dataDir: "/tmp/molibot-smoke", dataDirFromOsEnv: true });

  assert.throws(
    () => subject.resolve("DB_DIR", "~/.molibot/db", "/tmp/molibot-smoke/db"),
    (error: unknown) => {
      assert.ok(error instanceof DataDirScopeError);
      assert.match(error.message, /outside DATA_DIR/);
      assert.match(error.message, new RegExp(ALLOW_EXTERNAL_PATHS_ENV));
      return true;
    }
  );
});

test("the escape hatch permits a deliberate external location", () => {
  const subject = scope({
    dataDir: "/tmp/molibot-smoke",
    dataDirFromOsEnv: true,
    allowExternal: true
  });

  assert.equal(subject.resolve("DB_DIR", "~/.molibot/db", "/tmp/molibot-smoke/db"), PRODUCTION_DB_DIR);
});

test("every DATA_DIR-derived location is covered, not just the database", () => {
  const subject = scope({
    dataDir: "/tmp/molibot-smoke",
    dataDirFromOsEnv: true,
    cwdEnvOnly: ["SETTINGS_FILE", "SETTINGS_DB_FILE", "WEB_WORKSPACE_DIR", "SESSIONS_DIR", "PI_CODING_AGENT_DIR"]
  });

  for (const [name, fallback] of [
    ["SETTINGS_FILE", "/tmp/molibot-smoke/settings.json"],
    ["SETTINGS_DB_FILE", "/tmp/molibot-smoke/db/settings.sqlite"],
    ["WEB_WORKSPACE_DIR", "/tmp/molibot-smoke/moli-w"],
    ["SESSIONS_DIR", "/tmp/molibot-smoke/sessions"],
    ["PI_CODING_AGENT_DIR", "/tmp/molibot-smoke/pi"]
  ] as const) {
    assert.equal(subject.resolve(name, path.join(PRODUCTION_DATA_DIR, "x"), fallback), fallback);
  }
  assert.equal(subject.ignoredOverrides().length, 5);
});

test("an unset or blank override always falls back without complaint", () => {
  const subject = scope({ dataDir: "/tmp/molibot-smoke", dataDirFromOsEnv: true });

  assert.equal(subject.resolve("DB_DIR", undefined, "/tmp/molibot-smoke/db"), "/tmp/molibot-smoke/db");
  assert.equal(subject.resolve("DB_DIR", "   ", "/tmp/molibot-smoke/db"), "/tmp/molibot-smoke/db");
  assert.deepEqual(subject.ignoredOverrides(), []);
});

test("isInsideDir rejects a sibling that merely shares a prefix", () => {
  assert.equal(isInsideDir("/tmp/molibot", "/tmp/molibot/db"), true);
  assert.equal(isInsideDir("/tmp/molibot", "/tmp/molibot"), true);
  assert.equal(isInsideDir("/tmp/molibot", "/tmp/molibot-smoke/db"), false);
  assert.equal(isInsideDir("/tmp/molibot", "/tmp/molibot/../other"), false);
});
