/**
 * error classification for the durable executor.
 *
 * The three classes are not cosmetic: a storage failure must stop the executor
 * (the database may be corrupt or full, and continuing would write a wrong
 * recovery state), a request failure only fails the current call, and a
 * business failure fails the current attempt.
 */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_IOERR = 10;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;

const FATAL_CODES = new Set([SQLITE_READONLY, SQLITE_IOERR, SQLITE_CORRUPT, SQLITE_FULL, SQLITE_CANTOPEN, SQLITE_NOTADB]);
const TRANSIENT_CODES = new Set([SQLITE_BUSY, SQLITE_LOCKED]);

function sqliteCode(error: unknown): number | undefined {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" ? code : undefined;
}

/** I/O, corruption, full disk, read-only file: the executor must fail-stop. */
export function isStorageError(error: unknown): boolean {
  const code = sqliteCode(error);
  if (code === undefined) return false;
  return FATAL_CODES.has(code);
}

/** Contention we can wait out: retry the trigger later instead of failing work. */
export function isTransientError(error: unknown): boolean {
  const code = sqliteCode(error);
  if (code === undefined) return false;
  return TRANSIENT_CODES.has(code);
}
