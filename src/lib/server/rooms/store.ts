import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir } from "$lib/server/infra/db/storage.js";
import type { AgentRoom, RoomSession, RoomDispatch, RoomEvent, RoomExecution, RoomExecutionStatus, RoomMessage, RoomSubmission } from "$lib/shared/rooms.js";

type Row = Record<string, string | number | null>;
const json = <T>(value: Row, key: string): T => JSON.parse(String(value[key]));

/** Room scheduling and transcript ownership live in the Session-owned database. */
export class RoomStore {
  private db: DatabaseSync;
  constructor(file: string) {
    ensureSqliteParentDir(file);
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000");
    const hasRoomContexts = (this.db.prepare("PRAGMA table_info(room_participants)").all() as Row[])
      .some(column => column.name === "context_id");
    if (hasRoomContexts) this.db.prepare("VACUUM INTO ?").run(`${file}.backup-${Date.now()}-${randomUUID()}`);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS agent_rooms (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, primary_agent_id TEXT NOT NULL,
        project_id TEXT, permission_mode TEXT, created_at TEXT NOT NULL,
        writer_execution_id TEXT, generation INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS room_participants (
        room_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        active INTEGER NOT NULL, PRIMARY KEY(room_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS room_sessions (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_session_contexts (
        session_id TEXT NOT NULL, agent_id TEXT NOT NULL, context_id TEXT NOT NULL,
        PRIMARY KEY(session_id, agent_id), UNIQUE(context_id)
      );
      CREATE TABLE IF NOT EXISTS room_dispatches (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, session_id TEXT NOT NULL, submission_id TEXT NOT NULL,
        input_json TEXT NOT NULL, UNIQUE(room_id, submission_id)
      );
      CREATE TABLE IF NOT EXISTS room_resume_submissions (
        room_id TEXT NOT NULL, submission_id TEXT NOT NULL, execution_id TEXT NOT NULL,
        dispatch_id TEXT NOT NULL, PRIMARY KEY(room_id, submission_id)
      );
      CREATE TABLE IF NOT EXISTS room_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
        author_agent_id TEXT, author_name TEXT, dispatch_id TEXT NOT NULL,
        execution_id TEXT UNIQUE, reply_to_id TEXT, retention TEXT NOT NULL,
        created_at TEXT NOT NULL, attachments_json TEXT NOT NULL, activities_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS room_messages_room ON room_messages(room_id, sequence);
      CREATE TABLE IF NOT EXISTS room_executions (
        ordering INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL, dispatch_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        context_id TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL,
        text TEXT NOT NULL, snapshot_json TEXT NOT NULL, retention TEXT NOT NULL,
        retry_of TEXT, approval_id TEXT, approval_json TEXT, error TEXT, partial_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS room_execution_queue ON room_executions(room_id, status, ordering);
      CREATE TABLE IF NOT EXISTS room_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, dispatch_id TEXT,
        agent_id TEXT, execution_id TEXT, type TEXT NOT NULL, payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_context_runs (execution_id TEXT PRIMARY KEY, run_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_files (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_operations (
        execution_id TEXT NOT NULL, operation_id TEXT NOT NULL, status TEXT NOT NULL,
        description TEXT NOT NULL, PRIMARY KEY(execution_id, operation_id)
      );
    `);
    if (hasRoomContexts) this.upgradeRoomSessions();
  }
  close() { this.db.close(); }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** Converts room-scoped chats to their first Session without changing Context ids. */
  private upgradeRoomSessions() {
    this.transaction(() => {
      this.db.exec(`
        INSERT INTO room_sessions(id,room_id,title,created_at)
          SELECT id,id,title,created_at FROM agent_rooms;
        INSERT INTO room_session_contexts(session_id,agent_id,context_id)
          SELECT room_id,agent_id,context_id FROM room_participants;
        ALTER TABLE room_participants DROP COLUMN context_id;
        ALTER TABLE room_dispatches RENAME TO room_dispatches_before_sessions;
        CREATE TABLE room_dispatches (
          id TEXT PRIMARY KEY, room_id TEXT NOT NULL, session_id TEXT NOT NULL,
          submission_id TEXT NOT NULL, input_json TEXT NOT NULL, UNIQUE(room_id, submission_id)
        );
        INSERT INTO room_dispatches(id,room_id,session_id,submission_id,input_json)
          SELECT id,room_id,room_id,submission_id,input_json FROM room_dispatches_before_sessions;
        DROP TABLE room_dispatches_before_sessions;
      `);
      for (const execution of this.db.prepare("SELECT id,room_id,snapshot_json FROM room_executions").all() as Row[]) {
        const snapshot = json<RoomMessage[]>(execution, "snapshot_json").map(message => ({ ...message, sessionId: String(execution.room_id) }));
        this.db.prepare("UPDATE room_executions SET snapshot_json=? WHERE id=?").run(JSON.stringify(snapshot), String(execution.id));
      }
    });
  }
  create(room: AgentRoom) {
    this.transaction(() => {
      this.db.prepare("INSERT INTO agent_rooms(id,title,primary_agent_id,project_id,permission_mode,created_at) VALUES(?,?,?,?,?,?)")
        .run(room.id, room.title, room.primaryAgentId, room.projectId ?? null, room.permissionMode ?? null, room.createdAt);
      for (const p of room.participants) this.db.prepare("INSERT INTO room_participants VALUES(?,?,?)").run(room.id, p.agentId, Number(p.active));
    });
  }
  get(id: string): AgentRoom | null {
    const r = this.db.prepare("SELECT * FROM agent_rooms WHERE id=?").get(id) as Row | undefined;
    if (!r) return null;
    const participants = (this.db.prepare("SELECT * FROM room_participants WHERE room_id=? ORDER BY rowid").all(id) as Row[])
      .map(p => ({ agentId: String(p.agent_id), active: Boolean(p.active) }));
    return { id, title: String(r.title), primaryAgentId: String(r.primary_agent_id), projectId: r.project_id ? String(r.project_id) : undefined,
      permissionMode: r.permission_mode as AgentRoom["permissionMode"] ?? undefined, participants, createdAt: String(r.created_at) };
  }
  list(): AgentRoom[] {
    return (this.db.prepare("SELECT id FROM agent_rooms ORDER BY created_at DESC").all() as Row[]).map(r => this.get(String(r.id))!);
  }
  update(room: AgentRoom) {
    this.transaction(() => {
      this.db.prepare("UPDATE agent_rooms SET title=?,primary_agent_id=?,permission_mode=? WHERE id=?")
        .run(room.title, room.primaryAgentId, room.permissionMode ?? null, room.id);
      for (const p of room.participants) this.db.prepare(`INSERT INTO room_participants VALUES(?,?,?) ON CONFLICT(room_id,agent_id) DO UPDATE SET active=excluded.active`)
        .run(room.id, p.agentId, Number(p.active));
    });
  }
  addSession(session: RoomSession) {
    this.transaction(() => {
      this.db.prepare("INSERT INTO room_sessions VALUES(?,?,?,?)").run(session.id, session.roomId, session.title, session.createdAt);
      for (const context of session.contexts) this.db.prepare("INSERT INTO room_session_contexts VALUES(?,?,?)")
        .run(session.id, context.agentId, context.contextId);
    });
  }
  sessions(roomId: string): RoomSession[] {
    return (this.db.prepare("SELECT * FROM room_sessions WHERE room_id=? ORDER BY rowid DESC").all(roomId) as Row[]).map(r => ({
      id: String(r.id), roomId, title: String(r.title), createdAt: String(r.created_at),
      contexts: (this.db.prepare("SELECT * FROM room_session_contexts WHERE session_id=? ORDER BY rowid").all(String(r.id)) as Row[])
        .map(c => ({ agentId: String(c.agent_id), contextId: String(c.context_id) }))
    }));
  }
  sessionRoomId(sessionId: string): string | undefined {
    const row = this.db.prepare("SELECT room_id FROM room_sessions WHERE id=?").get(sessionId) as Row | undefined;
    return row ? String(row.room_id) : undefined;
  }
  nameSession(id: string, title: string) {
    this.db.prepare("UPDATE room_sessions SET title=? WHERE id=? AND title=''").run(title, id);
  }
  ensureSessionContexts(room: AgentRoom) {
    for (const session of this.sessions(room.id)) for (const participant of room.participants) {
      this.db.prepare("INSERT OR IGNORE INTO room_session_contexts VALUES(?,?,?)").run(session.id, participant.agentId, randomUUID());
    }
  }
  dispatch(roomId: string, submissionId: string): { dispatch: RoomDispatch; input: RoomSubmission } | null {
    const r = this.db.prepare("SELECT * FROM room_dispatches WHERE room_id=? AND submission_id=?").get(roomId, submissionId) as Row | undefined;
    return r ? { dispatch: { id: String(r.id), roomId, sessionId: String(r.session_id), submissionId }, input: json(r, "input_json") } : null;
  }
  dispatchesInput(id: string): RoomSubmission | null {
    const r = this.db.prepare("SELECT input_json FROM room_dispatches WHERE id=?").get(id) as Row | undefined;
    return r ? json(r, "input_json") : null;
  }
  resumeSubmission(roomId: string, submissionId: string): { executionId: string; dispatch: RoomDispatch } | null {
    const r = this.db.prepare("SELECT r.execution_id,r.dispatch_id,d.session_id FROM room_resume_submissions r JOIN room_dispatches d ON d.id=r.dispatch_id WHERE r.room_id=? AND r.submission_id=?").get(roomId, submissionId) as Row | undefined;
    return r ? { executionId: String(r.execution_id), dispatch: { id: String(r.dispatch_id), roomId, sessionId: String(r.session_id), submissionId } } : null;
  }
  addResumeSubmission(dispatch: RoomDispatch, executionId: string) {
    this.db.prepare("INSERT INTO room_resume_submissions VALUES(?,?,?,?)").run(dispatch.roomId, dispatch.submissionId, executionId, dispatch.id);
  }
  addDispatch(d: RoomDispatch, input: RoomSubmission) {
    this.db.prepare("INSERT INTO room_dispatches(id,room_id,session_id,submission_id,input_json) VALUES(?,?,?,?,?)").run(d.id, d.roomId, d.sessionId, d.submissionId, JSON.stringify(input));
  }
  addMessage(m: Omit<RoomMessage, "sequence" | "sessionId">) {
    this.db.prepare(`INSERT INTO room_messages(id,room_id,role,content,author_agent_id,author_name,dispatch_id,execution_id,reply_to_id,retention,created_at,attachments_json,activities_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.id, m.roomId, m.role, m.content, m.authorAgentId ?? null, m.authorName ?? null,
      m.dispatchId, m.executionId ?? null, m.replyToId ?? null, m.retention, m.createdAt, JSON.stringify(m.attachments ?? []), JSON.stringify(m.activities ?? []));
  }
  messages(roomId: string, sessionId?: string): RoomMessage[] {
    return (this.db.prepare("SELECT m.*,d.session_id FROM room_messages m JOIN room_dispatches d ON d.id=m.dispatch_id WHERE m.room_id=? AND (? IS NULL OR d.session_id=?) ORDER BY m.sequence").all(roomId, sessionId ?? null, sessionId ?? null) as Row[]).map(r => ({
      id: String(r.id), roomId, sessionId: String(r.session_id), sequence: Number(r.sequence), role: r.role as RoomMessage["role"], content: String(r.content),
      authorAgentId: r.author_agent_id as string ?? undefined, authorName: r.author_name as string ?? undefined,
      dispatchId: String(r.dispatch_id), executionId: r.execution_id as string ?? undefined, replyToId: r.reply_to_id as string ?? undefined,
      retention: r.retention as RoomMessage["retention"], createdAt: String(r.created_at), attachments: json(r, "attachments_json"), activities: json(r, "activities_json")
    }));
  }
  addExecution(e: Omit<RoomExecution, "order" | "sessionId">) {
    this.db.prepare(`INSERT INTO room_executions(id,room_id,dispatch_id,agent_id,context_id,status,mode,text,snapshot_json,retention,retry_of,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.id, e.roomId, e.dispatchId, e.agentId, e.contextId, e.status, e.mode, e.text, JSON.stringify(e.snapshot), e.retention, e.retryOf ?? null, e.createdAt);
  }
  executions(roomId: string, sessionId?: string): RoomExecution[] {
    return (this.db.prepare("SELECT e.*,d.session_id FROM room_executions e JOIN room_dispatches d ON d.id=e.dispatch_id WHERE e.room_id=? AND (? IS NULL OR d.session_id=?) ORDER BY e.ordering").all(roomId, sessionId ?? null, sessionId ?? null) as Row[]).map(r => ({
      id: String(r.id), roomId, sessionId: String(r.session_id), dispatchId: String(r.dispatch_id), agentId: String(r.agent_id), contextId: String(r.context_id),
      status: r.status as RoomExecutionStatus, mode: r.mode as RoomExecution["mode"], text: String(r.text), snapshot: json(r, "snapshot_json"),
      retention: r.retention as RoomExecution["retention"], order: Number(r.ordering), retryOf: r.retry_of as string ?? undefined,
      approvalId: r.approval_id as string ?? undefined, approval: r.approval_json ? json(r, "approval_json") : undefined, error: r.error as string ?? undefined, partialText: String(r.partial_text), createdAt: String(r.created_at)
    }));
  }
  state(id: string, status: RoomExecutionStatus, error?: string, approvalId?: string) {
    this.db.prepare("UPDATE room_executions SET status=?,error=?,approval_id=? WHERE id=?").run(status, error ?? null, approvalId ?? null, id);
  }
  approval(id: string, presentation: RoomExecution["approval"]) {
    this.db.prepare("UPDATE room_executions SET approval_json=? WHERE id=?").run(JSON.stringify(presentation ?? null), id);
  }
  approvalExecution(approvalId: string): RoomExecution | undefined {
    const r = this.db.prepare("SELECT room_id,id FROM room_executions WHERE approval_id=?").get(approvalId) as Row | undefined;
    return r ? this.executions(String(r.room_id)).find(e => e.id === r.id) : undefined;
  }
  retention(id: string, policy: RoomMessage["retention"]) { this.db.prepare("UPDATE room_executions SET retention=? WHERE id=?").run(policy, id); }
  partial(id: string, text: string) { this.db.prepare("UPDATE room_executions SET partial_text=? WHERE id=?").run(text, id); }
  /** Claim and publish running state in the same transaction; a paused entry cannot reserve a slot. */
  claim(e: RoomExecution): boolean {
    return this.transaction(() => {
      const current = this.executions(e.roomId).find(x => x.id === e.id);
      if (current?.status !== "queued") return false;
      const active = this.executions(e.roomId).filter(x => ["running", "waiting_approval", "cancelling"].includes(x.status));
      if (active.some(x => x.contextId === e.contextId)) return false;
      if (e.mode === "direct") {
        const changed = this.db.prepare("UPDATE agent_rooms SET writer_execution_id=?,generation=generation+1 WHERE id=? AND writer_execution_id IS NULL").run(e.id, e.roomId);
        if (!changed.changes) return false;
      }
      this.state(e.id, "running");
      return true;
    });
  }
  release(e: RoomExecution) {
    this.db.prepare("UPDATE agent_rooms SET writer_execution_id=NULL WHERE id=? AND writer_execution_id=?").run(e.roomId, e.id);
  }
  event(event: Omit<RoomEvent, "sequence">) {
    const r = this.db.prepare("INSERT INTO room_events(room_id,dispatch_id,agent_id,execution_id,type,payload_json) VALUES(?,?,?,?,?,?)")
      .run(event.roomId, event.dispatchId ?? null, event.agentId ?? null, event.executionId ?? null, event.type, JSON.stringify(event.payload));
    return { ...event, sequence: Number(r.lastInsertRowid) };
  }
  events(roomId: string, after = 0): RoomEvent[] {
    return (this.db.prepare("SELECT e.*,d.session_id FROM room_events e LEFT JOIN room_dispatches d ON d.id=e.dispatch_id WHERE e.room_id=? AND e.sequence>? ORDER BY e.sequence").all(roomId, after) as Row[]).map(r => ({
      sequence: Number(r.sequence), roomId, sessionId: r.session_id as string ?? undefined, dispatchId: r.dispatch_id as string ?? undefined, agentId: r.agent_id as string ?? undefined,
      executionId: r.execution_id as string ?? undefined, type: r.type as RoomEvent["type"], payload: json(r, "payload_json")
    }));
  }
  operation(executionId: string, operationId: string, status: "unknown" | "completed" | "failed", description: string) {
    this.db.prepare(`INSERT INTO room_operations VALUES(?,?,?,?) ON CONFLICT(execution_id,operation_id) DO UPDATE SET status=excluded.status,description=excluded.description`)
      .run(executionId, operationId, status, description);
  }
  saveFile(id: string, roomId: string, metadata: import("$lib/shared/types/message.js").ConversationAttachment) {
    this.db.prepare("INSERT INTO room_files VALUES(?,?,?)").run(id, roomId, JSON.stringify(metadata));
  }
  files(roomId: string, ids: string[]): import("$lib/shared/types/message.js").ConversationAttachment[] {
    return ids.map(id => {
      const r = this.db.prepare("SELECT metadata_json FROM room_files WHERE room_id=? AND id=?").get(roomId, id) as Row | undefined;
      if (!r) throw new Error("Room attachment unavailable");
      return json(r, "metadata_json");
    });
  }
  contextRun(executionId: string): string | undefined {
    const row = this.db.prepare("SELECT run_id FROM room_context_runs WHERE execution_id=?").get(executionId) as Row | undefined;
    return row ? String(row.run_id) : undefined;
  }
  recordContextRun(executionId: string, runId: string) {
    this.db.prepare("INSERT INTO room_context_runs VALUES(?,?)").run(executionId, runId);
  }
  contextSourceDispatches(roomId: string, contextId: string, presentRunIds: Set<string>): Set<string> {
    const rows = this.db.prepare("SELECT e.dispatch_id,r.run_id FROM room_executions e JOIN room_context_runs r ON e.id=r.execution_id WHERE e.room_id=? AND e.context_id=?").all(roomId, contextId) as Row[];
    return new Set(rows.filter(r => presentRunIds.has(String(r.run_id))).map(r => String(r.dispatch_id)));
  }
  fileByLocal(roomId: string, local: string): import("$lib/shared/types/message.js").ConversationAttachment | undefined {
    return (this.db.prepare("SELECT metadata_json FROM room_files WHERE room_id=?").all(roomId) as Row[])
      .map(r => json<import("$lib/shared/types/message.js").ConversationAttachment>(r, "metadata_json")).find(a => a.local === local);
  }
  operations(executionId: string) {
    return (this.db.prepare("SELECT * FROM room_operations WHERE execution_id=?").all(executionId) as Row[])
      .map(r => ({ id: String(r.operation_id), status: String(r.status), description: String(r.description) }));
  }
  purgeSession(sessionId: string) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM room_context_runs WHERE execution_id IN (SELECT e.id FROM room_executions e JOIN room_dispatches d ON d.id=e.dispatch_id WHERE d.session_id=?)").run(sessionId);
      this.db.prepare("DELETE FROM room_operations WHERE execution_id IN (SELECT e.id FROM room_executions e JOIN room_dispatches d ON d.id=e.dispatch_id WHERE d.session_id=?)").run(sessionId);
      for (const table of ["room_executions", "room_messages", "room_events", "room_resume_submissions"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE dispatch_id IN (SELECT id FROM room_dispatches WHERE session_id=?)`).run(sessionId);
      }
      this.db.prepare("DELETE FROM room_dispatches WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM room_session_contexts WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM room_sessions WHERE id=?").run(sessionId);
    });
  }
  purge(roomId: string) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM room_context_runs WHERE execution_id IN (SELECT id FROM room_executions WHERE room_id=?)").run(roomId);
      this.db.prepare("DELETE FROM room_operations WHERE execution_id IN (SELECT id FROM room_executions WHERE room_id=?)").run(roomId);
      for (const table of ["room_executions", "room_messages", "room_events", "room_dispatches", "room_resume_submissions", "room_participants", "room_files"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(roomId);
      }
      this.db.prepare("DELETE FROM room_session_contexts WHERE session_id IN (SELECT id FROM room_sessions WHERE room_id=?)").run(roomId);
      this.db.prepare("DELETE FROM room_sessions WHERE room_id=?").run(roomId);
      this.db.prepare("DELETE FROM agent_rooms WHERE id=?").run(roomId);
    });
  }
  recover(preserve: ReadonlySet<string> = new Set()) {
    this.transaction(() => {
      for (const room of this.list()) {
        for (const execution of this.executions(room.id)) {
          if (["running", "waiting_approval", "cancelling"].includes(execution.status) && !preserve.has(execution.id)) this.state(execution.id, "interrupted");
        }
        const writer = (this.db.prepare("SELECT writer_execution_id FROM agent_rooms WHERE id=?").get(room.id) as { writer_execution_id: string | null }).writer_execution_id;
        if (!writer || !preserve.has(writer)) {
          this.db.prepare("UPDATE agent_rooms SET writer_execution_id=NULL,generation=generation+1 WHERE id=?").run(room.id);
        }
      }
      this.db.prepare("UPDATE room_executions SET status='paused' WHERE status='queued'").run();
    });
  }
}
