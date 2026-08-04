import { mkdirSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

/**
 * Crash capture for the service process.
 *
 * Two things were missing before this existed. First, an uncaught exception
 * left only Node's default stderr dump: real, and it does reach the desktop
 * log, but buried in megabytes of ordinary output with nothing marking it as
 * the moment the process died. Second, nothing recorded the crash separately,
 * so "it crashed last night and I don't know why" meant scrolling a 30MB file.
 *
 * So a crash now produces two artefacts: one structured `[mom-t]` line on
 * stderr (which the supervisor's log pump captures and the desktop log panel
 * parses and filters like any other record), and a standalone report file under
 * `<dataDir>/runtime/crashes/`.
 *
 * Both are written with synchronous calls. `process.exit()` does not flush
 * asynchronous writes to a pipe, and a crash report that loses its stack to a
 * truncated buffer is worse than none — it looks like the process vanished.
 */

const CRASH_DIR_NAME = "crashes";
/** Reports kept on disk. Enough to see a crash loop, bounded for an app dir. */
const MAX_CRASH_REPORTS = 20;

export function crashDir(dataDir) {
  return path.join(dataDir, "runtime", CRASH_DIR_NAME);
}

function describe(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
      code: error.code ?? null,
      cause: error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : null
    };
  }
  // A rejection can carry any value at all, including undefined.
  return { name: typeof error, message: String(error), stack: null, code: null, cause: null };
}

/**
 * The one-line structured record. Shares the `[mom-t] {json}` shape the rest of
 * the service logs in, so it lands in the desktop log panel as a filterable
 * `error`/`runtime` record rather than an unparsed raw line.
 */
export function formatCrashLine(record) {
  return `[mom-t] ${JSON.stringify({
    ts: record.ts,
    level: "error",
    category: "runtime",
    scope: "service",
    event: "service_crash",
    status: "error",
    schemaVersion: 1,
    kind: record.kind,
    pid: record.pid,
    uptimeSeconds: record.uptimeSeconds,
    message: `${record.error.name}: ${record.error.message}`,
    errorDetails: record.error
  })}\n`;
}

export function buildCrashRecord({ kind, error, pid = process.pid, now = new Date(), uptimeSeconds = process.uptime() }) {
  return {
    kind,
    pid,
    ts: now.toISOString(),
    uptimeSeconds: Math.round(uptimeSeconds),
    error: describe(error)
  };
}

/**
 * Deletes the oldest reports beyond `keep`. Names are ISO-prefixed, so a
 * lexical sort is a chronological one.
 */
export function pruneCrashReports(dir, keep = MAX_CRASH_REPORTS) {
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".log")).sort();
  } catch {
    return;
  }
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    try {
      rmSync(path.join(dir, name), { force: true });
    } catch {
      // A report we cannot delete is not worth failing a crash path over.
    }
  }
}

export function writeCrashReport(dataDir, record) {
  const dir = crashDir(dataDir);
  try {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${record.ts.replace(/[:.]/g, "-")}-${record.pid}.log`);
    writeFileSync(
      file,
      [
        `kind: ${record.kind}`,
        `time: ${record.ts}`,
        `pid: ${record.pid}`,
        `uptimeSeconds: ${record.uptimeSeconds}`,
        `version: ${process.env.MOLIBOT_VERSION || "unknown"}`,
        `node: ${process.version}`,
        "",
        record.error.stack || `${record.error.name}: ${record.error.message}`,
        ""
      ].join("\n"),
      "utf8"
    );
    pruneCrashReports(dir);
    return file;
  } catch {
    // The structured stderr line is the copy that matters; a data directory we
    // cannot write to is very likely the reason for the crash in the first
    // place, and throwing here would replace the real cause with this one.
    return null;
  }
}

/**
 * Installs `uncaughtException` / `unhandledRejection` handlers.
 *
 * These deliberately keep Node's default outcome — the process still exits
 * non-zero — because a service that survives an unknown broken invariant is
 * how you get silent data corruption, and the supervisor is what brings it
 * back. The handlers only add the record of *why*, plus `beforeExit` cleanup.
 *
 * This matters more than it looks: Mini App server modules are `import()`ed
 * into this process, so an unawaited rejection inside a third-party Mini App
 * takes the whole service down, and until now it did so anonymously.
 */
/**
 * A broken stdout/stderr pipe is not a broken invariant.
 *
 * The desktop supervisor owns this process's stdout. When that pipe closes
 * (supervisor restart, log rotation, the app quitting), every subsequent write
 * raises `EPIPE` — synchronously from `console.log`, or asynchronously as a
 * stream `error` event. Either way it reached the uncaughtException handler and
 * killed a healthy service; twice in one day that happened mid-run and left a
 * scheduled task pinned at "running" (issue: 自动化任务卡在进行中).
 *
 * Losing log output is the correct outcome here, so these are swallowed rather
 * than reported. Genuine faults still crash the process as before.
 */
export function isBrokenPipeError(error) {
  const code = error?.code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END";
}

export function installStdioErrorGuards(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    stream?.on?.("error", (error) => {
      if (isBrokenPipeError(error)) return;
      throw error;
    });
  }
}

export function installCrashHandlers({ dataDir, onCrash, exit = (code) => process.exit(code) }) {
  installStdioErrorGuards();

  const report = (kind, error) => {
    if (isBrokenPipeError(error)) return;
    const record = buildCrashRecord({ kind, error });
    try {
      writeSync(2, formatCrashLine(record));
    } catch {
      // stderr is gone; the file below is the remaining copy.
    }
    const file = writeCrashReport(dataDir, record);
    try {
      onCrash?.(record, file);
    } catch {
      // Cleanup must never mask the crash.
    }
    exit(1);
  };

  process.on("uncaughtException", (error) => report("uncaughtException", error));
  process.on("unhandledRejection", (reason) => report("unhandledRejection", reason));
}
