/**
 * Where an over-long tool output goes when it does not fit in the context.
 *
 * bash, host tools and MCP all render a truncated view and point the model at
 * the full text on disk. The path construction lives here so the three do not
 * drift apart, and so a new caller cannot quietly become a fourth copy.
 *
 * `spillFullOutput` never throws: a read-only or missing scratch directory must
 * degrade to "truncated, no pointer", not fail the tool call that produced the
 * output.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function buildTempOutputPath(dir: string, prefix: string): string {
  mkdirSync(dir, { recursive: true });
  return join(dir, `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
}

export function spillFullOutput(dir: string, output: string, prefix: string): string | null {
  try {
    const path = buildTempOutputPath(dir, prefix);
    writeFileSync(path, output, "utf8");
    return path;
  } catch {
    return null;
  }
}
