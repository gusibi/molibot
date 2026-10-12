import { parseSessionEntries } from "$lib/server/agent/session/session.js";
import { contentText, messageContent } from "$lib/server/agent/session/metadata.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isAgentWorkspace, type SessionSource } from "./agentStorage.js";
import { LEGACY_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import type { AgentStoragePreparation } from "./agentStorageMigration.js";

/** Historical bodies remain unchanged; only verified, published file mappings resolve. */
export function agentFileAliases(workspaceDir: string, source?: Partial<SessionSource>): Array<{ reference: string; local: string }> {
  if (!isAgentWorkspace(workspaceDir)) return [];
  const root = dirname(dirname(resolve(workspaceDir)));
  const file = join(root, "runtime", "agent-storage-migration", "manifest.json");
  if (!existsSync(file)) return [];
  const manifest: AgentStoragePreparation = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.phase !== "completed") return [];
  const agentId = relative(join(root, "sessions"), workspaceDir);
  const scopes = manifest.sessions.filter(item => item.agentId === agentId && (!source || Object.entries(source).every(([key, value]) => value === undefined || item.source[key as keyof SessionSource] === value)));
  const out: Array<{ reference: string; local: string }> = [];
  for (const item of manifest.files) {
    if (!item.source || !manifest.published?.[item.target]) continue;
    const target = resolve(root, item.target);
    const local = relative(workspaceDir, target);
    if (!/^(attachments|scratch|run-details|skill-drafts)[/\\]/.test(local) || local.startsWith("..")) continue;
    out.push({ reference: join(root, item.source), local });
    for (const scope of scopes) {
      const channelRoot = LEGACY_CHANNEL_ROOTS.find(channel => channel.channel === scope.source.channel)?.dir;
      if (!channelRoot) continue;
      const chatMarker = `/${channelRoot}/bots/${scope.source.botId}/${scope.source.chatId}/`;
      const normal = `/${item.source.replaceAll(sep, "/")}`;
      const start = normal.indexOf(chatMarker);
      const botMarker = `/${channelRoot}/bots/${scope.source.botId}/`;
      const botStart = normal.indexOf(botMarker);
      if (start < 0 && (botStart < 0 || !/^(attachments|scratch|run-details)\//.test(normal.slice(botStart + botMarker.length)))) continue;
      const chatLocal = start >= 0 ? normal.slice(start + chatMarker.length) : normal.slice(botStart + botMarker.length);
      out.push({ reference: chatLocal, local }, { reference: `${scope.source.chatId}/${chatLocal}`, local }, { reference: join(root, item.source), local });
    }
  }
  return out;
}
export function resolveAgentFileReference(workspaceDir: string, reference: string, source?: Partial<SessionSource>): string {
  const matches = agentFileAliases(workspaceDir, source).filter(item => item.reference === reference);
  if (new Set(matches.map(item => item.local)).size > 1) throw new Error("Ambiguous historical file reference; include the Session source");
  const mapped = matches[0];
  return mapped ? resolve(workspaceDir, mapped.local) : isAbsolute(reference) ? resolve(reference) : resolve(workspaceDir, reference);
}
export function sessionReferencesFile(workspaceDir: string, local: string, body: string, source?: Partial<SessionSource>): boolean {
  return body.includes(local) || createSessionFileReferenceMatcher(workspaceDir, body, source)(local);
}

/** Builds migration aliases once for a file listing, retaining source-scoped visibility. */
export function createSessionFileReferenceMatcher(workspaceDir: string, body: string, source?: Partial<SessionSource>): (local: string) => boolean {
  const referenced = new Set(agentFileAliases(workspaceDir, source).filter(item => body.includes(item.reference)).map(item => item.local));
  return local => body.includes(local) || referenced.has(local);
}

/** Read copied summaries through their source scope without rewriting historical bytes. */
export function readAgentRunSummaries(workspaceDir: string, source: Partial<SessionSource>): Array<Record<string, unknown>> {
  const root = dirname(dirname(resolve(workspaceDir)));
  const manifestFile = join(root, "runtime", "agent-storage-migration", "manifest.json");
  if (!existsSync(manifestFile)) return [];
  const manifest: AgentStoragePreparation = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (manifest.phase !== "completed") return [];
  const agentId = relative(join(root, "sessions"), workspaceDir);
  const sessions = manifest.sessions.filter(item => item.agentId === agentId && Object.entries(source).every(([key, value]) => value === undefined || item.source[key as keyof SessionSource] === value));
  const rows: Array<Record<string, unknown>> = [];
  for (const file of manifest.files) {
    if (!file.source || !file.target.startsWith(join("sessions", agentId, "run-history") + sep) || !file.target.endsWith("run-summaries.jsonl") || !manifest.published?.[file.target]) continue;
    const owners = sessions.filter(item => {
      const channel = LEGACY_CHANNEL_ROOTS.find(channel => channel.channel === item.source.channel);
      return channel && file.source === join(channel.dir, "bots", item.source.botId, item.source.chatId, "run-summaries.jsonl");
    });
    if (!owners.length || !existsSync(join(root, file.target))) continue;
    for (const line of readFileSync(join(root, file.target), "utf8").split(/\r?\n/)) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const owner = owners.find(item => item.source.sessionId === row.sessionId);
        if (owner) rows.push({ ...row, sessionId: owner.targetId, source: owner.source });
      } catch { /* Ignore malformed historical lines. */ }
    }
  }
  return rows;
}

/** Uses message evidence for provenance; unclassified historical attachments remain unknown. */
export function createSessionFileEvidenceMatcher(workspaceDir: string, body: string, source?: Partial<SessionSource>): (local: string) => { origin: "generated" | "uploaded" | "unknown"; createdAt: string } | null {
  const aliases = agentFileAliases(workspaceDir, source);
  const entries = parseSessionEntries(body).flatMap(entry => {
    if (entry.type !== "message" || !entry.message) return [];
    const message = entry.message;
    const text = contentText(messageContent(message));
    const uploads = message.role === "user" ? JSON.stringify((message as { attachments?: unknown }).attachments ?? []) + (text.match(/<channel_attachments>[\s\S]*?<\/channel_attachments>/)?.[0] ?? "") : "";
    const outputs = message.role === "toolResult" && !message.isError && ["write", "edit", "imageGenerate", "videoGenerate", "attach"].includes(message.toolName) ? JSON.stringify(message) : "";
    return [{ uploads, outputs, timestamp: entry.timestamp ?? "" }];
  });
  const cache = new Map<string, { origin: "generated" | "uploaded" | "unknown"; createdAt: string } | null>();
  return local => {
    if (cache.has(local)) return cache.get(local)!;
    const references = [local, ...aliases.filter(item => item.local === local).map(item => item.reference)];
    const contains = (text: string) => references.some(reference => text.includes(reference));
    const upload = entries.find(entry => contains(entry.uploads));
    const output = entries.find(entry => contains(entry.outputs));
    const result = !contains(body) ? null : upload
      ? { origin: "uploaded" as const, createdAt: upload.timestamp }
      : output ? { origin: "generated" as const, createdAt: output.timestamp }
      : { origin: /(^|[/\\])scratch[/\\]/.test(local) ? "generated" as const : "unknown" as const, createdAt: "" };
    cache.set(local, result);
    return result;
  };
}
