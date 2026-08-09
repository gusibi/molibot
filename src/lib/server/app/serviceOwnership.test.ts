import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// `env.ts` resolves `config.dataDir` at module load, so the temporary data
// directory has to exist in the environment before anything imports it.
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "molibot-ownership-"));
process.env.DATA_DIR = DATA_DIR;
delete process.env.MOLIBOT_SERVICE_OWNER_ID;

const {
  ensureServiceOwnership,
  verifyServiceOwnership,
  resetServiceOwnershipCache,
  describeServiceOwnership
} = await import("$lib/server/app/serviceOwnership.js");
const { channelPluginMayRun } = await import("$lib/server/plugins/loader.js");

const LOCK_PATH = path.join(DATA_DIR, "runtime", "service.lock");

function writeForeignLock(ownerId: string, pid: number): void {
  mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  writeFileSync(LOCK_PATH, `${JSON.stringify({ ownerId, pid, startedAt: new Date().toISOString() })}\n`);
}

function clearLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // already gone
  }
}

test.after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(() => {
  resetServiceOwnershipCache();
  delete process.env.MOLIBOT_SERVICE_OWNER_ID;
  clearLock();
});

test("an unowned data directory is claimed by the runtime itself, not the launcher", () => {
  // This is the whole point of the fix: `node build/index.js` never calls
  // `acquireServiceLease`, so ownership has to be asserted where the channels
  // actually start.
  const ownership = ensureServiceOwnership();

  assert.equal(ownership.owned, true);
  assert.equal(ownership.owned && ownership.source, "runtime");
  assert.equal(process.env.MOLIBOT_SERVICE_OWNER_ID, ownership.owned ? ownership.ownerId : undefined);
  assert.equal(verifyServiceOwnership(), true);
});

test("the launcher's lease is adopted rather than fought over", () => {
  const ownerId = "launcher-owner-id";
  writeForeignLock(ownerId, process.pid);
  process.env.MOLIBOT_SERVICE_OWNER_ID = ownerId;

  const ownership = ensureServiceOwnership();

  assert.equal(ownership.owned, true);
  assert.equal(ownership.owned && ownership.source, "launcher");
  assert.equal(ownership.owned && ownership.ownerId, ownerId);
});

test("a live foreign owner blocks ownership instead of starting a second bot", () => {
  // `process.pid` is unambiguously alive, so the lease module must treat this
  // lock as held rather than reclaiming it.
  writeForeignLock("someone-elses-owner-id", process.pid);

  const ownership = ensureServiceOwnership();

  assert.equal(ownership.owned, false);
  assert.equal(!ownership.owned && ownership.reason, "conflict");
  assert.match(describeServiceOwnership(ownership), /not owned \(conflict/);
  assert.equal(verifyServiceOwnership(), false);
});

test("a launcher owner id that does not match the lock is not trusted", () => {
  // A stale `MOLIBOT_SERVICE_OWNER_ID` inherited from a parent process must not
  // be able to assert ownership on its own.
  writeForeignLock("real-owner", process.pid);
  process.env.MOLIBOT_SERVICE_OWNER_ID = "stale-inherited-owner";

  const ownership = ensureServiceOwnership();

  assert.equal(ownership.owned, false);
  assert.equal(!ownership.owned && ownership.reason, "conflict");
});

test("ownership lost after startup is detected, so the watchdog can stop channels", () => {
  const ownership = ensureServiceOwnership();
  assert.equal(ownership.owned, true);
  assert.equal(verifyServiceOwnership(), true);

  // A /tmp data dir swept by the OS, or an operator clearing the lock.
  clearLock();
  assert.equal(verifyServiceOwnership(), false);

  // Taken over by a replacement instance.
  writeForeignLock("replacement-owner", process.pid);
  assert.equal(verifyServiceOwnership(), false);
});

test("channels requiring ownership stay stopped when unowned; local ones keep running", () => {
  const unowned = { owned: false as const };
  const owned = { owned: true as const };

  assert.equal(channelPluginMayRun({ requiresServiceOwnership: true }, unowned), false);
  assert.equal(channelPluginMayRun({ requiresServiceOwnership: false }, unowned), true);
  // Undeclared means external: a third-party channel must not opt out by omission.
  assert.equal(channelPluginMayRun({}, unowned), false);
  assert.equal(channelPluginMayRun({ requiresServiceOwnership: true }, owned), true);
  assert.equal(channelPluginMayRun({}, owned), true);
});

/**
 * The ownership gate cannot protect a throwaway run: an eval instance seeded
 * from a real data directory holds real bot tokens and legitimately owns its
 * own temporary directory, so ownership answers "yes" and the owner's bot
 * replies from a scratch process. The kill switch has to outrank ownership.
 */
test("MOLIBOT_DISABLE_EXTERNAL_CHANNELS outranks ownership for outward channels", () => {
  const owned = { owned: true as const };
  const disabled = { externalChannelsDisabled: true };

  assert.equal(channelPluginMayRun({ requiresServiceOwnership: true }, owned, disabled), false);
  assert.equal(channelPluginMayRun({}, owned, disabled), false);
  // Web and CLI are how such a run is driven, so they must survive it.
  assert.equal(channelPluginMayRun({ requiresServiceOwnership: false }, owned, disabled), true);
});
