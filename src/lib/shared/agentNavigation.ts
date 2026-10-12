const nameOrder = new Intl.Collator("zh-CN", { sensitivity: "base", numeric: true });

export function latestAgentConversationTimes(items: ReadonlyArray<{ agentId?: string; updatedAt: string }>): Record<string, number> {
  const times: Record<string, number> = {};
  for (const item of items) {
    if (!item.agentId) continue;
    const time = Date.parse(item.updatedAt);
    if (Number.isFinite(time)) times[item.agentId] = Math.max(times[item.agentId] ?? 0, time);
  }
  return times;
}

export function sortAgentNavigation<T extends { id: string; name: string }>(agents: readonly T[], times: Record<string, number>, defaultAgentId = ""): T[] {
  return [...agents].sort((a, b) => Number(b.id === defaultAgentId) - Number(a.id === defaultAgentId)
    || (times[b.id] ?? 0) - (times[a.id] ?? 0)
    || nameOrder.compare(a.name || a.id, b.name || b.id)
    || a.id.localeCompare(b.id, "en"));
}
