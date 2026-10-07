import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunBudgetLimits, RunBudgetPersistence, RunBudgetState, ToolBudgetResult } from "./runtimeBudget.js";

/** Structured counters and receipts; one admitted run keeps its original limits. */
export class RunBudgetStore implements RunBudgetPersistence {
  private connection?: DatabaseSync;
  private closed = false;

  constructor(private readonly path: string, private readonly runId: string, private readonly limits: RunBudgetLimits) {}

  private get db(): DatabaseSync {
    if (this.closed) throw new Error("Run budget store is closed.");
    if (this.connection) return this.connection;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.path);
    try {
      db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS run_budgets (
          run_id TEXT PRIMARY KEY, max_tools INTEGER NOT NULL, max_failures INTEGER NOT NULL,
          max_models INTEGER NOT NULL, tools INTEGER NOT NULL DEFAULT 0,
          failures INTEGER NOT NULL DEFAULT 0, models INTEGER NOT NULL DEFAULT 0,
          exceeded_kind TEXT, exceeded_reason TEXT
        );
        CREATE TABLE IF NOT EXISTS run_budget_model_turns (
          run_id TEXT PRIMARY KEY, turns INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS run_budget_receipts (
          run_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL,
          is_error INTEGER, accepted INTEGER NOT NULL, reason TEXT,
          PRIMARY KEY (run_id, kind, source_id)
        );`);
      db.prepare(`INSERT OR IGNORE INTO run_budgets
        (run_id,max_tools,max_failures,max_models) VALUES (?,?,?,?)`)
        .run(this.runId, this.limits.maxToolCalls, this.limits.maxToolFailures, this.limits.maxModelAttempts);
      db.prepare("INSERT OR IGNORE INTO run_budget_model_turns (run_id) VALUES (?)")
        .run(this.runId);
      this.connection = db;
      return db;
    } catch (cause) { db.close(); throw cause; }
  }

  read(): RunBudgetState {
    const row = this.db.prepare("SELECT * FROM run_budgets WHERE run_id=?").get(this.runId)!;
    const turns = this.db.prepare("SELECT * FROM run_budget_model_turns WHERE run_id=?").get(this.runId)!;
    return {
      limits: { maxToolCalls: Number(row.max_tools), maxToolFailures: Number(row.max_failures), maxModelAttempts: Number(row.max_models) },
      toolCalls: Number(row.tools), toolFailures: Number(row.failures), modelFailures: Number(row.models), modelTurns: Number(turns.turns),
      exceededKind: row.exceeded_kind as RunBudgetState["exceededKind"],
      exceededReason: typeof row.exceeded_reason === "string" ? row.exceeded_reason : undefined
    };
  }

  mutate(kind: "tool" | "result" | "model" | "modelTurn", sourceId: string | undefined, isError: boolean | undefined,
    work: (state: RunBudgetState) => { state: RunBudgetState; result: ToolBudgetResult }): ToolBudgetResult {
    const id = sourceId ?? randomUUID();
    const error = isError === undefined ? null : Number(isError);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.db.prepare(`SELECT is_error,accepted,reason FROM run_budget_receipts
        WHERE run_id=? AND kind=? AND source_id=?`).get(this.runId, kind, id);
      if (receipt) {
        if (receipt.is_error !== error) throw new Error("Budget receipt identity has conflicting results.");
        const current = this.read();
        this.db.exec("COMMIT");
        if (kind === "tool" && current.exceededReason) return { ok: false, reason: current.exceededReason };
        return { ok: Boolean(receipt.accepted), ...(typeof receipt.reason === "string" ? { reason: receipt.reason } : {}) };
      }
      const { state, result } = work(this.read());
      this.db.prepare(`UPDATE run_budgets SET tools=?,failures=?,models=?,exceeded_kind=?,exceeded_reason=? WHERE run_id=?`)
        .run(state.toolCalls, state.toolFailures, state.modelFailures, state.exceededKind ?? null, state.exceededReason ?? null, this.runId);
      this.db.prepare("UPDATE run_budget_model_turns SET turns=? WHERE run_id=?").run(state.modelTurns, this.runId);
      this.db.prepare(`INSERT INTO run_budget_receipts (run_id,kind,source_id,is_error,accepted,reason) VALUES (?,?,?,?,?,?)`)
        .run(this.runId, kind, id, error, Number(result.ok), result.reason ?? null);
      this.db.exec("COMMIT");
      return result;
    } catch (cause) { this.db.exec("ROLLBACK"); throw cause; }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection?.close();
  }
}
