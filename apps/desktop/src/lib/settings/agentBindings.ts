import type { DesktopAgentBinding } from "../api";

/** Project only binding drafts; channel availability and credentials remain untouched. */
export function projectAgentBindings(items: DesktopAgentBinding[], agentId: string, edits: Record<string, boolean>) {
  const rows = items.map(item => {
    const key = `${item.channel}:${item.id}`;
    const targetAgentId = key in edits ? (edits[key] ? agentId : "default") : item.agentId;
    return { ...item, key, targetAgentId };
  });
  const pending = rows.filter(item => item.targetAgentId !== item.agentId);
  return {
    bound: rows.filter(item => item.targetAgentId === agentId),
    available: rows.filter(item => item.targetAgentId !== agentId),
    pending,
    changes: pending.map(item => ({ channel: item.channel, id: item.id, agentId: item.targetAgentId }))
  };
}
