import { createHash } from "node:crypto";
import type { MemoryAccessScope, MemoryNamespace, MemoryRecord } from "$lib/server/memory/types.js";

export interface MemoryProfileScope extends MemoryAccessScope {
  ownerId: string;
  botId: string;
  includeOwner: boolean;
  includeAgentSelf: boolean;
}

export interface MemoryProfileSectionMeta {
  selectedCount: number;
  scannedCount: number;
  excludedCount: number;
  truncated: boolean;
  rule: string;
}

export interface MemoryProfileResult {
  summary: string;
  stablePreferences: MemoryRecord[];
  profileFacts: MemoryRecord[];
  currentFocus: MemoryRecord[];
  recentItems: MemoryRecord[];
  attentionItems: MemoryRecord[];
  meta: {
    scope: Pick<MemoryProfileScope, "ownerId" | "botId" | "channel" | "externalUserId" | "conversationId" | "projectId" | "includeOwner" | "includeAgentSelf" | "authorizedNamespaces">;
    fingerprint: string;
    stablePreferences: MemoryProfileSectionMeta;
    profileFacts: MemoryProfileSectionMeta;
    currentFocus: MemoryProfileSectionMeta;
    recentItems: MemoryProfileSectionMeta;
    attentionItems: MemoryProfileSectionMeta;
  };
}

export interface MemoryProfilePage {
  items: MemoryRecord[];
  scannedCount: number;
  truncated: boolean;
}

const STABILITY_RULE = "pinned desc, active-version age bucket desc, confidence desc, utility desc, log1p(injection count) desc, updatedAt desc, id asc";

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeVersionAgeBucket(record: MemoryRecord, nowMs: number): number {
  const ageDays = Math.max(0, nowMs - timestamp(record.createdAt)) / 86_400_000;
  if (ageDays >= 180) return 3;
  if (ageDays >= 30) return 2;
  if (ageDays >= 7) return 1;
  return 0;
}

export function compareProfileStability(left: MemoryRecord, right: MemoryRecord, nowMs = Date.now()): number {
  return Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || activeVersionAgeBucket(right, nowMs) - activeVersionAgeBucket(left, nowMs)
    || (right.confidence ?? 0) - (left.confidence ?? 0)
    || (right.utility ?? 0) - (left.utility ?? 0)
    || Math.log1p(right.injectionCount ?? 0) - Math.log1p(left.injectionCount ?? 0)
    || timestamp(right.updatedAt) - timestamp(left.updatedAt)
    || left.id.localeCompare(right.id);
}

function isExpired(record: MemoryRecord, nowMs: number): boolean {
  return Boolean(record.expiresAt && timestamp(record.expiresAt) <= nowMs && !record.pinned);
}

function isEligible(record: MemoryRecord, nowMs: number): boolean {
  return record.state === "active"
    && !record.hasConflict
    && record.allowInjection !== false
    && record.privacySuppressed !== true
    && !isExpired(record, nowMs);
}

function topicKey(record: MemoryRecord): string {
  const raw = record.subject || record.tags[0] || record.type || "general";
  return raw.toLocaleLowerCase().split(/[.:/_-]/)[0] || "general";
}

function summaryFrom(stable: MemoryRecord[], facts: MemoryRecord[], focus: MemoryRecord[]): string {
  const seen = new Set<string>();
  return [...stable, ...facts, ...focus]
    .filter((record) => {
      const topic = topicKey(record);
      if (seen.has(topic)) return false;
      seen.add(topic);
      return true;
    })
    .slice(0, 5)
    .map((record) => record.content.replace(/\s+/g, " ").trim())
    .join("；");
}

export class MemoryProfileBuilder {
  constructor(private readonly load: (scope: MemoryProfileScope, limit: number) => Promise<MemoryProfilePage>) {}

  async build(scope: MemoryProfileScope, options: { limitPerSection?: number; scanLimit?: number; now?: Date } = {}): Promise<MemoryProfileResult> {
    const limit = Math.max(1, Math.min(100, options.limitPerSection ?? 12));
    const scanLimit = Math.max(limit, Math.min(2_000, options.scanLimit ?? 500));
    const nowMs = (options.now ?? new Date()).getTime();
    const page = await this.load(scope, scanLimit);
    const authorized = new Set<MemoryNamespace>(scope.authorizedNamespaces);
    const rows = page.items.filter((record) => Boolean(record.namespace && authorized.has(record.namespace)));
    const eligible = rows.filter((record) => isEligible(record, nowMs));
    const excluded = rows.length - eligible.length;
    const stablePreferences = eligible.filter((record) => record.type === "user_preference").sort((a, b) => compareProfileStability(a, b, nowMs)).slice(0, limit);
    const profileFacts = eligible.filter((record) => record.type === "user_fact").sort((a, b) => compareProfileStability(a, b, nowMs)).slice(0, limit);
    const currentFocus = eligible.filter((record) =>
      (record.type === "task" || record.type === "event")
      && (record.domain === "project" || record.namespace?.startsWith("chat:"))
    ).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, limit);
    const recentItems = eligible.slice().sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || a.id.localeCompare(b.id)).slice(0, limit);
    const attentionItems = rows.filter((record) => !isEligible(record, nowMs)).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, limit);
    const summary = summaryFrom(stablePreferences, profileFacts, currentFocus);
    const fingerprint = createHash("sha256").update(JSON.stringify({
      scope: scope.authorizedNamespaces,
      stable: stablePreferences.map((record) => [record.id, record.updatedAt]),
      facts: profileFacts.map((record) => [record.id, record.updatedAt]),
      focus: currentFocus.map((record) => [record.id, record.updatedAt])
    })).digest("hex");
    const metaFor = (selectedCount: number, rule: string): MemoryProfileSectionMeta => ({
      selectedCount,
      scannedCount: page.scannedCount,
      excludedCount: excluded,
      truncated: page.truncated,
      rule
    });
    return {
      summary,
      stablePreferences,
      profileFacts,
      currentFocus,
      recentItems,
      attentionItems,
      meta: {
        scope: {
          ownerId: scope.ownerId,
          botId: scope.botId,
          channel: scope.channel,
          externalUserId: scope.externalUserId,
          conversationId: scope.conversationId,
          projectId: scope.projectId,
          includeOwner: scope.includeOwner,
          includeAgentSelf: scope.includeAgentSelf,
          authorizedNamespaces: [...scope.authorizedNamespaces]
        },
        fingerprint,
        stablePreferences: metaFor(stablePreferences.length, STABILITY_RULE),
        profileFacts: metaFor(profileFacts.length, STABILITY_RULE),
        currentFocus: metaFor(currentFocus.length, "active task/event from current chat or project, recent first"),
        recentItems: metaFor(recentItems.length, "eligible records, createdAt desc"),
        attentionItems: metaFor(attentionItems.length, "conflict, disabled, private, disputed, dormant, archived, or expired")
      }
    };
  }
}
