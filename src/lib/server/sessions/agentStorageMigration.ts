import { createHash } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";

export interface MigrationBot {
  channel: string;
  botId: string;
  agentId?: string;
}

export interface MigrationOwnership {
  /** Includes disabled Agents: migration preserves history without admitting execution. */
  agents: string[];
  bots: MigrationBot[];
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
  phase: "copying" | "prepared";
  stagingDir: string;
  sessions: MigratingSession[];
  routes: MigratingRoute[];
  files: MigratingFile[];
}

export interface MigrationStatus {
  needed: boolean;
  sessions: number;
  conflicts: string[];
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function directories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some(entry => entry.isSymbolicLink())) throw new Error(`Symbolic link in migration directory: ${dir}`);
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
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

  constructor(dataRoot: string, private readonly ownership: MigrationOwnership) {
    this.root = resolve(dataRoot);
    this.stagingDir = join(this.root, "runtime", "agent-storage-migration");
    this.manifestFile = join(this.stagingDir, "manifest.json");
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

  private scan(): { sessions: MigratingSession[]; routes: MigratingRoute[]; files: MigratingFile[]; conflicts: string[] } {
    const previous = this.readManifest();
    const sessions: MigratingSession[] = [];
    const routes: MigratingRoute[] = [];
    const files: MigratingFile[] = [];
    const conflicts: string[] = [];
    const chatScopes: Array<{ chatDir: string; agentId?: string }> = [];
    const botScopes: Array<{ channel: string; botId: string; botDir: string; agentId?: string }> = [];
    const used = new Set(previous?.sessions.map(s => `${s.agentId}/${s.targetId}`));
    for (const agentId of this.ownership.agents) {
      if (!safePart(agentId)) throw new Error(`Invalid Agent ID: ${agentId}`);
      const contexts = join(this.root, "sessions", agentId, "contexts");
      this.checkPath(contexts);
      if (existsSync(contexts)) {
        for (const file of readdirSync(contexts)) used.add(`${agentId}/${file.replace(/\.(?:meta\.)?jsonl?$/, "")}`);
      }
    }
    for (const { channel, dir } of TASK_CHANNEL_ROOTS) {
      const bots = join(this.root, dir, "bots");
      this.checkPath(bots);
      for (const botId of directories(bots)) {
        const bot = this.ownership.bots.find(item => item.channel === channel && item.botId === botId);
        const botDir = join(bots, botId);
        botScopes.push({ channel, botId, botDir, agentId: bot ? bot.agentId || "default" : undefined });
        for (const chatId of directories(botDir)) {
          if (["skills", "events"].includes(chatId)) continue;
          chatScopes.push({ chatDir: join(botDir, chatId), agentId: bot ? bot.agentId || "default" : undefined });
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
            const agentId = pinned ?? (bot ? bot.agentId || "default" : undefined);
            if (!agentId || !this.ownership.agents.includes(agentId)) {
              conflicts.push(`Unresolved Agent: ${relative(this.root, join(contexts, sessionId))}`);
              continue;
            }
            const identity = JSON.stringify(source);
            const saved = previous?.sessions.find(item => JSON.stringify(item.source) === identity);
            if (saved && saved.agentId !== agentId) {
              conflicts.push(`Agent ownership changed: ${identity}`);
              continue;
            }
            let targetId = saved?.targetId ?? sessionId;
            if (!saved && used.has(`${agentId}/${targetId}`)) targetId = `${sessionId}-${hash(identity).slice(0, 16)}`;
            if (!saved && used.has(`${agentId}/${targetId}`)) {
              conflicts.push(`Target Session already exists: ${agentId}/${targetId}`);
              continue;
            }
            used.add(`${agentId}/${targetId}`);
            sessions.push({ source, agentId, targetId });
            for (const suffix of [".json", ".jsonl"]) {
              const file = sessionId === "default" && suffix === ".json" && existsSync(legacyContext)
                && !existsSync(join(contexts, "default.json")) ? legacyContext : join(contexts, `${sessionId}${suffix}`);
              this.checkPath(file);
              if (!existsSync(file)) continue;
              if (!lstatSync(file).isFile()) { conflicts.push(`Not a regular file: ${relative(this.root, file)}`); continue; }
              files.push(this.copyFile(file, join("sessions", agentId, "contexts", `${targetId}${suffix}`)));
            }
            const content = `${JSON.stringify({ ...metadata, agentId, source }, null, 2)}\n`;
            files.push({
              ...(existsSync(metaFile) ? { source: relative(this.root, metaFile), sourceDigest: hash(readFileSync(metaFile)) } : {}),
              target: join("sessions", agentId, "contexts", `${targetId}.meta.json`),
              digest: hash(content), content
            });
          }
        }
      }
    }
    const scopes = new Map<string, MigratingSession[]>();
    for (const session of sessions) {
      const source = session.source;
      const channelRoot = TASK_CHANNEL_ROOTS.find(item => item.channel === source.channel)!;
      const chatDir = join(this.root, channelRoot.dir, "bots", source.botId, source.chatId);
      scopes.set(chatDir, [...(scopes.get(chatDir) ?? []), session]);
    }
    for (const { chatDir } of chatScopes) {
      if (!scopes.has(chatDir)) scopes.set(chatDir, []);
    }
    for (const [chatDir, scopeSessions] of scopes) {
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
            files.push(this.copyFile(source, target));
          }
        }
        for (const history of histories) {
          files.push(this.copyFile(history, join("sessions", agentId, "run-history", namespace, relative(chatDir, history))));
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
          files.push({ source: relative(this.root, activeFile), sourceDigest: hash(bytes), target: join("routes", `${namespace}.json`),
            content: `${JSON.stringify(routes[routes.length - 1])}\n`, digest: hash(`${JSON.stringify(routes[routes.length - 1])}\n`) });
        }
      }
    }
    const skills = new Map<string, string>();
    for (const { channel, botId, botDir, agentId } of botScopes) {
      const skillsRoot = join(botDir, "skills");
      this.checkPath(skillsRoot);
      for (const skill of directories(skillsRoot)) {
        const skillDir = join(skillsRoot, skill);
        const sources = this.listFiles(skillDir);
        if (!agentId || !this.ownership.agents.includes(agentId)) {
          conflicts.push(`Unresolved Skill Agent: ${relative(this.root, skillDir)}`);
          continue;
        }
        const targetDir = join("sessions", agentId, "skills", skill);
        const signature = this.treeDigest(skillDir);
        const liveDir = join(this.root, targetDir);
        this.checkPath(liveDir);
        const existing = skills.get(targetDir) ?? (existsSync(liveDir) ? this.treeDigest(liveDir) : undefined);
        if (existing !== undefined && existing !== signature) {
          conflicts.push(`Skill conflict: ${relative(this.root, skillDir)} -> ${targetDir}`);
          continue;
        }
        skills.set(targetDir, signature);
        for (const source of sources) files.push(this.copyFile(source, join(targetDir, relative(skillDir, source))));
      }
      for (const source of this.listFiles(join(botDir, "events"))) {
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
          const eventAgentId = event.agentId ?? creator?.agentId ?? agentId;
          if (!eventAgentId || !this.ownership.agents.includes(eventAgentId)) throw new Error("Unresolved Event Agent");
          const ordinary = event.execution !== "internal" && event.target?.kind !== "project";
          if (ordinary && (typeof event.chatId !== "string" || !event.chatId || (event.sessionId && !creator))) throw new Error("Unresolved Event destination or Session");
          if (creator && eventAgentId !== creator.agentId) throw new Error("Event Agent differs from creator Session");
          const content = `${JSON.stringify({ ...event, agentId: eventAgentId,
            ...(ordinary ? { deliveryTarget: { channel, instanceId: botId, chatId: event.chatId } } : {}),
            ...(creator ? { sessionId: creator.targetId } : {}) }, null, 2)}\n`;
          const target = join("sessions", eventAgentId, "events", `${hash(relative(this.root, source)).slice(0, 16)}.json`);
          files.push({ source: relative(this.root, source), target, sourceDigest: hash(bytes), content, digest: hash(content) });
        } catch (error) {
          conflicts.push(`Event conflict: ${relative(this.root, source)}: ${(error as Error).message}`);
        }
      }
    }
    const coveredSources = new Set(files.flatMap(file => file.source ? [file.source] : []));
    for (const { dir } of TASK_CHANNEL_ROOTS) {
      for (const source of this.listFiles(join(this.root, dir))) {
        const local = relative(this.root, source);
        if (!coveredSources.has(local)) conflicts.push(`Unsupported legacy file: ${local}`);
      }
    }
    for (const old of previous?.files ?? []) {
      if (!old.source) continue;
      const current = files.find(file => file.source === old.source);
      if (!current || current.sourceDigest !== old.sourceDigest) conflicts.push(`Source changed since preparation: ${old.source}`);
    }
    return { sessions, routes, files, conflicts };
  }

  private listFiles(dir: string): string[] {
    this.checkPath(dir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const file = join(dir, entry.name);
      this.checkPath(file);
      if (entry.isDirectory()) return this.listFiles(file);
      if (!entry.isFile()) throw new Error(`Not a regular migration file: ${relative(this.root, file)}`);
      return [file];
    });
  }

  private treeDigest(dir: string): string {
    return hash(JSON.stringify(this.listFiles(dir).map(file => [relative(dir, file), hash(readFileSync(file))])));
  }

  private copyFile(source: string, target: string): MigratingFile {
    this.checkPath(source);
    const digest = hash(readFileSync(source));
    return { source: relative(this.root, source), target, sourceDigest: digest, digest };
  }

  status(): MigrationStatus {
    const scan = this.scan();
    return { needed: scan.files.length > 0 || scan.conflicts.length > 0, sessions: scan.sessions.length, conflicts: scan.conflicts };
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
      if (manifest.version !== 1 || !["copying", "prepared"].includes(manifest.phase)
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
  prepare(): AgentStoragePreparation {
    const scan = this.scan();
    if (scan.conflicts.length) throw new Error(scan.conflicts.join("\n"));
    const manifest: AgentStoragePreparation = { version: 1, phase: "copying", stagingDir: this.stagingDir, sessions: scan.sessions, routes: scan.routes, files: scan.files };
    this.saveManifest(manifest);
    for (const file of manifest.files) {
      const source = file.source ? join(this.root, file.source) : undefined;
      const target = join(this.stagingDir, file.target);
      this.checkPath(target);
      if (source) this.checkPath(source);
      const sourceBytes = source ? readFileSync(source) : undefined;
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
    }
    manifest.phase = "prepared";
    this.saveManifest(manifest);
    return manifest;
  }
}
