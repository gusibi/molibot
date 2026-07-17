import assert from "node:assert/strict";
import test from "node:test";
import { MemoryMaintenanceService, MemoryMaintenanceStore } from "./maintenance.js";
import type { MemoryRecord } from "./types.js";

function record(id: string, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return { id, channel: "web", externalUserId: "chat", content: id, tags: [], layer: "long_term", state: "active", version: 1, confidence: 0.7, utility: 0.5, accessCount: 0, injectionCount: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...patch };
}

test("maintenance plans safely, honors pins, and is idempotent", async () => {
  const rows = [
    record("expired", { expiresAt: "2026-02-01T00:00:00.000Z" }),
    record("pinned-expired", { expiresAt: "2026-02-01T00:00:00.000Z", pinned: true }),
    record("unused"),
    record("used", { injectionCount: 2, lastInjectedAt: "2026-07-01T00:00:00.000Z" })
  ];
  const archived = new Set<string>();
  const dormant = new Set<string>();
  const gateway = {
    listForMaintenance: async () => rows.filter((row) => !archived.has(row.id) && !dormant.has(row.id)),
    delete: async (_scope: unknown, id: string) => { archived.add(id); return true; },
    update: async (_scope: unknown, id: string) => { dormant.add(id); return record(id, { state: "dormant" }); },
    compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 })
  };
  const store = new MemoryMaintenanceStore(":memory:");
  const service = new MemoryMaintenanceService(gateway as any, store);
  const target = { ownerId: "owner", botId: "momo", sourceScopes: [{ channel: "web", externalUserId: "chat" }] };
  const dry = await service.run(target, { triggerKey: "dry", dryRun: true, now: new Date("2026-07-17T00:00:00.000Z") });
  assert.equal(dry.plannedCount, 2);
  const first = await service.run(target, { triggerKey: "periodic", now: new Date("2026-07-17T00:00:00.000Z") });
  assert.deepEqual({ archived: first.archivedCount, dormant: first.dormantCount }, { archived: 1, dormant: 1 });
  const second = await service.run(target, { triggerKey: "opportunistic", now: new Date("2026-07-17T00:00:00.000Z") });
  assert.equal(second.plannedCount, 0);
  assert.equal(archived.has("pinned-expired"), false);
  store.close();
});

test("maintenance scope lease skips a concurrent trigger", async () => {
  const store = new MemoryMaintenanceStore(":memory:");
  const target = { ownerId: "owner", botId: "momo", sourceScopes: [{ channel: "web", externalUserId: "chat" }] };
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const service = new MemoryMaintenanceService({ listForMaintenance: async () => { await blocked; return []; }, delete: async () => false, update: async () => null, compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 }) } as any, store);
  const first = service.run(target, { triggerKey: "periodic" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.run(target, { triggerKey: "opportunistic" })).status, "skipped");
  release();
  assert.equal((await first).status, "completed");
  store.close();
});

test("semantic near-duplicates create a durable review and are never auto-merged", async () => {
  const rows = [
    record("preference-a", { content: "用户偏好发布前运行完整测试并核对变更摘要", type: "user_preference", domain: "owner", path: "mory://user_preference/release_check", createdAt: "2026-07-16T00:00:00Z" }),
    record("preference-b", { content: "用户喜欢在发布之前执行完整测试并检查变更摘要", type: "user_preference", domain: "owner", path: "mory://user_preference/release_check", createdAt: "2026-07-16T00:00:00Z" })
  ];
  let writes = 0;
  const gateway = {
    listForMaintenance: async () => rows,
    delete: async () => { writes += 1; return true; },
    update: async () => { writes += 1; return null; },
    compact: async () => ({ scannedCount: 2, removedCount: 0, scopesAffected: 0 })
  };
  const store = new MemoryMaintenanceStore(":memory:");
  const service = new MemoryMaintenanceService(gateway as any, store);
  const target = { ownerId: "owner", botId: "momo", sourceScopes: [{ channel: "web", externalUserId: "chat" }] };
  const result = await service.run(target, { triggerKey: "periodic", now: new Date("2026-07-17T00:00:00Z") });
  assert.equal(result.reviewDuplicateCount, 1);
  assert.equal(writes, 0);
  assert.equal(store.listPendingDuplicateReviews().length, 1);
  assert.equal((await service.run(target, { triggerKey: "retry", now: new Date("2026-07-17T00:00:00Z") })).reviewDuplicateCount, 0);
  store.close();
});
