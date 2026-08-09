#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../runtime/runtime-paths.mjs";

/**
 * Reports — and, only when told to, removes — files the data directory
 * accumulated from layouts and features that have since moved.
 *
 * Three rules make this safe to run against a real `~/.molibot`:
 *
 *  1. It is a *planner*. `planDataDirCleanup` is pure and returns findings; the
 *     CLI prints them and does nothing else unless `--apply` is passed.
 *  2. Nothing is matched by shape. Every candidate is a named leftover of a
 *     specific change, with the reason recorded, so a file this script has
 *     never heard of is always left alone.
 *  3. Anything whose removal could conceivably lose something the owner wants
 *     is `review`, not `safe`, and needs `--include-review` on top of `--apply`.
 *
 * The relocated SQLite files are the sharpest edge: they are only proposed when
 * the migrated copy already exists in `db/`, because the root copy is the live
 * database until `migrateLegacyDbFiles` has run.
 */

const SQLITE_SIDE_SUFFIXES = ["", "-wal", "-shm"];

/** Directories replaced by `storagePaths.settingsTestsDir` (`cache/settings-tests`). */
const RELOCATED_SETTINGS_TEST_DIRS = [
  "settings-image-tests",
  "settings-tts-tests",
  "settings-video-downloads"
];

/** Databases `migrateLegacyDbFiles()` moves into `db/`. */
const RELOCATED_DATABASES = [
  ["settings.sqlite", "settings.sqlite"],
  ["inbound-queue.sqlite", "inbound-queue.sqlite"],
  ["outbox.sqlite", "outbox.sqlite"],
  ["sessions.db", "sessions.db"]
];

function entrySize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    let info;
    try {
      info = statSync(current);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      let children = [];
      try {
        children = readdirSync(current);
      } catch {
        continue;
      }
      for (const child of children) stack.push(path.join(current, child));
    } else {
      total += info.size;
    }
  }
  return total;
}

function isProcessRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function planDataDirCleanup(dataDir, options = {}) {
  const readPid = options.readPid ?? ((file) => {
    try {
      return Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    } catch {
      return Number.NaN;
    }
  });
  const processRunning = options.processRunning ?? isProcessRunning;
  const findings = [];

  const add = (relative, category, safety, reason) => {
    const target = path.join(dataDir, relative);
    if (!existsSync(target)) return;
    findings.push({ path: target, relative, category, safety, reason, bytes: entrySize(target) });
  };

  for (const name of RELOCATED_SETTINGS_TEST_DIRS) {
    add(
      name,
      "relocated",
      "safe",
      "Throwaway output of a Settings provider test; now written to cache/settings-tests/."
    );
  }

  // The 3.9 GB case in practice: a Python 3.9 virtualenv from a layout that
  // predates tooling/python/venv. Nothing in the codebase references it.
  add(
    path.join("tooling", "sandbox-venv"),
    "relocated",
    "safe",
    "Superseded virtualenv; the Agent has used tooling/python/venv since."
  );

  for (const [rootName, dbName] of RELOCATED_DATABASES) {
    // Only once the migrated copy exists — until then the root file IS the
    // database, and removing it would delete live data.
    if (!existsSync(path.join(dataDir, "db", dbName))) continue;
    for (const suffix of SQLITE_SIDE_SUFFIXES) {
      add(
        `${rootName}${suffix}`,
        "relocated",
        "safe",
        `Superseded by db/${dbName}${suffix}, which already exists.`
      );
    }
  }

  add(".DS_Store", "noise", "safe", "Finder metadata.");

  for (const name of ["response.json", "response.json.1"]) {
    add(name, "debris", "review", "Raw provider response dump left in the data root.");
  }
  for (const name of ["settings copy.json", "settings copy 2.json"]) {
    add(name, "debris", "review", "Manual settings backup. Check it holds nothing you still need.");
  }
  add("event.log", "debris", "review", "Superseded by runtime/ logs and the Trace database.");

  let rootEntries = [];
  try {
    rootEntries = readdirSync(dataDir);
  } catch {
    rootEntries = [];
  }
  for (const name of rootEntries) {
    if (/^skill-drafts-backup-.*\.tgz$/.test(name)) {
      add(name, "debris", "review", "One-off Skill draft backup archive.");
    }
    if (/^molibot-.*\.pid$/.test(name)) {
      const pid = readPid(path.join(dataDir, name));
      if (processRunning(pid)) continue;
      add(name, "debris", "safe", `Stale pid file; process ${pid} is not running.`);
    }
  }

  return findings;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function main(argv) {
  const apply = argv.includes("--apply");
  const includeReview = argv.includes("--include-review");
  const dataDir = resolveDataDir();

  if (!existsSync(dataDir)) {
    console.error(`No data directory at ${dataDir}`);
    process.exitCode = 1;
    return;
  }

  const findings = planDataDirCleanup(dataDir);
  if (findings.length === 0) {
    console.log(`${dataDir} is clean — nothing to report.`);
    return;
  }

  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.safety)) groups.set(finding.safety, []);
    groups.get(finding.safety).push(finding);
  }

  console.log(`Data directory: ${dataDir}\n`);
  for (const safety of ["safe", "review"]) {
    const group = groups.get(safety) ?? [];
    if (group.length === 0) continue;
    const total = group.reduce((sum, finding) => sum + finding.bytes, 0);
    const heading =
      safety === "safe"
        ? "Superseded by a current location — removable"
        : "Needs your eyes before removal";
    console.log(`${heading}  (${group.length} items, ${formatBytes(total)})`);
    for (const finding of group) {
      console.log(`  ${finding.relative.padEnd(38)} ${formatBytes(finding.bytes).padStart(9)}  ${finding.reason}`);
    }
    console.log("");
  }

  const removable = findings.filter(
    (finding) => finding.safety === "safe" || (includeReview && finding.safety === "review")
  );

  if (!apply) {
    const total = removable.reduce((sum, finding) => sum + finding.bytes, 0);
    console.log(`Nothing was deleted. Re-run with --apply to remove ${removable.length} item(s), ${formatBytes(total)}.`);
    if (!includeReview && groups.has("review")) {
      console.log("Add --include-review to also remove the second group.");
    }
    return;
  }

  let reclaimed = 0;
  for (const finding of removable) {
    try {
      rmSync(finding.path, { recursive: true, force: true });
      reclaimed += finding.bytes;
      console.log(`removed  ${finding.relative}`);
    } catch (error) {
      console.error(`failed   ${finding.relative}: ${error?.message ?? error}`);
    }
  }
  console.log(`\nReclaimed ${formatBytes(reclaimed)}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
