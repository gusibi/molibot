import { migrateStorageReferences } from "./agentStorageReferences.js";
import { writeActiveRoute } from "./agentStorage.js";
import { createHash } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LEGACY_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import { normalizeChannelAgentId } from "$lib/server/settings/schema.js";

export interface MigrationBot {
  channel: string;
  botId: string;
  agentId?: string;
}

export interface MigrationBotAssignment { channel: string; botId: string; agentId: string | null; }

export interface MigrationOwnership {
  /** Includes disabled Agents: migration preserves history without admitting execution. */
  agents: string[];
  bots: MigrationBot[];
  agentOptions?: Array<{ id: string; name: string }>;
}

export interface MigrationSource {
  channel: string;
  botId: string;
  chatId: string;
  sessionId: string;
}

export interface MigratingSession {
  source: MigrationSource;
  agentId: string;
  targetId: string;
}

export interface MigratingFile {
  source?: string;
  sourceDigest?: string;
  target: string;
  digest: string;
  content?: string;
}

export interface MigratingRoute {
  channel: string;
  botId: string;
  chatId: string;
  agentId: string;
  sessionId: string;
}

export interface AgentStoragePreparation {
  version: 1;
  force?: boolean;
  skippedIssues?: string[];
  phase: "copying" | "prepared" | "committing" | "completed";
  published?: Record<string, string>;
  copiedFiles?: number;
  uiConversations?: Array<{ externalUserId: string; id: string }>;
  ignoredPaths?: string[];
  botAssignments?: MigrationBotAssignment[];
  automaticSkippedPaths?: string[];
  stagingDir: string;
  sessions: MigratingSession[];
  routes: MigratingRoute[];
  files: MigratingFile[];
}

export interface MigrationStatus {
  skippedIssues?: string[];
  needed: boolean;
  sessions: number;
  conflicts: string[];
  conflictItems: Array<{ message: string; path?: string; canSkip?: boolean; skipBlockedReason?: string; reason?: "missing-bot" | "missing-agent"; channel?: string; botId?: string; agentId?: string; sessionIds?: string[]; details?: string[] }>;
  ignoredPaths: string[];
  botAssignments: MigrationBotAssignment[];
  availableAgents: Array<{ id: string; name: string }>;
  fixedBotAssignments: MigrationBotAssignment[];
  automaticSkippedPaths: string[];
  files: number;
  publishedFiles: number;
  copiedFiles: number;
  phase: "pending" | "copying" | "prepared" | "committing" | "completed";
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const SCRATCH_GENERATED_DIRECTORIES = new Set([".venv", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

function resourceSourcePath(local: string): boolean {
  const parts = local.split(sep);
  if (!LEGACY_CHANNEL_ROOTS.some(item => item.dir === parts[0]) || parts[1] !== "bots" || !parts[2]) return false;
  const kinds = ["scratch", "attachments", "run-details", "skills", "skill-drafts", "events"];
  return kinds.includes(parts[3]) || Boolean(parts[3] && kinds.includes(parts[4]));
}

function safePart(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

/**
 * Prepares copies only. The Runtime lifecycle owns confirmation, quiescence and
 * cutover; a prepared manifest does not authorize reading or writing new stores.
 * Sources are never renamed, removed or opened for writing.
 */
export class AgentStorageMigration {
  private readonly root: string;
  private readonly stagingDir: string;
  private readonly manifestFile: string;
  private readonly ignoredPaths: string[];
  private readonly botAssignments: MigrationBotAssignment[];
  private readonly exclusionsChanged: boolean;
  private readonly force: boolean;
  private skippedIssues: string[] = [];
  private automaticSkippedPaths = new Set<string>();
  private sourceIssues: Array<{ message: string; path: string }> = [];
  private ownershipIssues: Array<{ message: string; reason: "missing-bot" | "missing-agent"; channel: string; botId: string; scope: string; sessionId: string; agentId?: string }> = [];

  constructor(dataRoot: string, private readonly ownership: MigrationOwnership, ignoredPaths?: string[], botAssignments?: MigrationBotAssignment[], force?: boolean) {
    this.root = resolve(dataRoot);
    this.stagingDir = join(this.root, "runtime", "agent-storage-migration");
    this.manifestFile = join(this.stagingDir, "manifest.json");
    const policy = join(this.stagingDir, "ignored-sources.json");
    this.checkPath(policy);
    const saved = existsSync(policy) ? JSON.parse(readFileSync(policy, "utf8")) : {};
    this.force = force ?? saved.force ?? false;
    const savedPaths = saved.paths ?? [];
    const paths = ignoredPaths ?? savedPaths;
    if (!Array.isArray(paths) || paths.length > 256 || paths.some(value => typeof value !== "string" || isAbsolute(value) || value.split(/[\\/]/).some(part => !part || part === "." || part === "..") || !resourceSourcePath(value))) throw new Error("Only relative legacy resource paths can be ignored; Context and identity data must be preserved");
    this.ignoredPaths = [...new Set(paths)].sort();
    const assignments = botAssignments ?? saved.botAssignments ?? [];
    if (!Array.isArray(assignments) || assignments.length > 256 || assignments.some(item => !item || !LEGACY_CHANNEL_ROOTS.some(root => root.channel === item.channel)
      || !safePart(item.botId) || (item.agentId !== null && (!safePart(item.agentId) || !this.ownership.agents.includes(item.agentId))))) throw new Error("Bot assignments require a valid channel, Bot ID and existing Agent");
    if (botAssignments?.some(item => this.ownership.bots.some(bot => bot.channel === item.channel && bot.botId === item.botId))) throw new Error("Only missing Bots can be assigned during migration");
    if (new Set(assignments.map(item => JSON.stringify([item.channel, item.botId]))).size !== assignments.length) throw new Error("Duplicate migration Bot assignment");
    this.botAssignments = assignments.map(({ channel, botId, agentId }) => ({ channel, botId, agentId })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const previous = this.readManifest();
    this.skippedIssues = previous?.skippedIssues ?? [];
    const fixed = previous?.botAssignments ?? [];
    if (fixed.some(item => this.botAssignments.find(assignment => assignment.channel === item.channel && assignment.botId === item.botId)?.agentId !== item.agentId)) throw new Error("Migration ownership is already prepared. Keep the confirmed Bot assignments to retry.");
    this.exclusionsChanged = JSON.stringify(this.ignoredPaths) !== JSON.stringify([...new Set(savedPaths)].sort())
      || JSON.stringify(this.botAssignments) !== JSON.stringify(saved.botAssignments ?? []);
  }

  private checkPath(file: string): void {
    const local = relative(this.root, file);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error("Migration path escapes data root");
    let current = this.root;
    for (const part of ["", ...local.split(sep)]) {
      if (part) current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic link in migration path: ${relative(this.root, current)}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private isGeneratedScratchFile(file: string): boolean {
    const parts = relative(this.root, file).split(sep);
    const scratch = parts.indexOf("scratch");
    return scratch >= 0 && parts.slice(scratch + 1).some(part => SCRATCH_GENERATED_DIRECTORIES.has(part));
  }

  private isIgnored(file: string): boolean {
    const local = relative(this.root, file);
    const parts = local.split(sep);
    const owner = LEGACY_CHANNEL_ROOTS.find(item => item.dir === parts[0]);
    return Boolean(owner && parts[1] === "bots" && this.isBotSkipped(owner.channel, parts[2]!))
      || this.ignoredPaths.some(path => local === path || local.startsWith(path + sep));
  }

  /** Saves explicitly confirmed resource exclusions and missing-Bot ownership; preview is read-only. */
  saveSelections(): void {
    const file = join(this.stagingDir, "ignored-sources.json");
    this.checkPath(file); this.checkPath(`${file}.tmp`);
    mkdirSync(this.stagingDir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify({ paths: this.ignoredPaths, botAssignments: this.botAssignments, force: this.force }, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  private isBotSkipped(channel: string, botId: string): boolean {
    return this.botAssignments.some(item => item.channel === channel && item.botId === botId && item.agentId === null);
  }

  private botFor(channel: string, botId: string): MigrationBot | undefined {
    return this.ownership.bots.find(bot => bot.channel === channel && bot.botId === botId)
      ?? this.botAssignments.find((bot): bot is MigrationBotAssignment & { agentId: string } => bot.channel === channel && bot.botId === botId && bot.agentId !== null);
  }

  private recordSourceIssue(file: string, error: unknown): void {
    const path = relative(this.root, file);
    const message = error instanceof Error ? error.message : String(error);
    if (!this.sourceIssues.some(item => item.message === message)) this.sourceIssues.push({ message, path });
  }

  private directories(dir: string): string[] {
    if (this.isIgnored(dir)) return [];
    if (!existsSync(dir)) return [];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if (!this.force) throw error; this.recordSourceIssue(dir, error); return []; }
    return entries.filter(entry => {
      const file = join(dir, entry.name);
      if (this.isIgnored(file)) return false;
      if (entry.isSymbolicLink()) {
        if (!this.force && !resourceSourcePath(relative(this.root, file))) this.checkPath(file);
        this.recordSourceIssue(file, new Error(`Symbolic link in migration path: ${relative(this.root, file)}`));
        return false;
      }
      return entry.isDirectory();
    }).map(entry => entry.name).sort();
  }

  private scan(): { sessions: MigratingSession[]; routes: MigratingRoute[]; files: MigratingFile[]; conflicts: string[]; uiConversations: Array<{ externalUserId: string; id: string }> } {
    this.sourceIssues = [];
    this.ownershipIssues = [];
    this.automaticSkippedPaths = new Set();
    const previous = this.readManifest();
    const sessions: MigratingSession[] = [];
    const routes: MigratingRoute[] = [];
    const files: MigratingFile[] = [];
    const conflicts: string[] = [];
    const chatScopes: Array<{ chatDir: string; agentId?: string }> = [];
    const botScopes: Array<{ channel: string; botId: string; botDir: string; agentId?: string }> = [];
    const used = new Set(previous?.sessions.map(s => s.targetId));
    for (const agentId of this.ownership.agents) {
      if (!safePart(agentId)) throw new Error(`Invalid Agent ID: ${agentId}`);
      const contexts = join(this.root, "sessions", agentId, "contexts");
      this.checkPath(contexts);
      if (existsSync(contexts)) {
        for (const file of readdirSync(contexts)) used.add(file.replace(/\.(?:meta\.)?jsonl?$/, ""));
      }
    }
    for (const { channel, dir } of LEGACY_CHANNEL_ROOTS) {
      try {
        const bots = join(this.root, dir, "bots");
        this.checkPath(bots);
        for (const botId of this.directories(bots)) {
          const bot = this.botFor(channel, botId);
          const botDir = join(bots, botId);
          botScopes.push({ channel, botId, botDir, agentId: bot ? normalizeChannelAgentId(bot.agentId) : undefined });
          for (const chatId of this.directories(botDir)) {
            try {
              if (["skills", "events", "skill-drafts", "attachments", "scratch", "run-details"].includes(chatId)) continue;
              chatScopes.push({ chatDir: join(botDir, chatId), agentId: bot ? normalizeChannelAgentId(bot.agentId) : undefined });
              const contexts = join(botDir, chatId, "contexts");
              this.checkPath(contexts);
              const legacyContext = join(botDir, chatId, "context.json");
              this.checkPath(legacyContext);
              if (!existsSync(contexts) && !existsSync(legacyContext)) continue;
              const names = existsSync(contexts) ? readdirSync(contexts).sort() : [];
              if (existsSync(legacyContext)) {
                if (names.some(name => name === "default.json" || name === "default.jsonl")) {
                  conflicts.push(`Legacy Context conflicts with default Session: ${relative(this.root, legacyContext)}`);
                } else names.push("default.json");
              }
              const ids = [...new Set(names.filter(name => /\.(json|jsonl)$/.test(name) && !name.endsWith(".meta.json")).map(name => name.replace(/\.jsonl?$/, "")))];
              for (const sessionId of ids) {
                const sessionCount = sessions.length;
                const fileCount = files.length;
                try {
                  const source = { channel, botId, chatId, sessionId };
                  if (!safePart(sessionId)) {
                    conflicts.push(`Invalid Session ID: ${relative(this.root, join(contexts, sessionId))}`);
                    continue;
                  }
                  const metaFile = join(contexts, `${sessionId}.meta.json`);
                  this.checkPath(metaFile);
                  let metadata: Record<string, unknown> = {};
                  let pinned: string | undefined;
                  if (existsSync(metaFile)) {
                    try {
                      metadata = JSON.parse(readFileSync(metaFile, "utf8"));
                      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid metadata");
                      pinned = metadata.agentId as string | undefined;
                    }
                    catch { conflicts.push(`Invalid Session metadata: ${relative(this.root, metaFile)}`); continue; }
                  }
                  const identity = JSON.stringify(source);
                  const saved = previous?.sessions.find(item => JSON.stringify(item.source) === identity);
                  const agentId = pinned ?? saved?.agentId ?? (bot ? normalizeChannelAgentId(bot.agentId) : undefined);
                  if (!agentId || !this.ownership.agents.includes(agentId)) {
                    const message = `Unresolved Agent: ${relative(this.root, join(contexts, sessionId))}`;
                    conflicts.push(message);
                    this.ownershipIssues.push({ message, reason: !bot && !agentId ? "missing-bot" : "missing-agent", channel, botId,
                      scope: relative(this.root, join(botDir, chatId)), sessionId, ...(typeof agentId === "string" ? { agentId } : {}) });
                    continue;
                  }
                  if (saved && saved.agentId !== agentId) {
                    conflicts.push(`Agent ownership changed: ${identity}`);
                    continue;
                  }
                  let targetId = saved?.targetId ?? sessionId;
                  if (!saved && used.has(targetId)) targetId = `${sessionId}-${hash(identity).slice(0, 16)}`;
                  if (!saved && used.has(targetId)) {
                    conflicts.push(`Target Session already exists: ${agentId}/${targetId}`);
                    continue;
                  }
                  used.add(targetId);
                  sessions.push({ source, agentId, targetId });
                  for (const suffix of [".json", ".jsonl"]) {
                    const file = sessionId === "default" && suffix === ".json" && existsSync(legacyContext)
                      && !existsSync(join(contexts, "default.json")) ? legacyContext : join(contexts, `${sessionId}${suffix}`);
                    this.checkPath(file);
                    if (!existsSync(file)) continue;
                    if (!lstatSync(file).isFile()) { conflicts.push(`Not a regular file: ${relative(this.root, file)}`); continue; }
                    files.push(...this.copyFile(file, join("sessions", agentId, "contexts", `${targetId}${suffix}`)));
                  }
                  const content = `${JSON.stringify({ ...metadata, agentId, source }, null, 2)}\n`;
                  files.push({
                    ...(existsSync(metaFile) ? { source: relative(this.root, metaFile), sourceDigest: hash(readFileSync(metaFile)) } : {}),
                    target: join("sessions", agentId, "contexts", `${targetId}.meta.json`),
                    digest: hash(content), content
                  });
                } catch (error) {
                  if (!this.force) throw error;
                  sessions.splice(sessionCount); files.splice(fileCount);
                  this.recordSourceIssue(join(contexts, sessionId), error);
                }
              }
            } catch (error) { if (!this.force) throw error; this.recordSourceIssue(join(botDir, chatId), error); }
          }
        }
      } catch (error) { if (!this.force) throw error; this.recordSourceIssue(join(this.root, dir), error); }
    }
    const scopes = new Map<string, MigratingSession[]>();
    for (const session of sessions) {
      const source = session.source;
      const channelRoot = LEGACY_CHANNEL_ROOTS.find(item => item.channel === source.channel)!;
      const chatDir = join(this.root, channelRoot.dir, "bots", source.botId, source.chatId);
      scopes.set(chatDir, [...(scopes.get(chatDir) ?? []), session]);
    }
    for (const { chatDir } of chatScopes) {
      if (!scopes.has(chatDir)) scopes.set(chatDir, []);
    }
    for (const [chatDir, scopeSessions] of scopes) {
      try {
        const namespace = hash(relative(this.root, chatDir)).slice(0, 16);
        const agents = new Set(scopeSessions.map(session => session.agentId));
        const configured = chatScopes.find(scope => scope.chatDir === chatDir)?.agentId;
        if (!agents.size && configured && this.ownership.agents.includes(configured)) agents.add(configured);
        const histories = ["run-summaries.jsonl", "log.jsonl"].map(name => join(chatDir, name)).filter(file => {
          this.checkPath(file);
          return existsSync(file);
        });
        const resourceFiles = [...histories, ...["attachments", "scratch", "run-details"].flatMap(kind => this.listFiles(join(chatDir, kind)))];
        if (!agents.size && resourceFiles.length) conflicts.push(`Unresolved resource Agent: ${relative(this.root, chatDir)}`);
        for (const agentId of agents) {
          for (const kind of ["attachments", "scratch", "run-details"]) {
            for (const source of this.listFiles(join(chatDir, kind))) {
              const target = join("sessions", agentId, kind, namespace, relative(join(chatDir, kind), source));
              if (kind !== "scratch" || !relative(join(chatDir, kind), source).startsWith(`events${sep}`)) files.push(...this.copyFile(source, target));
            }
          }
          for (const history of histories) {
            files.push(...this.copyFile(history, join("sessions", agentId, "run-history", namespace, relative(chatDir, history))));
          }
        }
        const activeFile = join(chatDir, "active_session.txt");
        this.checkPath(activeFile);
        if (existsSync(activeFile)) {
          const bytes = readFileSync(activeFile);
          const activeId = bytes.toString("utf8").trim();
          const session = scopeSessions.find(item => item.source.sessionId === activeId);
          if (!session) conflicts.push(`Active Session not found: ${relative(this.root, activeFile)}`);
          else {
            const { channel, botId, chatId } = session.source;
            routes.push({ channel, botId, chatId, agentId: session.agentId, sessionId: session.targetId });
            files.push({ source: relative(this.root, activeFile), sourceDigest: hash(bytes), target: join("runtime", "agent-storage-migration", "routes", `${namespace}.json`),
              content: `${JSON.stringify(routes[routes.length - 1])}\n`, digest: hash(`${JSON.stringify(routes[routes.length - 1])}\n`) });
          }
        }
      } catch (error) { if (!this.force) throw error; this.recordSourceIssue(chatDir, error); }
    }
    const eventSources = botScopes.flatMap(scope => [
      ...this.listFiles(join(scope.botDir, "events")).map(source => ({ ...scope, source })),
      ...chatScopes.filter(chat => chat.chatDir.startsWith(scope.botDir + sep)).flatMap(chat => ["events", "scratch/events"].flatMap(dir => this.listFiles(join(chat.chatDir, dir)).map(source => ({ ...scope, source }))))
    ]);
    const skills = new Map<string, string>();
    for (const { botDir, agentId } of [...botScopes, ...chatScopes.map(scope => ({ botDir: scope.chatDir, agentId: scope.agentId }))]) {
      const skillsRoot = join(botDir, "skills");
      const stored = previous?.files.find(file => file.source?.startsWith(relative(this.root, skillsRoot) + sep));
      const skillAgentId = stored?.target.split(sep)[1] ?? agentId;
      if (this.isIgnored(skillsRoot)) continue;
      try { this.checkPath(skillsRoot); } catch (error) { this.recordSourceIssue(skillsRoot, error); continue; }
      for (const skill of this.directories(skillsRoot)) {
        const skillDir = join(skillsRoot, skill);
        try {
          const sources = this.listFiles(skillDir);
          if (!skillAgentId || !this.ownership.agents.includes(skillAgentId)) {
            conflicts.push(`Unresolved Skill Agent: ${relative(this.root, skillDir)}`);
            continue;
          }
          const targetDir = join("sessions", skillAgentId!, "skills", skill);
          const signature = this.treeDigest(skillDir);
          const liveDir = join(this.root, targetDir);
          this.checkPath(liveDir);
          const existing = skills.get(targetDir) ?? (existsSync(liveDir) ? this.treeDigest(liveDir) : undefined);
          const alreadyPublished = previous?.phase === "completed" && previous.files.some(file => file.source?.startsWith(relative(this.root, skillDir)));
          if (!alreadyPublished && existing !== undefined && existing !== signature) {
            conflicts.push(`Skill conflict: ${relative(this.root, skillDir)} -> ${targetDir}`);
            continue;
          }
          skills.set(targetDir, signature);
          for (const source of sources) files.push(...this.copyFile(source, join(targetDir, relative(skillDir, source))));
        } catch (error) { if (!this.force) throw error; this.recordSourceIssue(skillDir, error); }
      }
    }
    for (const { botDir, agentId } of botScopes) {
      const draftsRoot = join(botDir, "skill-drafts");
      const stored = previous?.files.find(file => file.source?.startsWith(relative(this.root, draftsRoot) + sep));
      const owner = stored?.target.split(sep)[1] ?? agentId;
      for (const source of this.listFiles(draftsRoot)) {
        if (!owner || !this.ownership.agents.includes(owner)) { conflicts.push(`Unresolved Skill draft Agent: ${relative(this.root, source)}`); continue; }
        files.push(...this.copyFile(source, join("sessions", owner, "skill-drafts", relative(draftsRoot, source))));
      }
    }
    for (const { botDir, agentId } of botScopes) {
      for (const kind of ["attachments", "scratch", "run-details"]) {
        const resourceRoot = join(botDir, kind);
        const stored = previous?.files.find(file => file.source?.startsWith(relative(this.root, resourceRoot) + sep));
        const owner = stored?.target.split(sep)[1] ?? agentId;
        for (const source of this.listFiles(resourceRoot)) {
          if (!owner || !this.ownership.agents.includes(owner)) { conflicts.push(`Unresolved resource Agent: ${relative(this.root, source)}`); continue; }
          const namespace = hash(relative(this.root, botDir)).slice(0, 16);
          files.push(...this.copyFile(source, join("sessions", owner, kind, namespace, relative(resourceRoot, source))));
        }
      }
    }
    const uiConversations: Array<{ externalUserId: string; id: string }> = [];
    const legacyFiles = LEGACY_CHANNEL_ROOTS.flatMap(({ channel, dir }) => this.listFiles(join(this.root, dir)).map(source => ({ channel, dir, source })));
    const flat = join(this.root, "sessions");
    if (existsSync(flat)) for (const name of readdirSync(flat)) {
      if (name.endsWith(".json") && name !== "ui-index.json" && name !== "active-routes.json") legacyFiles.push({ channel: "web", dir: "sessions", source: join(flat, name) });
    }
    const coveredSources = new Set(files.flatMap(file => file.source ? [file.source] : []));
    for (const { channel, dir, source } of legacyFiles) {
      const fileCount = files.length;
      try {
        const local = relative(this.root, source);
        if (coveredSources.has(local) || eventSources.some(event => event.source === source)) continue;
        let ui: any;
        if (channel === "web" && source.endsWith(".json")) {
          try { const parsed = JSON.parse(readFileSync(source, "utf8")); if (parsed?.conversation) ui = parsed; } catch {}
        }
        if (ui && !ui.conversation.projectId) {
          const owner = String(ui.conversation.externalUserId ?? "");
          const botId = owner.split(":")[1];
          if (!ui.conversation.roomId && this.isBotSkipped("web", botId)) continue;
          const originalId = String(ui.conversation.id ?? "");
          let session = sessions.find(item => item.source.channel === "web" && item.source.botId === botId && item.source.chatId === owner && item.source.sessionId === originalId);
          const configured = this.botFor("web", botId);
          const agentId = ui.conversation.agentId ?? session?.agentId ?? (configured ? configured.agentId || "default" : undefined);
          if (!safePart(originalId) || !agentId || !this.ownership.agents.includes(agentId) || (session && session.agentId !== agentId)) {
            const message = `Unresolved Web Session Agent: ${local}`;
            conflicts.push(message);
            if (botId && safePart(originalId) && (!agentId || !this.ownership.agents.includes(agentId))) this.ownershipIssues.push({ message, reason: !configured && !agentId ? "missing-bot" : "missing-agent", channel: "web", botId,
              scope: join("moli-w", "bots", botId, owner), sessionId: originalId, ...(typeof agentId === "string" ? { agentId } : {}) });
            continue;
          }
          if (!session) {
            const origin = { channel: "web", botId, chatId: owner, sessionId: originalId };
            session = previous?.sessions.find(item => JSON.stringify(item.source) === JSON.stringify(origin));
            if (!session) {
              let targetId = originalId;
              if (used.has(targetId)) targetId = `${originalId}-${hash(JSON.stringify(origin)).slice(0, 16)}`;
              session = { source: origin, agentId, targetId };
            }
            sessions.push(session);
            used.add(session.targetId);
          }
          ui.conversation.id = session.targetId;
          ui.conversation.agentId = agentId;
          const target = join("sessions", agentId, "contexts", `${session.targetId}.meta.json`);
          const existing = files.find(file => file.target === target);
          const metadata = existing?.content ? JSON.parse(existing.content) : { agentId, source: session.source };
          const content = `${JSON.stringify({ ...metadata, ui }, null, 2)}\n`;
          if (existing) {
            existing.content = content; existing.digest = hash(content);
            const snapshot = readFileSync(source);
            files.push({ source: local, sourceDigest: hash(snapshot), target: join("runtime", "agent-storage-migration", "sources", `${hash(local).slice(0, 16)}.json`), digest: hash(snapshot) });
          }
          files.push({ source: local, sourceDigest: hash(readFileSync(source)), target, content, digest: hash(content) });
          uiConversations.push({ externalUserId: owner, id: session.targetId });
          if (!files.some(file => file.target === join("sessions", agentId, "contexts", `${session.targetId}.json`) || file.target === join("sessions", agentId, "contexts", `${session.targetId}.jsonl`))) {
            const messages = (ui.messages ?? ui.messageMetadata ?? []).filter((message: any) => ["user", "assistant"].includes(message.role) && typeof message.content === "string").map((message: any) => ({ role: message.role, content: message.content, timestamp: Date.parse(message.createdAt) || 0 }));
            const content = `${JSON.stringify(messages)}\n`;
            files.push({ target: join("sessions", agentId, "contexts", `${session.targetId}.json`), content, digest: hash(content) });
          }
          coveredSources.add(local);
        } else {
          if (!local.startsWith(join("moli-w", "rooms") + sep) && (local.includes(`${sep}contexts${sep}`) || source.endsWith(`${sep}context.json`))) { conflicts.push(`Unresolved Context location: ${local}`); continue; }
          files.push(...this.copyFile(source, join("channels", channel, relative(join(this.root, dir), source))));
          coveredSources.add(local);
        }
      } catch (error) { if (!this.force) throw error; files.splice(fileCount); this.recordSourceIssue(source, error); }
    }
    for (const session of sessions.filter(item => item.source.channel === "web")) {
      if (uiConversations.some(item => item.id === session.targetId)) continue;
      const metadataFile = files.find(file => file.target === join("sessions", session.agentId, "contexts", `${session.targetId}.meta.json`));
      if (!metadataFile?.content) continue;
      const metadata = JSON.parse(metadataFile.content);
      const context = files.find(file => file.target === join("sessions", session.agentId, "contexts", `${session.targetId}.json`) || file.target === join("sessions", session.agentId, "contexts", `${session.targetId}.jsonl`));
      const timestamp = context?.source ? lstatSync(join(this.root, context.source)).mtime.toISOString() : new Date(0).toISOString();
      const ui = { conversation: { id: session.targetId, channel: "web", externalUserId: session.source.chatId, agentId: session.agentId, title: metadata.title || "New Session", createdAt: timestamp, updatedAt: timestamp, ...(metadata.origin === "automation" ? { origin: "internal:automation" } : {}) }, messageMetadata: [], messageCount: 0 };
      metadataFile.content = `${JSON.stringify({ ...metadata, ui }, null, 2)}\n`;
      metadataFile.digest = hash(metadataFile.content);
      uiConversations.push({ externalUserId: session.source.chatId, id: session.targetId });
    }
    for (const { source, channel, botId, agentId } of eventSources) {
        if (!source.endsWith(".json")) {
          conflicts.push(`Unsupported Event file: ${relative(this.root, source)}`);
          continue;
        }
        try {
          const bytes = readFileSync(source);
          const event = JSON.parse(bytes.toString("utf8"));
          if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Invalid Event");
          const creator = event.sessionId ? sessions.find(session => session.source.channel === channel
            && session.source.botId === botId && session.source.chatId === event.chatId && session.source.sessionId === event.sessionId) : undefined;
          const previousEvent = previous?.files.find(file => file.source === relative(this.root, source));
          const eventAgentId = event.agentId ?? creator?.agentId ?? (previousEvent?.content ? JSON.parse(previousEvent.content).agentId : undefined) ?? agentId;
          if (event.target?.kind === "project" && !safePart(event.target.projectId)) throw new Error("Invalid Project Event target");
          if (!eventAgentId || !this.ownership.agents.includes(eventAgentId)) throw new Error("Unresolved Event Agent");
          const ordinary = event.execution !== "internal" && event.target?.kind !== "project";
          if (ordinary && (typeof event.chatId !== "string" || !event.chatId || (event.sessionId && !creator))) throw new Error("Unresolved Event destination or Session");
          if (creator && eventAgentId !== creator.agentId) throw new Error("Event Agent differs from creator Session");
          const content = `${JSON.stringify({ ...event, agentId: eventAgentId,
            ...(typeof event.chatId === "string" && event.chatId ? { deliveryTarget: { channel, instanceId: botId, chatId: event.chatId } } : {}),
            ...(creator ? { sessionId: creator.targetId } : {}) }, null, 2)}\n`;
          const filename = `${hash(relative(this.root, source)).slice(0, 16)}.json`;
          const target = event.target?.kind === "project" && safePart(event.target.projectId)
            ? join("projects", event.target.projectId, "events", filename)
            : event.managed?.scope === "owner" ? join("system", "bots", "owner", "events", source.split(sep).at(-1)!)
            : join("sessions", eventAgentId, "events", filename);
          files.push({ source: relative(this.root, source), target, sourceDigest: hash(bytes), content, digest: hash(content) });
        } catch (error) {
          this.recordSourceIssue(source, new Error(`Event conflict: ${relative(this.root, source)}: ${(error as Error).message}`));
        }
      }
    for (const old of previous?.files ?? []) {
      if (!old.source) continue;
      if (old.source && (this.isIgnored(join(this.root, old.source)) || this.isGeneratedScratchFile(join(this.root, old.source)))) continue;
      const current = files.find(file => file.source === old.source);
      if ((!current && previous?.phase !== "completed") || (current && current.sourceDigest !== old.sourceDigest)) conflicts.push(`Source changed since preparation: ${old.source}`);
    }
    const skippedTargets = new Set<string>();
    const targetDigests = new Map<string, string>();
    for (const file of files) {
      if (targetDigests.has(file.target) && targetDigests.get(file.target) !== file.digest) { conflicts.push(`Target collision: ${file.target}`); skippedTargets.add(file.target); }
      targetDigests.set(file.target, file.digest);
      const target = join(this.root, file.target);
      try {
        this.checkPath(target);
        if (!previous?.published?.[file.target] && existsSync(target) && hash(readFileSync(target)) !== file.digest) {
          conflicts.push(`Live target conflict: ${file.target}`); skippedTargets.add(file.target);
        }
      } catch (error) { if (!this.force) throw error; skippedTargets.add(file.target); this.recordSourceIssue(target, error); }
    }
    if (this.force) {
      for (let i = files.length - 1; i >= 0; i--) if (skippedTargets.has(files[i].target)) files.splice(i, 1);
    }
    const result = { sessions, routes, files, conflicts: [] as string[], uiConversations };
    if (this.force) this.pruneSkippedSessions(result);
    const completedSources = previous?.phase === "completed" && !this.exclusionsChanged
      && files.every(file => previous.published?.[file.target] === file.digest);
    // After cutover, databases belong to the new runtime, not the legacy ID map.
    if ((!conflicts.length || this.force) && !completedSources) {
      try { migrateStorageReferences(this.root, { version: 1, phase: "prepared", stagingDir: this.stagingDir, sessions: result.sessions, routes: result.routes, files: result.files, ignoredPaths: this.ignoredPaths, botAssignments: this.botAssignments, force: this.force, skippedIssues: this.skippedIssues }, true); }
      catch (error) { conflicts.push(`Persistent reference conflict: ${(error as Error).message}`); }
    }
    conflicts.push(...this.sourceIssues.map(item => item.message));
    if (this.force) this.skippedIssues = [...new Set([...this.skippedIssues, ...conflicts])];
    result.conflicts = [...new Set(conflicts)];
    return result;
  }

  private listFiles(dir: string): string[] {
    if (this.isIgnored(dir)) return [];
    try { this.checkPath(dir); } catch (error) { this.recordSourceIssue(dir, error); return []; }
    if (!existsSync(dir)) return [];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (error) { this.recordSourceIssue(dir, error); return []; }
    return entries.sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const file = join(dir, entry.name);
      if (this.isIgnored(file)) return [];
      if (SCRATCH_GENERATED_DIRECTORIES.has(entry.name) && relative(this.root, dir).split(sep).includes("scratch")) {
        this.automaticSkippedPaths.add(relative(this.root, file));
        return [];
      }
      try { this.checkPath(file); } catch (error) { this.recordSourceIssue(file, error); return []; }
      if (entry.isDirectory()) return this.listFiles(file);
      if (!entry.isFile()) { this.recordSourceIssue(file, new Error(`Not a regular migration file: ${relative(this.root, file)}`)); return []; }
      return [file];
    });
  }

  private treeDigest(dir: string): string {
    return hash(JSON.stringify(this.listFiles(dir).map(file => [relative(dir, file), hash(readFileSync(file))])));
  }

  private copyFile(source: string, target: string): MigratingFile[] {
    try {
      this.checkPath(source);
      const digest = hash(readFileSync(source));
      return [{ source: relative(this.root, source), target, sourceDigest: digest, digest }];
    } catch (error) { if (!this.force) throw error; this.recordSourceIssue(source, error); return []; }
  }

  status(progressOnly = false): MigrationStatus {
    const completed = this.readManifest();
    if (completed?.force && completed.phase === "completed") progressOnly = true;
    if (progressOnly) {
      const manifest = this.readManifest();
      if (manifest) return { skippedIssues: manifest.skippedIssues, needed: manifest.phase !== "completed", sessions: manifest.sessions.length, files: manifest.files.length,
        copiedFiles: manifest.copiedFiles ?? 0, publishedFiles: manifest.files.filter(file => manifest.published?.[file.target]).length,
        conflicts: [], conflictItems: [], ignoredPaths: this.ignoredPaths, botAssignments: this.botAssignments,
        fixedBotAssignments: manifest.botAssignments ?? [], availableAgents: this.ownership.agents.map(id => ({ id, name: this.ownership.agentOptions?.find(agent => agent.id === id)?.name ?? id })),
        automaticSkippedPaths: manifest.automaticSkippedPaths ?? [], phase: manifest.phase };
    }
    const scan = this.scan();
    const previous = this.readManifest();
    const conflictItems = this.describeConflicts(scan.conflicts, scan.files).map(item => {
      if (!item.path && !(item.reason === "missing-bot" && item.channel && item.botId)) return item;
      try {
        migrateStorageReferences(this.root, { version: 1, phase: "prepared", stagingDir: this.stagingDir, sessions: [], routes: [], files: [],
          ignoredPaths: item.path ? [...this.ignoredPaths, item.path] : this.ignoredPaths,
          botAssignments: item.reason === "missing-bot" ? [...this.botAssignments, { channel: item.channel!, botId: item.botId!, agentId: null }] : this.botAssignments }, true);
        return { ...item, canSkip: true };
      } catch (error) {
        return { ...item, canSkip: false, skipBlockedReason: error instanceof Error ? error.message : String(error) };
      }
    });
    const unchanged = !scan.conflicts.length && !this.exclusionsChanged && previous?.phase === "completed" && scan.files.every(file => previous.published?.[file.target] === file.digest);
    return { skippedIssues: this.skippedIssues, needed: this.exclusionsChanged || scan.conflicts.length > 0 || (!unchanged && scan.files.length > 0), sessions: scan.sessions.length,
      files: scan.files.length, copiedFiles: previous?.copiedFiles ?? 0, publishedFiles: scan.files.filter(file => previous?.published?.[file.target]).length,
      conflicts: scan.conflicts,
      conflictItems,
      ignoredPaths: this.ignoredPaths, botAssignments: this.botAssignments, fixedBotAssignments: previous?.botAssignments ?? [], availableAgents: this.ownership.agents.map(id => ({ id, name: this.ownership.agentOptions?.find(agent => agent.id === id)?.name ?? id })), automaticSkippedPaths: [...this.automaticSkippedPaths].sort(), phase: unchanged ? "completed" : previous?.phase === "completed" ? "pending" : previous?.phase ?? "pending" };
  }

  private describeConflicts(conflicts: string[], files: MigratingFile[]): MigrationStatus["conflictItems"] {
    const items: MigrationStatus["conflictItems"] = [];
    const grouped = new Set<string>();
    for (const issue of this.ownershipIssues.filter(item => item.reason === "missing-bot")) {
      const key = JSON.stringify([issue.channel, issue.botId]);
      if (grouped.has(key)) continue;
      grouped.add(key);
      const related = this.ownershipIssues.filter(item => item.reason === "missing-bot" && item.channel === issue.channel && item.botId === issue.botId);
      const details = conflicts.filter(message => related.some(item => message === item.message
        || message.startsWith(`Unresolved Context location: ${item.scope}/contexts/`)
        || message === `Unresolved resource Agent: ${item.scope}`
        || message === `Active Session not found: ${item.scope}/active_session.txt`));
      items.push({ message: `Bot no longer configured: ${issue.channel}/${issue.botId}`, reason: "missing-bot", channel: issue.channel, botId: issue.botId,
        sessionIds: [...new Set(related.map(item => item.sessionId))], details });
    }
    const groupedMessages = new Set(items.flatMap(item => item.details ?? []));
    for (const message of conflicts) {
      if (groupedMessages.has(message)) continue;
      const issue = this.ownershipIssues.find(item => item.message === message);
      const recorded = this.sourceIssues.find(item => item.message === message)?.path;
      const described = message.split(": ").slice(1).join(": ").split(" -> ")[0];
      const live = files.find(item => message.endsWith(item.target));
      const path = recorded ?? (resourceSourcePath(described) ? described : live?.source);
      items.push({ message, ...(path && resourceSourcePath(path) ? { path } : {}), ...(issue ? { reason: issue.reason, channel: issue.channel, botId: issue.botId,
        agentId: issue.agentId, sessionIds: [issue.sessionId] } : {}) });
    }
    return items;
  }

  private pruneSkippedSessions(plan: Pick<AgentStoragePreparation, "sessions" | "files" | "routes" | "uiConversations">): void {
    const missing = plan.sessions.filter(session => !plan.files.some(file =>
      [".json", ".jsonl"].some(suffix => file.target === join("sessions", session.agentId, "contexts", session.targetId + suffix)))
      || !plan.files.some(file => file.target === join("sessions", session.agentId, "contexts", session.targetId + ".meta.json")));
    const ids = new Set(missing.map(session => session.targetId));
    plan.sessions = plan.sessions.filter(session => !ids.has(session.targetId));
    plan.routes = plan.routes.filter(route => !ids.has(route.sessionId));
    plan.uiConversations = plan.uiConversations?.filter(item => !ids.has(item.id));
    plan.files = plan.files.filter(file => !missing.some(session => [".json", ".jsonl", ".meta.json"].some(suffix =>
      file.target === join("sessions", session.agentId, "contexts", session.targetId + suffix))));
  }

  private readManifest(): AgentStoragePreparation | undefined {
    this.checkPath(this.manifestFile);
    if (!existsSync(this.manifestFile)) return undefined;
    let manifest: AgentStoragePreparation;
    try {
      manifest = JSON.parse(readFileSync(this.manifestFile, "utf8"));
      const validRelative = (value: unknown): value is string => typeof value === "string" && !!value
        && !isAbsolute(value) && !value.split(/[\\/]/).some(part => !part || part === "." || part === "..");
      const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
      if (manifest.version !== 1 || !["copying", "prepared", "committing", "completed"].includes(manifest.phase)
        || manifest.stagingDir !== this.stagingDir || !Array.isArray(manifest.sessions) || !Array.isArray(manifest.routes) || !Array.isArray(manifest.files)
        || manifest.sessions.some(item => !safePart(item.agentId) || !safePart(item.targetId)
          || !item.source || !safePart(item.source.sessionId) || ![item.source.channel, item.source.botId, item.source.chatId].every(validRelative))
        || manifest.files.some(file => !validRelative(file.target) || !digest(file.digest)
          || (file.source !== undefined && (!validRelative(file.source) || !digest(file.sourceDigest)))
          || (file.content !== undefined && (typeof file.content !== "string" || hash(file.content) !== file.digest))
          || (file.source === undefined && file.content === undefined))) throw new Error("Invalid shape");
    } catch {
      throw new Error("Invalid migration manifest; preserve staging and reconcile before retrying");
    }
    return manifest;
  }

  private saveManifest(manifest: AgentStoragePreparation): void {
    this.checkPath(this.manifestFile);
    this.checkPath(`${this.manifestFile}.tmp`);
    mkdirSync(this.stagingDir, { recursive: true });
    const temporary = `${this.manifestFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(temporary, this.manifestFile);
  }

  /** Requires the caller to stop affected writers first. Reuses verified copies on retry. */
  private *prepareCopies(): Generator<void, AgentStoragePreparation> {
    const scan = this.scan();
    if (scan.conflicts.length && !this.force) throw new Error(scan.conflicts.join("\n"));
    const manifest: AgentStoragePreparation = { version: 1, phase: "copying", stagingDir: this.stagingDir, sessions: scan.sessions, routes: scan.routes, files: scan.files,
      force: this.force, skippedIssues: this.skippedIssues, copiedFiles: 0, ignoredPaths: this.ignoredPaths, botAssignments: this.botAssignments, automaticSkippedPaths: [...this.automaticSkippedPaths].sort(), uiConversations: scan.uiConversations, published: this.readManifest()?.published ?? {} };
    this.saveManifest(manifest);
    const copied = new Set<MigratingFile>();
    for (const file of manifest.files) {
      const source = file.source ? join(this.root, file.source) : undefined;
      const target = join(this.stagingDir, file.target);
      let sourceBytes: Buffer | undefined;
      try {
        this.checkPath(target);
        if (source) this.checkPath(source);
        sourceBytes = source ? readFileSync(source) : undefined;
        if (sourceBytes && hash(sourceBytes) !== file.sourceDigest) throw new Error(`Source changed during migration: ${file.source}`);
        if (existsSync(target) && hash(readFileSync(target)) !== file.digest) throw new Error(`Staged copy differs: ${file.target}`);
      } catch (error) {
        if (!this.force) throw error;
        manifest.skippedIssues!.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      const bytes = file.content !== undefined ? Buffer.from(file.content) : sourceBytes!;
      if (sourceBytes && hash(sourceBytes) !== file.sourceDigest) throw new Error(`Source changed during migration: ${file.source}`);
      if (existsSync(target)) {
        if (hash(readFileSync(target)) !== file.digest) throw new Error(`Staged copy differs: ${file.target}`);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        const temporary = `${target}.copying`;
        this.checkPath(temporary);
        writeFileSync(temporary, bytes);
        if (hash(readFileSync(temporary)) !== file.digest) throw new Error(`Copy verification failed: ${file.target}`);
        linkSync(temporary, target);
        unlinkSync(temporary);
      }
      if (hash(readFileSync(target)) !== file.digest) throw new Error(`Copy verification failed: ${file.target}`);
      copied.add(file);
      manifest.copiedFiles! += 1;
      // Retries verify every staged file, including files copied after the last checkpoint.
      if (manifest.copiedFiles! % 32 === 0) this.saveManifest(manifest);
      yield;
    }
    if (this.force) {
      manifest.files = manifest.files.filter(file => copied.has(file));
      this.pruneSkippedSessions(manifest);
    }
    manifest.phase = "prepared";
    this.saveManifest(manifest);
    return manifest;
  }
  prepare(): AgentStoragePreparation {
    const copies = this.prepareCopies();
    let step = copies.next();
    while (!step.done) step = copies.next();
    return step.value;
  }

  /** Called only after user confirmation, while Runtime admission and consumers are stopped. */
  async execute(): Promise<AgentStoragePreparation> {
    if (!this.force && !this.status().needed) return this.readManifest() ?? this.prepare();
    const copies = this.prepareCopies();
    let step = copies.next();
    while (!step.done) { await new Promise<void>(resolve => setImmediate(resolve)); step = copies.next(); }
    const manifest = step.value;
    manifest.phase = "committing";
    manifest.published ??= {};
    this.saveManifest(manifest);
    let publishedSinceCheckpoint = 0;
    for (const file of manifest.files) {
      if (manifest.published[file.target]) continue;
      if (file.source && hash(readFileSync(join(this.root, file.source))) !== file.sourceDigest) throw new Error(`Source changed during migration: ${file.source}`);
      const target = join(this.root, file.target);
      this.checkPath(target);
      if (existsSync(target)) {
        if (hash(readFileSync(target)) !== file.digest) throw new Error(`Live target conflict: ${file.target}`);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        const bytes = readFileSync(join(this.stagingDir, file.target));
        if (hash(bytes) !== file.digest) throw new Error(`Staged copy differs: ${file.target}`);
        this.checkPath(`${target}.migration`);
        writeFileSync(`${target}.migration`, bytes);
        linkSync(`${target}.migration`, target);
        unlinkSync(`${target}.migration`);
      }
      manifest.published[file.target] = file.digest;
      if (++publishedSinceCheckpoint === 32) {
        this.saveManifest(manifest);
        publishedSinceCheckpoint = 0;
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    this.saveManifest(manifest);
    for (const route of manifest.routes) {
      const key = `route:${JSON.stringify([route.channel, route.botId, route.chatId])}`;
      if (!manifest.published[key]) { writeActiveRoute(this.root, route, route); manifest.published[key] = "done"; this.saveManifest(manifest); }
    }
    const indexFile = join(this.root, "sessions", "ui-index.json");
    const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { byUserId: {}, byConversationId: {} };
    for (const { externalUserId, id } of manifest.uiConversations ?? []) {
      index.byUserId[externalUserId] = [...new Set([...(index.byUserId[externalUserId] ?? []), id])];
      index.byConversationId[id] ??= { externalUserId };
    }
    mkdirSync(dirname(indexFile), { recursive: true });
    writeFileSync(`${indexFile}.tmp`, JSON.stringify(index, null, 2)); renameSync(`${indexFile}.tmp`, indexFile);
    migrateStorageReferences(this.root, manifest);
    manifest.phase = "completed";
    this.saveManifest(manifest);
    return manifest;
  }

}
