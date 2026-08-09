import { openSync, writeSync, closeSync, fstatSync, mkdirSync, renameSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { runtimeDir } from "./runtime-paths.mjs";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

/**
 * Tees `process.stdout`/`process.stderr` into a size-rotating log file so the
 * standalone Web/Node service keeps a bounded on-disk log (the desktop build
 * gets the same behaviour from the Rust supervisor's own rolling writer, so it
 * skips this path). When the active file passes `maxBytes` it is rolled to
 * `server.log.1`, older generations shift up, and anything beyond `maxFiles`
 * backups is discarded.
 *
 * Returns a `dispose()` that restores the original writers — mainly for tests.
 */
export function installFileLogger({
  dataDir,
  fileName = "server.log",
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES
} = {}) {
  if (!dataDir) throw new Error("installFileLogger requires a dataDir");
  const logDir = runtimeDir(dataDir);
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, fileName);

  let fd = openSync(logPath, "a");
  let bytes = safeSize(fd);

  const rotate = () => {
    closeSync(fd);
    // Drop the oldest, then shift each backup up one generation.
    const oldest = `${logPath}.${maxFiles}`;
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const from = `${logPath}.${index}`;
      if (existsSync(from)) renameSync(from, `${logPath}.${index + 1}`);
    }
    renameSync(logPath, `${logPath}.1`);
    fd = openSync(logPath, "a");
    bytes = 0;
  };

  const append = (chunk, encoding) => {
    try {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8");
      // Rotate before the write so a single record never straddles files, and
      // maxBytes stays a firm ceiling even for a large line.
      if (bytes > 0 && bytes + buffer.length > maxBytes) rotate();
      writeSync(fd, buffer);
      bytes += buffer.length;
    } catch {
      // Never let a logging failure crash the service.
    }
  };

  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  const patch = (stream, original) => {
    stream.write = function patchedWrite(chunk, encoding, callback) {
      append(chunk, encoding);
      return original(chunk, encoding, callback);
    };
  };
  patch(process.stdout, stdoutWrite);
  patch(process.stderr, stderrWrite);

  return {
    logPath,
    dispose() {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
  };
}

function safeSize(fd) {
  try {
    return fstatSync(fd).size;
  } catch {
    return 0;
  }
}
