import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { closeSync, existsSync, openSync, readSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AgentStoragePreparation, MigratingSession } from "./agentStorageMigration.js";
import { LEGACY_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";

type RecordValue = Record<string, unknown>;
function sessionFor(id: string, context: RecordValue, sessions: MigratingSession[], preserveAmbiguousHistory = false, skipUnresolved = false): MigratingSession | undefined {
  if (context.project || context.projectId || context.source_project_id || context.roomId || (context.runtimeIdentity as RecordValue | undefined)?.roomId) return undefined;
  const channel = context.channel ?? context.source_channel ?? context.channel_id;
  const bot = context.botId ?? context.instanceId ?? context.instance_id ?? context.bot_id;
  const chat = context.chatId ?? context.scopeId ?? context.chat_id ?? context.scope_id ?? context.source_chat_id;
  const matches = sessions.filter(item => item.source.sessionId === id && (!channel || item.source.channel === channel) && (!bot || item.source.botId === bot) && (!chat || item.source.chatId === chat));
  if (matches.length > 1 && matches.some(item => item.targetId !== id)) {
    if (preserveAmbiguousHistory) return undefined;
    throw new Error(`Ambiguous persistent Session reference: ${id}`);
  }
  if (!matches.length && skipUnresolved && !preserveAmbiguousHistory && !sessions.some(session => session.targetId === id)) {
    throw new Error(`Unresolved persistent Session reference: ${id}`);
  }
  return matches[0];
}
/** Only structured runtime identity fields participate; historical user text is never inspected. */
function skippedBotReference(record: RecordValue, root: string, plan: AgentStoragePreparation, parent: RecordValue = {}): string | undefined {
  const context = { ...parent, ...record };
  if (context.project || context.projectId || context.source_project_id || context.roomId || (context.runtimeIdentity as RecordValue | undefined)?.roomId) return undefined;
  const transport = context.transport as RecordValue | undefined;
  const channel = context.channel ?? context.source_channel ?? context.channel_id ?? transport?.channel;
  const approvalOwner = context.owner as RecordValue | undefined;
  const botId = context.botId ?? context.instanceId ?? context.instance_id ?? context.bot_id ?? transport?.instanceId ?? (approvalOwner?.kind === "bot" ? approvalOwner.id : undefined);
  for (const choice of plan.botAssignments ?? []) {
    if (choice.agentId !== null) continue;
    const owner = LEGACY_CHANNEL_ROOTS.find(item => item.channel === choice.channel)!;
    const source = join(owner.dir, "bots", choice.botId);
    if ((channel === choice.channel && botId === choice.botId) || context.lease_scope === `${choice.channel}:${choice.botId}`) return `${choice.channel}/${choice.botId}`;
    for (const key of ["workspaceDir", "chatDir", "filePath", "storagePath", "eventFile", "event_file"]) {
      if (typeof context[key] !== "string") continue;
      const local = relative(root, resolve(root, context[key] as string));
      if (local === source || local.startsWith(source + sep)) return `${choice.channel}/${choice.botId}`;
    }
  }
  for (const key of ["event", "attachments", "context", "runtimeIdentity", "message", "payload", "checkpoint"]) {
    const value = record[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item && typeof item === "object") {
        const match = skippedBotReference(item as RecordValue, root, plan, context);
        if (match) return match;
      }
    }
  }
  return undefined;
}

/** Updates identity/path fields only; user text, prompts and historical content stay byte-for-byte values. */
export function remapStorageRecord(record: RecordValue, root: string, plan: AgentStoragePreparation, parent: RecordValue = {}, preserveAmbiguousHistory = false): RecordValue {
  const context = { ...parent, ...record };
  const transport = context.transport as RecordValue | undefined;
  if (transport) {
    context.channel ??= transport.channel;
    context.botId ??= transport.instanceId;
    context.chatId ??= transport.chatId;
  }
  if (typeof context.lease_scope === "string") {
    const owner = LEGACY_CHANNEL_ROOTS.find(item => String(context.lease_scope).startsWith(`${item.channel}:`));
    if (owner) { context.channel ??= owner.channel; context.botId ??= context.lease_scope.slice(owner.channel.length + 1); }
  }
  if (typeof context.workspaceDir === "string") {
    const local = relative(root, context.workspaceDir).replaceAll("\\", "/");
    const owner = LEGACY_CHANNEL_ROOTS.find(item => local.startsWith(`${item.dir}/bots/`));
    if (owner) { context.channel ??= owner.channel; context.botId ??= local.split("/")[2]; }
  }
  const result: RecordValue = { ...record };
  const identityKeys = new Set(["sessionId", "contextSessionId", "sourceUiSessionId", "conversationId", "activeSessionId", "restoreSessionId", "returnSessionId", "targetSessionId", "session_id", "context_session_id", "source_ui_session_id", "conversation_id"]);
  const sessionId = [...identityKeys].map(key => context[key]).find(value => typeof value === "string");
  const session = typeof sessionId === "string" ? sessionFor(sessionId, context, plan.sessions, preserveAmbiguousHistory, plan.force) : undefined;
  for (const [key, value] of Object.entries(record)) {
    if (identityKeys.has(key) && typeof value === "string") {
      result[key] = sessionFor(value, context, plan.sessions, preserveAmbiguousHistory, plan.force)?.targetId ?? value;
    } else if (["workspaceDir", "chatDir"].includes(key) && typeof value === "string" && session && !context.project) {
      result[key] = join(root, "sessions", session.agentId);
    } else if (["local", "filePath", "storagePath", "eventFile", "event_file"].includes(key) && typeof value === "string") {
      const local = relative(root, resolve(root, value));
      const owner = LEGACY_CHANNEL_ROOTS.find(item => item.channel === context.channel);
      const botLocal = owner && typeof context.botId === "string" ? join(owner.dir, "bots", context.botId, value) : undefined;
      const chatLocal = owner && typeof context.botId === "string" && typeof context.chatId === "string" ? join(owner.dir, "bots", context.botId, context.chatId, value) : undefined;
      const mapped = plan.files.find(file => file.source !== undefined && [local, botLocal, chatLocal].includes(file.source) && (!session || file.target.startsWith(`sessions/${session.agentId}/`)));
      result[key] = mapped ? join(root, mapped.target) : value;
    } else if (key === "transport" && value && typeof value === "object" && !Array.isArray(value)) {
      const transport = value as RecordValue;
      const channel = LEGACY_CHANNEL_ROOTS.find(item => item.channel === transport.channel);
      result[key] = { ...transport, ...(channel && typeof transport.instanceId === "string" ? { workspaceDir: join(root, "channels", channel.channel, "bots", transport.instanceId) } : {}) };
    } else if (["event", "attachments", "context", "runtimeIdentity", "message", "payload", "checkpoint"].includes(key)) {
      if (Array.isArray(value)) result[key] = value.map(item => item && typeof item === "object" ? remapStorageRecord(item as RecordValue, root, plan, context, preserveAmbiguousHistory) : item);
      else if (value && typeof value === "object") result[key] = remapStorageRecord(value as RecordValue, root, plan, context, preserveAmbiguousHistory);
    }
  }
  return result;
}

/** Per-domain transactions and receipts make a cutover retry safe after process interruption. */
export function migrateStorageReferences(root: string, plan: AgentStoragePreparation, validateOnly = false): void {
  const files: string[] = [];
  for (const directory of [join(root, "db"), join(root, "runtime")]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(sqlite|db)$/.test(entry.name)) continue;
      const file = join(directory, entry.name);
      const header = Buffer.alloc(16);
      const descriptor = openSync(file, "r");
      try { readSync(descriptor, header, 0, header.length, 0); }
      finally { closeSync(descriptor); }
      if (!header.equals(Buffer.from("SQLite format 3\0"))) {
        if (!plan.force && (entry.name.endsWith(".sqlite") || entry.name === "sessions.db")) throw new Error(`Invalid SQLite database: ${relative(root, file)}`);
        if (!plan.force || (!entry.name.endsWith(".sqlite") && entry.name !== "sessions.db")) continue;
      }
      files.push(file);
    }
  }
  const receipt = createHash("sha256").update(JSON.stringify([plan.force, plan.botAssignments, plan.sessions, plan.files.map(file => [file.source, file.target, file.digest])])).digest("hex");
  for (const file of files) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file, { readOnly: validateOnly });
      if (!validateOnly) {
        db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS agent_storage_cutovers (id TEXT PRIMARY KEY)");
        if (plan.force) db.exec("CREATE TABLE IF NOT EXISTS agent_storage_skipped_rows (table_name TEXT, row_key TEXT, record TEXT, error TEXT, PRIMARY KEY(table_name, row_key))");
        if (db.prepare("SELECT id FROM agent_storage_cutovers WHERE id=?").get(receipt)) continue;
        db.exec("BEGIN IMMEDIATE");
      }
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('agent_storage_cutovers', 'agent_storage_skipped_rows')").all() as Array<{ name: string }>;
        for (const { name } of tables) {
          const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
          const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as Array<{ name: string; pk: number }>;
          const jsonColumns = columns.filter(item => ["record", "payload_json", "checkpoint_json", "event_payload_json"].includes(item.name));
          const identityColumns = columns.filter(item => ["session_id", "conversation_id", "context_session_id", "source_ui_session_id"].includes(item.name));
          if (!jsonColumns.length && !identityColumns.length && name !== "event_execution_leases") continue;
          const primary = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk);
          if (!primary.length) throw new Error(`Persistent reference table has no key: ${name}`);
          const rows = db.prepare(`SELECT * FROM ${quote(name)}`).all() as RecordValue[];
          for (const row of rows) {
            try {
              const guardColumns = columns.filter(item => [...jsonColumns.map(column => column.name), "action_json"].includes(item.name));
              const records = guardColumns.flatMap(column => {
                const raw = typeof row[column.name] === "string" ? JSON.parse(row[column.name] as string) : undefined;
                return raw && typeof raw === "object" && !Array.isArray(raw) ? [raw as RecordValue] : [];
              });
              const skipped = skippedBotReference(row, root, plan) ?? records.map(record => skippedBotReference(record, root, plan, row)).find(Boolean);
              if (skipped) {
                const status = String(row.status ?? records.find(record => record.status)?.status ?? "");
                const terminal = ["completed", "failed", "aborted", "skipped", "cancelled", "executed", "rejected", "expired"].includes(status);
                const resolvedApproval = status === "approved" && !String(row.capability ?? "").startsWith("bash:");
                const executionTable = ["inbound_tasks", "runs", "durable_executions", "event_execution_leases", "approvals"].includes(name);
                const deferredRecovery = name === "owners" && records.some(record => record.deferred === true);
                if ((executionTable && ((status && !terminal && !resolvedApproval) || (!status && name === "event_execution_leases"))) || deferredRecovery) {
                  throw new Error(`Cannot skip old Bot ${skipped}: recoverable task ${name}/${String(row.id ?? "")} (${status}) still references its data. Resolve or cancel this task first.`);
                }
                continue;
              }
              const status = String(row.status ?? records.find(record => record.status)?.status ?? "");
              // Legacy history can lack an owner; retaining its ID is safer than guessing a Session.
              // Media and search history do not drive execution recovery.
              const preserveAmbiguousHistory = ["agent_trace_events", "agent_trace_facts", "memory_turn_traces", "memory_profile_snapshots", "image_tasks", "video_tasks",
                "conversation_search_changes", "conversation_search_documents", "conversation_search_tombstones"].includes(name)
                || (["runs", "approvals", "approval_requests"].includes(name)
                  && ["completed", "failed", "aborted", "skipped", "cancelled", "executed", "rejected", "expired"].includes(status));
              const remap = (record: RecordValue, parent: RecordValue = {}) => {
                try { return remapStorageRecord(record, root, plan, parent, preserveAmbiguousHistory); }
                catch (error) {
                  throw new Error(`${(error as Error).message} [${relative(root, file)}:${name}, key=${primary.map(column => String(row[column.name])).join(",")}, status=${status || "unset"}]`);
                }
              };
              const mapped = remap(row);
              for (const column of jsonColumns) {
                if (typeof row[column.name] !== "string") continue;
                const raw = JSON.parse(row[column.name] as string);
                if (raw && typeof raw === "object" && !Array.isArray(raw)) mapped[column.name] = JSON.stringify(remap(raw, row));
              }
              if (name === "event_execution_leases" && typeof row.event_file === "string") {
                const scope = String(row.lease_scope ?? "");
                const owner = LEGACY_CHANNEL_ROOTS.find(item => scope.startsWith(`${item.channel}:`));
                const botId = owner ? scope.slice(owner.channel.length + 1) : undefined;
                const source = owner && botId
                  ? join(owner.dir, "bots", botId, "events", row.event_file)
                  : relative(root, resolve(root, row.event_file));
                const ignored = plan.ignoredPaths?.some(path => source === path || source.startsWith(path + "/"));
                if (ignored && !["completed", "failed", "aborted", "skipped"].includes(String(row.status ?? ""))) {
                  throw new Error(`Event still referenced by a recoverable execution lease: ${source}`);
                }
                const event = plan.files.find(item => item.source === source && item.target.includes("/events/"));
                if (plan.force && owner && !event && !["completed", "failed", "aborted", "skipped"].includes(String(row.status ?? ""))) {
                  throw new Error(`Unresolved migrated Event: ${source}`);
                }
                if (event?.content) {
                  const content = JSON.parse(event.content);
                  mapped.event_file = basename(event.target);
                  mapped.lease_scope = content.agentId && event.target.startsWith("sessions/") ? `agent:${content.agentId}` : row.lease_scope;
                  mapped.event_payload_json = event.content;
                }
              }
              const changed = Object.keys(mapped).filter(key => mapped[key] !== row[key]);
              if (!changed.length || validateOnly) continue;
              db.prepare(`UPDATE ${quote(name)} SET ${changed.map(key => `${quote(key)}=?`).join(",")} WHERE ${primary.map(key => `${quote(key.name)}=?`).join(" AND ")}`).run(...changed.map(key => mapped[key] as SQLInputValue), ...primary.map(key => row[key.name] as SQLInputValue));
            } catch (error) {
              if (!plan.force) throw error;
              const key = JSON.stringify(primary.map(column => row[column.name]));
              const message = `${relative(root, file)}:${name}, key=${key}: ${error instanceof Error ? error.message : String(error)}`;
              plan.skippedIssues ??= [];
              if (!plan.skippedIssues.includes(message)) plan.skippedIssues.push(message);
              if (!validateOnly) {
                // Quarantine and removal share the cutover transaction; unresolved tasks cannot resume.
                db.prepare("INSERT OR REPLACE INTO agent_storage_skipped_rows(table_name,row_key,record,error) VALUES (?,?,?,?)")
                  .run(name, key, JSON.stringify(row, (_key, value) => typeof value === "bigint" ? String(value) : value), message);
                db.prepare(`DELETE FROM ${quote(name)} WHERE ${primary.map(column => `${quote(column.name)}=?`).join(" AND ")}`)
                  .run(...primary.map(column => row[column.name] as SQLInputValue));
              }
            }
          }
        }
        if (!validateOnly) { db.prepare("INSERT INTO agent_storage_cutovers(id) VALUES (?)").run(receipt); db.exec("COMMIT"); }
      } catch (error) { if (!validateOnly) db.exec("ROLLBACK"); throw error; }
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { errcode?: number };
      // Locks, access failures and full disks cannot be repaired by discarding a database.
      if (!plan.force || ["EACCES", "EPERM", "ENOSPC", "EIO"].includes(failure.code ?? "")
        || [5, 6, 8, 10, 13, 14].includes((failure.errcode ?? 0) & 255)) throw error;
      const message = `${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`;
      plan.skippedIssues ??= [];
      if (!plan.skippedIssues.includes(message)) plan.skippedIssues.push(message);
      if (!validateOnly) {
        db?.close(); db = undefined;
        const backup = join(plan.stagingDir, "skipped-databases", randomUUID(), relative(root, file));
        mkdirSync(dirname(backup), { recursive: true });
        // Keep the database and SQLite sidecars together for manual recovery.
        for (const suffix of ["", "-wal", "-shm"]) {
          if (existsSync(file + suffix)) renameSync(file + suffix, backup + suffix);
        }
        plan.skippedIssues.push(`Database preserved at: ${relative(root, backup)}`);
      }
    } finally { db?.close(); }
  }
}
