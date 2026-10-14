import { basename, isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/** Fixed prefix every isolated UI data directory / temp home must carry. */
export const UI_DATA_PREFIX = 'molibot-ui-';
export const UI_HOME_PREFIX = 'molibot-ui-home-';

export function isInsideDir(parent: string, target: string): boolean {
  const rel = relative(resolve(parent), resolve(target));
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * The isolation guard. It refuses to run whenever the build under test could
 * reach real owner data or a non-local model, independent of what any single
 * test remembered to check. Executed by the isolated instance itself.
 */
export function assertIsolatedDataDir(dir: string, kind: string): void {
  const tempRoot = resolve(tmpdir());
  if (!isInsideDir(tempRoot, dir)) {
    throw new Error(`${kind} data directory ${dir} is not inside the system temp directory ${tempRoot}`);
  }
  if (!basename(resolve(dir)).startsWith(UI_DATA_PREFIX)) {
    throw new Error(`${kind} data directory ${dir} does not carry the ${UI_DATA_PREFIX} prefix`);
  }
}

export function assertLoopbackUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is not a valid URL: ${url}`);
  }
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') {
    throw new Error(`${label} must be a loopback address, got ${host}`);
  }
}

/** Assert no resolved storage path lands inside a forbidden (real) directory. */
export function assertOutsideDir(paths: Record<string, string>, forbidden: string, label: string): void {
  const target = resolve(forbidden);
  for (const [name, value] of Object.entries(paths)) {
    if (isInsideDir(target, value)) {
      throw new Error(`${label}: ${name} resolves to ${value}, inside the real data directory ${target}`);
    }
  }
}
