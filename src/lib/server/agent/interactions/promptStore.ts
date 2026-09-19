import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { InteractionInputKind, InteractionStateBinding } from "$lib/server/agent/interactions/types.js";

/**
 * A bound input prompt that outlives the process that created it.
 *
 * The in-memory registry intentionally drops on restart, so without this record
 * a reply to an old prompt would be indistinguishable from an ordinary message
 * and would silently start a fresh Agent run. Persisting the prompt binding
 * lets a restarted process recognise the reply target and fail closed.
 */
export interface PersistedInteractionPrompt {
  id: string;
  kind: InteractionInputKind;
  scopeId: string;
  chatId: string;
  actorId: string;
  binding: InteractionStateBinding;
  skillName?: string;
  promptMessageId: string;
  expiresAt: number;
}

export interface InteractionPromptStore {
  list(): PersistedInteractionPrompt[];
  save(record: PersistedInteractionPrompt): void;
  remove(id: string): void;
}

export interface SqliteInteractionPromptStoreOptions {
  channel: string;
  instanceId: string;
  dbFile: string;
}

export class SqliteInteractionPromptStore implements InteractionPromptStore {
  private readonly db: DatabaseSync;
  private readonly channel: string;
  private readonly instanceId: string;

  constructor(options: SqliteInteractionPromptStoreOptions) {
    const dbFile = options.dbFile;
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.channel = options.channel;
    this.instanceId = options.instanceId;
    this.ensureSchema();
  }

  list(): PersistedInteractionPrompt[] {
    const rows = this.db.prepare(`
      SELECT payload_json
      FROM interaction_prompts
      WHERE channel = ?
        AND instance_id = ?
    `).all(this.channel, this.instanceId) as Array<{ payload_json: string }>;

    const records: PersistedInteractionPrompt[] = [];
    for (const row of rows) {
      try {
        records.push(JSON.parse(row.payload_json) as PersistedInteractionPrompt);
      } catch {
        // A corrupt row must not block startup; it is dropped by the caller's prune.
      }
    }
    return records;
  }

  save(record: PersistedInteractionPrompt): void {
    this.db.prepare(`
      INSERT INTO interaction_prompts (channel, instance_id, id, expires_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel, instance_id, id)
      DO UPDATE SET expires_at = excluded.expires_at, payload_json = excluded.payload_json
    `).run(this.channel, this.instanceId, record.id, record.expiresAt, JSON.stringify(record));
  }

  remove(id: string): void {
    this.db.prepare(`
      DELETE FROM interaction_prompts
      WHERE channel = ? AND instance_id = ? AND id = ?
    `).run(this.channel, this.instanceId, id);
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interaction_prompts (
        channel TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (channel, instance_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_interaction_prompts_expiry
      ON interaction_prompts(channel, instance_id, expires_at);
    `);
  }
}
