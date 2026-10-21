import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A Session sidecar carries ownership twice: the top-level `agentId` written by
 * the Agent store (the authority) and the `ui.conversation.agentId` mirror the
 * session store keeps for its own readers. They are written together, so a
 * mismatch means a write was interrupted or a legacy file was edited by hand.
 */
export interface AgentOwnershipDivergence {
  sessionId: string;
  workspace: string;
  storedAgentId: string;
  mirroredAgentId: string;
}

export function findAgentOwnershipDivergences(dataRoot: string): AgentOwnershipDivergence[] {
  const root = join(dataRoot, "sessions");
  if (!existsSync(root)) return [];
  const out: AgentOwnershipDivergence[] = [];
  for (const workspace of readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const contexts = join(root, workspace.name, "contexts");
    if (!existsSync(contexts)) continue;
    for (const name of readdirSync(contexts)) {
      if (!name.endsWith(".meta.json")) continue;
      const raw = readMetaFile(join(contexts, name));
      const stored = typeof raw?.agentId === "string" ? raw.agentId.trim() : "";
      const mirrored = typeof raw?.ui?.conversation?.agentId === "string" ? raw.ui.conversation.agentId.trim() : "";
      if (!stored || !mirrored || stored === mirrored) continue;
      out.push({ sessionId: name.slice(0, -".meta.json".length), workspace: workspace.name, storedAgentId: stored, mirroredAgentId: mirrored });
    }
  }
  return out;
}

/**
 * Startup diagnostic. It never rewrites ownership: execution already trusts the
 * stored field, and silently "fixing" a mirror would hide the interrupted write
 * that produced the mismatch.
 */
export function reportAgentOwnershipDivergences(dataRoot: string): { checked: number; diverged: number; items: AgentOwnershipDivergence[] } {
  const items = findAgentOwnershipDivergences(dataRoot);
  return { checked: countMetaFiles(dataRoot), diverged: items.length, items: items.slice(0, 20) };
}

function readMetaFile(file: string): { agentId?: unknown; ui?: { conversation?: { agentId?: unknown } } } | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function countMetaFiles(dataRoot: string): number {
  const root = join(dataRoot, "sessions");
  if (!existsSync(root)) return 0;
  let total = 0;
  for (const workspace of readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const contexts = join(root, workspace.name, "contexts");
    if (!existsSync(contexts)) continue;
    total += readdirSync(contexts).filter(name => name.endsWith(".meta.json")).length;
  }
  return total;
}
