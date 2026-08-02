import { createHash, randomInt } from "node:crypto";

export type RuntimeSessionKind = "session" | "task";

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function randomSuffix(length = 4): string {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

function idPrefix(kind: RuntimeSessionKind): "s" | "t" {
  return kind === "task" ? "t" : "s";
}

/** Shared readable id rule for every Agent Session creation surface. */
export function createRuntimeSessionId(
  kind: RuntimeSessionKind,
  options: { date?: Date; exists?: (candidate: string) => boolean } = {}
): string {
  const marker = `${idPrefix(kind)}-${formatLocalDate(options.date ?? new Date())}-`;
  let candidate = `${marker}${randomSuffix()}`;
  while (options.exists?.(candidate)) {
    candidate = `${marker}${randomSuffix()}`;
  }
  return candidate;
}

/** Deterministic variant used for retry-safe Session forks. */
export function createDeterministicSessionId(parts: readonly string[], date = new Date()): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest();
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += SUFFIX_ALPHABET[digest[index] % SUFFIX_ALPHABET.length];
  }
  return `s-${formatLocalDate(date)}-${suffix}`;
}

/** Accept both the current `t-` form and persisted legacy `task-` contexts. */
export function isTaskSessionId(sessionId: string): boolean {
  return sessionId.startsWith("t-") || sessionId.startsWith("task-");
}
