export interface RunDetailEntry {
  timestamp: string;
  type: "run_start" | "info" | "tool_start" | "tool_end" | "final";
  summary: string;
  toolName?: string;
  displayName?: string;
  isError?: boolean;
}

export function parseRunDetailEntries(raw: string): RunDetailEntry[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RunDetailEntry];
      } catch {
        return [];
      }
    });
}

export function formatRunArchiveNotice(runId: string): string {
  return `本次执行成功，详细记录已归档。查看：/runlog ${runId}`;
}

export function formatRunLogText(runId: string, entries: RunDetailEntry[], maxEntries = 20): string {
  if (entries.length === 0) {
    return `未找到运行记录：${runId}`;
  }

  const lines = [`运行记录 ${runId}`, `共 ${entries.length} 条`, ""];
  const windowed = entries.slice(-Math.max(1, maxEntries));
  if (entries.length > windowed.length) {
    lines.push(`仅显示最近 ${windowed.length} 条：`);
  }

  for (const entry of windowed) {
    const time = entry.timestamp.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
    if (entry.type === "tool_start") {
      lines.push(`[${time}] → ${entry.displayName || entry.toolName || "tool"}: ${entry.summary}`);
      continue;
    }
    if (entry.type === "tool_end") {
      lines.push(`[${time}] ${entry.isError ? "✗" : "✓"} ${entry.displayName || entry.toolName || "tool"}: ${entry.summary}`);
      continue;
    }
    if (entry.type === "final") {
      lines.push(`[${time}] 结束: ${entry.summary}`);
      continue;
    }
    lines.push(`[${time}] ${entry.summary}`);
  }

  return lines.join("\n");
}
