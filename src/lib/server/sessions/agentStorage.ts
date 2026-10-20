import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readSessionMetadataFile } from "$lib/server/agent/session/metadata.js";

export interface SessionSource { channel: string; botId: string; chatId: string; sessionId?: string }
export interface AgentSessionLocation { agentId: string; sessionId: string; workspaceDir: string; contextsDir: string; source: SessionSource }
export function agentWorkspaceDir(dataRoot: string, agentId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(agentId) || agentId === "." || agentId === "..") throw new Error("Invalid Agent ID");
  return resolve(dataRoot, "sessions", agentId);
}
export function channelDataDir(dataRoot: string, channel: string, botId?: string): string {
  for (const value of [channel, ...(botId ? [botId] : [])]) {
    if (!/^[a-zA-Z0-9._@+-]+$/.test(value) || value.includes("..")) throw new Error("Invalid Channel identity");
  }
  return botId ? resolve(dataRoot, "channels", channel, "bots", botId) : resolve(dataRoot, "channels", channel);
}
export function isAgentWorkspace(path: string): boolean { return /\/sessions\/[^/]+$/.test(resolve(path).replace(/\\/g, "/")); }
export function listAgentSessions(dataRoot: string, source?: Partial<SessionSource>): AgentSessionLocation[] {
  const root = join(dataRoot, "sessions");
  if (!existsSync(root)) return [];
  const out: AgentSessionLocation[] = [];
  for (const agent of readdirSync(root, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    const workspaceDir = agentWorkspaceDir(dataRoot, agent.name);
    const contextsDir = join(workspaceDir, "contexts");
    if (!existsSync(contextsDir)) continue;
    const ids = new Set(readdirSync(contextsDir).filter(file => /\.jsonl?$/.test(file) && !file.endsWith(".meta.json")).map(file => file.replace(/\.jsonl?$/, "")));
    for (const sessionId of ids) {
      const meta = readSessionMetadataFile(contextsDir, sessionId);
      if (!meta?.source || !meta.agentId) continue;
      // Ownership comes from the sidecar, not the physical directory: a claimed
      // legacy Session keeps its files where they are but reports its new Agent.
      const owner = String(meta.agentId);
      if (source && Object.entries(source).some(([key, value]) => value !== undefined && meta.source?.[key as keyof SessionSource] !== value)) continue;
      out.push({ agentId: owner, sessionId, workspaceDir, contextsDir, source: meta.source });
    }
  }
  return out;
}
function routeKey(source: SessionSource): string { return JSON.stringify([source.channel, source.botId, source.chatId]); }
export interface ActiveSessionRoute { agentId: string; sessionId: string }
export function readActiveRoute(dataRoot: string, source: SessionSource): ActiveSessionRoute | undefined {
  const file = join(dataRoot, "sessions", "active-routes.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"))[routeKey(source)];
}
export function writeActiveRoute(dataRoot: string, source: SessionSource, route: ActiveSessionRoute): void {
  const file = join(dataRoot, "sessions", "active-routes.json");
  const routes = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  routes[routeKey(source)] = route;
  mkdirSync(join(dataRoot, "sessions"), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(routes, null, 2));
  renameSync(`${file}.tmp`, file);
}

export function findAgentSession(dataRoot: string, sessionId: string, source?: Partial<SessionSource>): AgentSessionLocation | undefined {
  if (!/^[a-zA-Z0-9._-]+$/.test(sessionId) || sessionId === "." || sessionId === "..") return undefined;
  const root = join(dataRoot, "sessions");
  if (!existsSync(root)) return undefined;
  for (const agent of readdirSync(root, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    const workspaceDir = agentWorkspaceDir(dataRoot, agent.name);
    const contextsDir = join(workspaceDir, "contexts");
    const meta = readSessionMetadataFile(contextsDir, sessionId);
    if (!meta?.agentId || !meta.source) continue;
    if (source && Object.entries(source).some(([key, value]) => value !== undefined && meta.source?.[key as keyof SessionSource] !== value)) continue;
    if (!existsSync(join(contextsDir, `${sessionId}.jsonl`)) && !existsSync(join(contextsDir, `${sessionId}.json`))) continue;
    return { agentId: String(meta.agentId), sessionId, workspaceDir, contextsDir, source: meta.source };
  }
  return undefined;
}
