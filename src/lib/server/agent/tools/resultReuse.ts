import type { ToolResult } from "$lib/server/agent/tools/toolTypes.js";

interface ResultReuseEntry {
  version: string;
  sources: readonly string[];
  result: ToolResult;
}

/**
 * Per-execution-scope store of pure read results.
 *
 * A caller supplies a stable request key and a freshness token. The same key
 * with a matching token reuses the recorded result, so an agent that repeats an
 * unchanged read is served the prior evidence instead of paying for a second
 * physical read. A changed token, a missing record, or a write to one of the
 * recorded sources all fall through to a real read.
 *
 * The store holds no side-effect state: writes, edits, publishing and approval
 * decisions are never recorded here, so reuse can never skip or replay an
 * effect.
 */
export class ResultReuseCache {
  private readonly entries = new Map<string, ResultReuseEntry>();

  /** The recorded result when the request key and freshness token both match. */
  get(key: string, version: string): ToolResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.version !== version) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.result;
  }

  set(key: string, version: string, sources: readonly string[], result: ToolResult): void {
    this.entries.set(key, { version, sources, result });
  }

  /**
   * Drop every entry that reads one of the written sources. Returns how many
   * entries were dropped so callers can record repeat-prevention evidence.
   */
  invalidateSources(sources: readonly string[]): number {
    if (sources.length === 0) return 0;
    const affected = new Set(sources);
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.sources.some((source) => affected.has(source))) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Human/model-readable explanation of why content was reused. It names the
 * reused source and how to force a fresh read, so the reuse is actionable
 * evidence rather than a silent "already read" rejection.
 */
export function formatReuseNotice(input: { path: string }): string {
  return [
    `[Reused a previous read of "${input.path}": the source is unchanged since then, so this is the same content without re-reading it.`,
    "Change the path or range, or edit the file, to force a fresh read.]"
  ].join(" ");
}

/**
 * Prepend the reuse notice to a recorded result and mark it as reused. The
 * stored result itself stays notice-free, so repeated reuse never stacks notes.
 */
export function markReusedResult(result: ToolResult, notice: string): ToolResult {
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0] as { type?: string; text?: string } | undefined;
  const nextContent =
    first && typeof first === "object" && first.type === "text"
      ? [{ ...first, text: `${notice}\n\n${first.text ?? ""}` }, ...content.slice(1)]
      : [{ type: "text", text: notice }, ...content];
  return {
    ...result,
    content: nextContent,
    metadata: { ...result.metadata, resultReused: true }
  };
}
