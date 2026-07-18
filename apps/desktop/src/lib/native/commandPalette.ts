import type { CommandId, CommandSnapshot } from "./commandSystem";

export const COMMAND_USAGE_STORAGE_KEY = "molibot-desktop-command-usage-v1";
export const COMMAND_USAGE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const COMMAND_USAGE_LIMIT = 20;

type CommandUsageRecord = {
  id: CommandId;
  lastSucceededAt: number;
  successfulRuns: number;
};

export type CommandUsage = readonly CommandUsageRecord[];

export type CommandUsageStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type PersistedCommandUsage = {
  version: 1;
  entries: readonly CommandUsageRecord[];
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function stableCompare(left: CommandSnapshot, right: CommandSnapshot): number {
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function validEntry(value: unknown, ids: ReadonlySet<string>, now: number): value is CommandUsageRecord {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CommandUsageRecord>;
  return typeof entry.id === "string"
    && ids.has(entry.id)
    && typeof entry.lastSucceededAt === "number"
    && Number.isFinite(entry.lastSucceededAt)
    && entry.lastSucceededAt <= now
    && now - entry.lastSucceededAt <= COMMAND_USAGE_MAX_AGE_MS
    && typeof entry.successfulRuns === "number"
    && Number.isSafeInteger(entry.successfulRuns)
    && entry.successfulRuns > 0;
}

function pruneUsage(entries: readonly CommandUsageRecord[], commands: readonly CommandSnapshot[], now: number): CommandUsageRecord[] {
  const ids = new Set(commands.map((command) => command.id));
  const unique = new Map<CommandId, CommandUsageRecord>();
  for (const entry of entries) {
    if (!validEntry(entry, ids, now)) continue;
    const existing = unique.get(entry.id);
    if (!existing || entry.lastSucceededAt > existing.lastSucceededAt) unique.set(entry.id, entry);
  }
  return [...unique.values()]
    .sort((left, right) => right.lastSucceededAt - left.lastSucceededAt || right.successfulRuns - left.successfulRuns || left.id.localeCompare(right.id))
    .slice(0, COMMAND_USAGE_LIMIT);
}

export function loadCommandUsage(storage: CommandUsageStorage | null | undefined, commands: readonly CommandSnapshot[], now = Date.now()): CommandUsageRecord[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(COMMAND_USAGE_STORAGE_KEY) ?? "null") as Partial<PersistedCommandUsage> | null;
    if (!value || value.version !== 1 || !Array.isArray(value.entries)) return [];
    return pruneUsage(value.entries, commands, now);
  } catch {
    return [];
  }
}

export function saveCommandUsage(storage: CommandUsageStorage | null | undefined, usage: CommandUsage): void {
  if (!storage) return;
  try {
    storage.setItem(COMMAND_USAGE_STORAGE_KEY, JSON.stringify({ version: 1, entries: usage } satisfies PersistedCommandUsage));
  } catch {
    // Local palette personalization is non-essential when storage is unavailable.
  }
}

export function recordCommandSuccess(usage: CommandUsage, commandId: CommandId, commands: readonly CommandSnapshot[], now = Date.now()): CommandUsageRecord[] {
  const existing = usage.find((entry) => entry.id === commandId);
  const next = [
    { id: commandId, lastSucceededAt: now, successfulRuns: (existing?.successfulRuns ?? 0) + 1 },
    ...usage.filter((entry) => entry.id !== commandId)
  ];
  return pruneUsage(next, commands, now);
}

function usageById(usage: CommandUsage): ReadonlyMap<CommandId, CommandUsageRecord> {
  return new Map(usage.map((entry) => [entry.id, entry]));
}

function compareRecommendations(left: CommandSnapshot, right: CommandSnapshot): number {
  return left.recommendedRank - right.recommendedRank || stableCompare(left, right);
}

export function rankCommands(commands: readonly CommandSnapshot[], query: string, usage: CommandUsage = []): CommandSnapshot[] {
  const term = normalized(query);
  const usageEntries = usageById(usage);
  if (!term) {
    return [...commands].sort((left, right) => {
      const leftUsage = usageEntries.get(left.id);
      const rightUsage = usageEntries.get(right.id);
      if (leftUsage || rightUsage) {
        if (!leftUsage) return 1;
        if (!rightUsage) return -1;
        const recent = rightUsage.lastSucceededAt - leftUsage.lastSucceededAt || rightUsage.successfulRuns - leftUsage.successfulRuns;
        if (recent) return recent;
      }
      return compareRecommendations(left, right);
    });
  }
  return commands
    .map((command, index) => {
      const label = normalized(command.label);
      const keywords = command.keywords.map(normalized);
      const labelIndex = label.indexOf(term);
      const keywordIndex = keywords.findIndex((keyword) => keyword.includes(term));
      const score = label === term ? 0
        : label.startsWith(term) ? 1
        : labelIndex >= 0 ? 2
        : keywordIndex >= 0 ? 3
        : Number.POSITIVE_INFINITY;
      return { command, index, score, keywordIndex, usage: usageEntries.get(command.id) };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      const relevance = left.score - right.score || left.keywordIndex - right.keywordIndex;
      if (relevance) return relevance;
      const recent = (right.usage?.lastSucceededAt ?? 0) - (left.usage?.lastSucceededAt ?? 0)
        || (right.usage?.successfulRuns ?? 0) - (left.usage?.successfulRuns ?? 0);
      if (recent) return recent;
      return compareRecommendations(left.command, right.command) || left.index - right.index;
    })
    .map((entry) => entry.command);
}
