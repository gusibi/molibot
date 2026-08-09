import os from "node:os";
import path from "node:path";

/**
 * The one place the service-side layout of `<dataDir>/runtime` is spelled out.
 *
 * Before this module the string `"runtime"` was written independently in
 * `service-lease.mjs`, `crash-report.mjs`, `file-logger.mjs` and the Rust
 * supervisor — four copies of a layout decision, none of which could notice the
 * others changing. The Rust side still needs its own copy (it cannot import
 * this), but the three Node entry points now share one.
 *
 * Everything under here is service-owned: the ownership lock, the state file
 * the desktop supervisor reads, rolled logs, crash reports, and the extracted
 * runtime generations. It is created 0700 and the Agent is never handed a path
 * inside it — Agent tool dependencies live in the sibling `<dataDir>/tooling`
 * (see `storagePaths.toolingDir`).
 */
export const RUNTIME_DIR_NAME = "runtime";
export const LOCK_FILE_NAME = "service.lock";
export const STATE_FILE_NAME = "service-state.json";
export const CRASH_DIR_NAME = "crashes";
export const GENERATION_PREFIX = "desktop-runtime-";
export const RUNTIME_DIR_MODE = 0o700;

export function expandHomePath(input, homeDir = os.homedir()) {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

/**
 * `DATA_DIR` as every service entry point resolves it. Kept here rather than in
 * the lease module because the crash reporter and the file logger need the same
 * answer before the lease exists.
 */
export function resolveDataDir(env = process.env, homeDir = os.homedir()) {
  const fallback = path.join(homeDir, ".molibot");
  const raw = String(env.DATA_DIR || fallback).trim();
  return path.resolve(expandHomePath(raw || fallback, homeDir));
}

export function runtimeDir(dataDir) {
  return path.join(dataDir, RUNTIME_DIR_NAME);
}

export function runtimePaths(dataDir) {
  const dir = runtimeDir(dataDir);
  return {
    runtimeDir: dir,
    lockPath: path.join(dir, LOCK_FILE_NAME),
    statePath: path.join(dir, STATE_FILE_NAME),
    crashesDir: path.join(dir, CRASH_DIR_NAME)
  };
}
