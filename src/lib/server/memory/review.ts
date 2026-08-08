import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MemoryGateway } from "./gateway.js";
import type { MemoryCandidate } from "./types.js";

export interface MemoryReviewTarget {
  channel: "telegram" | "feishu";
  botId: string;
  chatId: string;
}

export type MemoryReviewAction = "keep" | "ignore";

export interface MemoryReviewItem {
  batchId: string;
  candidateId: string;
  ordinal: number;
  value: string;
  warning?: string;
  messageId?: string;
}

export interface MemoryReviewBatch {
  id: string;
  localDate: string;
  target: MemoryReviewTarget;
  items: MemoryReviewItem[];
  skillDraftCount: number;
}

export type MemoryReviewDecisionStatus =
  | "kept"
  | "ignored"
  | "already_kept"
  | "already_ignored"
  | "processing"
  | "app_required"
  | "stale"
  | "forbidden";

export interface MemoryReviewDecision {
  status: MemoryReviewDecisionStatus;
  item?: MemoryReviewItem;
}

type BatchRow = {
  id: string;
  local_date: string;
  channel: MemoryReviewTarget["channel"];
  bot_id: string;
  chat_id: string;
  skill_draft_count: number;
};

type ItemRow = {
  batch_id: string;
  candidate_id: string;
  ordinal: number;
  platform_message_id: string | null;
};

function batchId(ownerId: string, localDate: string): string {
  const suffix = createHash("sha256").update(`${ownerId}:${localDate}`).digest("hex").slice(0, 20);
  return `memory-review:${localDate}:${suffix}`;
}

function candidateWarning(candidate: MemoryCandidate): string | undefined {
  const warnings: string[] = [];
  if ((candidate.possibleRelations?.length ?? 0) > 0) warnings.push("⚠ 可能与其他候选重复或冲突");
  if (candidate.supersedesMemoryId) warnings.push("将替代一条已有记忆");
  if (candidate.disputesMemoryId) warnings.push("与一条已有记忆存在争议");
  return warnings.length > 0 ? warnings.join("；") : undefined;
}

export class MemoryReviewStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_review_batches (
        id TEXT PRIMARY KEY,
        local_date TEXT NOT NULL,
        channel TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        skill_draft_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_review_items (
        batch_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        platform_message_id TEXT,
        delivered_at TEXT,
        PRIMARY KEY (batch_id, candidate_id),
        UNIQUE (batch_id, ordinal),
        FOREIGN KEY (batch_id) REFERENCES memory_review_batches(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_review_delivery
        ON memory_review_items(platform_message_id, candidate_id);
    `);
  }

  createOrLoad(input: {
    ownerId: string;
    localDate: string;
    target: MemoryReviewTarget;
    candidateIds: string[];
    skillDraftCount: number;
  }): { batch: BatchRow; items: ItemRow[] } {
    const id = batchId(input.ownerId, input.localDate);
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO memory_review_batches
          (id, local_date, channel, bot_id, chat_id, skill_draft_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.localDate, input.target.channel, input.target.botId, input.target.chatId, input.skillDraftCount, now, now);
      this.db.prepare(`
        UPDATE memory_review_batches
        SET skill_draft_count = MAX(skill_draft_count, ?), updated_at = ?
        WHERE id = ?
      `).run(input.skillDraftCount, now, id);
      let nextOrdinal = Number((this.db.prepare("SELECT COALESCE(MAX(ordinal), 0) AS value FROM memory_review_items WHERE batch_id = ?")
        .get(id) as { value: number }).value) + 1;
      for (const candidateId of [...new Set(input.candidateIds)]) {
        const inserted = this.db.prepare(`
          INSERT OR IGNORE INTO memory_review_items (batch_id, candidate_id, ordinal)
          VALUES (?, ?, ?)
        `).run(id, candidateId, nextOrdinal);
        if (Number(inserted.changes) > 0) nextOrdinal += 1;
      }
      this.db.exec("COMMIT");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
    return this.get(id)!;
  }

  get(id: string): { batch: BatchRow; items: ItemRow[] } | null {
    const batch = this.db.prepare("SELECT * FROM memory_review_batches WHERE id = ?").get(id) as BatchRow | undefined;
    if (!batch) return null;
    const items = this.db.prepare("SELECT * FROM memory_review_items WHERE batch_id = ? ORDER BY ordinal ASC").all(id) as ItemRow[];
    return { batch, items };
  }

  recordDelivery(batchIdValue: string, candidateId: string, messageId: string): boolean {
    const result = this.db.prepare(`
      UPDATE memory_review_items
      SET platform_message_id = COALESCE(platform_message_id, ?), delivered_at = COALESCE(delivered_at, ?)
      WHERE batch_id = ? AND candidate_id = ?
    `).run(messageId, new Date().toISOString(), batchIdValue, candidateId);
    return Number(result.changes) > 0;
  }

  findDelivery(input: {
    channel: MemoryReviewTarget["channel"];
    botId: string;
    chatId?: string;
    messageId: string;
    candidateId: string;
  }): { batch: BatchRow; item: ItemRow } | null {
    const row = this.db.prepare(`
      SELECT
        b.id, b.local_date, b.channel, b.bot_id, b.chat_id, b.skill_draft_count,
        i.batch_id, i.candidate_id, i.ordinal, i.platform_message_id
      FROM memory_review_items i
      JOIN memory_review_batches b ON b.id = i.batch_id
      WHERE b.channel = ? AND b.bot_id = ? AND i.platform_message_id = ? AND i.candidate_id = ?
      LIMIT 1
    `).get(input.channel, input.botId, input.messageId, input.candidateId) as (BatchRow & ItemRow) | undefined;
    if (!row || (input.chatId && row.chat_id !== input.chatId)) return null;
    return {
      batch: row,
      item: {
        batch_id: row.batch_id,
        candidate_id: row.candidate_id,
        ordinal: row.ordinal,
        platform_message_id: row.platform_message_id
      }
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

export class MemoryCandidateReview {
  constructor(
    private readonly gateway: Pick<MemoryGateway, "getCandidate" | "confirmCandidate" | "ignoreCandidate">,
    private readonly store: MemoryReviewStore
  ) {}

  createDailyBatch(input: {
    ownerId: string;
    localDate: string;
    target: MemoryReviewTarget;
    candidateIds: string[];
  }): MemoryReviewBatch {
    const actionable: string[] = [];
    let skillDraftCount = 0;
    for (const candidateId of [...new Set(input.candidateIds)]) {
      const candidate = this.gateway.getCandidate(candidateId);
      if (!candidate || candidate.status !== "pending") continue;
      if (candidate.skillDraftSuggestion) {
        skillDraftCount += 1;
        continue;
      }
      actionable.push(candidate.id);
    }
    const stored = this.store.createOrLoad({ ...input, candidateIds: actionable, skillDraftCount });
    const target: MemoryReviewTarget = {
      channel: stored.batch.channel,
      botId: stored.batch.bot_id,
      chatId: stored.batch.chat_id
    };
    const items = stored.items.flatMap((row): MemoryReviewItem[] => {
      const candidate = this.gateway.getCandidate(row.candidate_id);
      if (!candidate || candidate.status !== "pending" || candidate.skillDraftSuggestion) return [];
      return [{
        batchId: stored.batch.id,
        candidateId: candidate.id,
        ordinal: row.ordinal,
        value: candidate.value,
        warning: candidateWarning(candidate),
        messageId: row.platform_message_id ?? undefined
      }];
    });
    return {
      id: stored.batch.id,
      localDate: stored.batch.local_date,
      target,
      items,
      skillDraftCount: stored.batch.skill_draft_count
    };
  }

  recordDelivery(input: { batchId: string; candidateId: string; messageId: string }): boolean {
    return this.store.recordDelivery(input.batchId, input.candidateId, input.messageId);
  }

  getDeliveredItem(input: {
    channel: MemoryReviewTarget["channel"];
    botId: string;
    chatId?: string;
    messageId: string;
    candidateId: string;
  }): MemoryReviewItem | null {
    const delivery = this.store.findDelivery(input);
    if (!delivery) return null;
    const candidate = this.gateway.getCandidate(input.candidateId);
    if (!candidate) return null;
    return {
      batchId: delivery.batch.id,
      candidateId: candidate.id,
      ordinal: delivery.item.ordinal,
      value: candidate.value,
      warning: candidateWarning(candidate),
      messageId: input.messageId
    };
  }

  async decide(input: {
    channel: MemoryReviewTarget["channel"];
    botId: string;
    chatId?: string;
    messageId: string;
    candidateId: string;
    action: MemoryReviewAction;
  }): Promise<MemoryReviewDecision> {
    const delivery = this.store.findDelivery(input);
    if (!delivery) return { status: "forbidden" };
    const current = this.gateway.getCandidate(input.candidateId);
    const item = current ? {
      batchId: delivery.batch.id,
      candidateId: current.id,
      ordinal: delivery.item.ordinal,
      value: current.value,
      warning: candidateWarning(current),
      messageId: input.messageId
    } : undefined;
    if (!current) return { status: "stale", item };
    if (current.status === "confirmed" || current.status === "edited-then-confirmed") return { status: "already_kept", item };
    if (current.status === "ignored") return { status: "already_ignored", item };
    if (current.skillDraftSuggestion) return { status: "app_required", item };
    const decided = input.action === "keep"
      ? await this.gateway.confirmCandidate(current.id)
      : this.gateway.ignoreCandidate(current.id);
    if (!decided || decided.status === "pending") return { status: "processing", item };
    if (decided.status === "ignored") return { status: "ignored", item: { ...item!, value: decided.value } };
    return { status: "kept", item: { ...item!, value: decided.value } };
  }
}

export function formatMemoryReviewItem(item: MemoryReviewItem): string {
  return [`记忆 ${item.ordinal}`, "", item.value, ...(item.warning ? ["", item.warning] : [])].join("\n");
}

export function formatMemoryReviewDecision(decision: MemoryReviewDecision): string {
  if (!decision.item) {
    if (decision.status === "forbidden") return "这条记忆审核操作无效或不属于当前会话。";
    return "这条记忆候选已不存在。";
  }
  const label = decision.status === "kept" || decision.status === "already_kept"
    ? "已保留 ✅"
    : decision.status === "ignored" || decision.status === "already_ignored"
      ? "已不保留 🗑️"
      : decision.status === "app_required"
        ? "需要在 APP 中审核"
        : "正在处理…";
  return [`记忆 ${decision.item.ordinal} · ${label}`, "", decision.item.value, ...(decision.item.warning ? ["", decision.item.warning] : [])].join("\n");
}
