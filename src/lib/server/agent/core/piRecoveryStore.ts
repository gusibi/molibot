import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MomContext } from './types.js';
import type { Model } from '@earendil-works/pi-ai';

/** Private admission metadata; remote handles stay in the native Pi ledger. */
export interface PiRecoveryRecord {
  runId: string;
  workspaceDir: string;
  chatId: string;
  sessionId: string;
  channel: string;
  transport?: MomContext["deliveryTarget"];
  runtimeIdentity?: { agentId: string; roomId: string; executionId: string };
  context: Pick<MomContext, 'project' | 'modelKeyOverride' | 'retention' | 'executionPolicy' | 'roomRouting'>;
  actor: string;
  workspaceId: string;
  budgetId?: string;
  models: Model<any>[];
  mcpServerIds?: string[];
  mcpServers?: Record<string, string>;
  storagePath?: string;
  deferred: boolean;
}

export class PiRecoveryStore {
  private db: DatabaseSync;
  constructor(dataRoot: string) {
    const file = join(dataRoot, 'runtime', 'pi-recovery.sqlite');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec('CREATE TABLE IF NOT EXISTS owners (run_id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  }
  read(runId: string): PiRecoveryRecord | undefined {
    const row = this.db.prepare('SELECT record FROM owners WHERE run_id = ?').get(runId) as { record: string } | undefined;
    return row ? JSON.parse(row.record) : undefined;
  }
  save(record: PiRecoveryRecord): void {
    this.db.prepare('INSERT INTO owners VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET record=excluded.record').run(record.runId, JSON.stringify(record));
  }
  all(): PiRecoveryRecord[] {
    return (this.db.prepare('SELECT record FROM owners').all() as { record: string }[]).map(row => JSON.parse(row.record) as PiRecoveryRecord);
  }
  waiting(): PiRecoveryRecord[] { return this.all().filter(row => row.deferred); }
  remove(runId: string): void { this.db.prepare('DELETE FROM owners WHERE run_id=?').run(runId); }
  close(): void { this.db.close(); }
}
