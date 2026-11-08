import type { DesktopConversationActivity } from "@molibot/desktop-contract";
import type { ComposerContextUsage } from "../presentation";

export type ContextWindowTone =
  | "systemPrompt"
  | "tools"
  | "toolResults"
  | "memory"
  | "files"
  | "skills"
  | "messages"
  | "live"
  | "reported"
  | "remaining";

export type ContextWindowBlockKey = ContextWindowTone | "olderRounds" | `round:${number}`;

export interface ContextWindowBlock {
  key: ContextWindowBlockKey;
  tokens: number;
  /** Share of the full model context window, 0-100. */
  percent: number;
  /** Layout weight; small non-empty details receive a minimum visible area. */
  displayTokens: number;
  /** Provider-ledger consumption for the corresponding run, when available. */
  reportedTokens?: number;
}

export interface ContextWindowRect {
  key: ContextWindowBlockKey;
  tokens: number;
  percent: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToolUsageRow {
  key: string;
  label: string;
  count: number;
  tokens: number;
  running: boolean;
}

interface ContextWindowTokenBlock {
  key: ContextWindowBlockKey;
  tokens: number;
  reportedTokens?: number;
}

export interface ContextWindowRoundUsage {
  index: number;
  textTokens: number;
  toolTokens: number;
  reportedTokens?: number;
}

const CJK_CHARACTER_PATTERN = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

/** Content below this share of the window is zoomed up to it for readability. */
const CONTEXT_MIN_SHARE = 0.3;

export function estimateContextTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHARACTER_PATTERN) ?? []).length;
  return cjkCount + Math.ceil((text.length - cjkCount) / 4);
}

/**
 * Builds a window-sized block model. Calibrated snapshots already carry
 * provider-measured categories; estimates are scaled to the provider-reported
 * used size so the legend, headline, and treemap agree either way.
 */
export function buildContextWindowBlocks(
  usage: ComposerContextUsage | null,
  liveTokens = 0,
  rounds: readonly ContextWindowRoundUsage[] = []
): ContextWindowBlock[] {
  if (!usage) return [];
  const roundedLiveTokens = Math.max(0, Math.round(liveTokens));
  const categoryTokens = new Map<ContextWindowBlockKey, number>();
  for (const category of usage.categories) {
    if (category.tokens <= 0) continue;
    categoryTokens.set(category.key, (categoryTokens.get(category.key) ?? 0) + category.tokens);
  }

  const estimatedTotal = [...categoryTokens.values()].reduce((total, tokens) => total + tokens, 0);
  const accountedTokens = Math.max(0, usage.usedTokens);
  const scale = estimatedTotal > 0 ? accountedTokens / estimatedTotal : 0;
  let allocatedEstimate = 0;
  let allocatedTokens = 0;
  const tokenBlocks: ContextWindowTokenBlock[] = [...categoryTokens].map(([key, tokens]) => {
    allocatedEstimate += tokens;
    const nextAllocatedTokens = Math.round(allocatedEstimate * scale);
    const block = { key, tokens: nextAllocatedTokens - allocatedTokens };
    allocatedTokens = nextAllocatedTokens;
    return block;
  });
  const messageIndex = tokenBlocks.findIndex((block) => block.key === "messages");
  const messageBlock = messageIndex >= 0 ? tokenBlocks[messageIndex] : undefined;
  if (messageBlock) {
    tokenBlocks.splice(messageIndex, 1);
    // Snapshots with a toolResults bucket already account for tool output; for
    // legacy snapshots the rounds still have to carry it.
    const legacyToolResults = !tokenBlocks.some((block) => block.key === "toolResults");
    const roundTextTotal = rounds.reduce((total, round) => total + round.textTokens, 0);
    const roundToolTotal = legacyToolResults
      ? rounds.reduce((total, round) => total + round.toolTokens, 0)
      : 0;
    const estimatedRoundTotal = roundTextTotal + roundToolTotal;
    if (estimatedRoundTotal > 0) {
      const scale = messageBlock.tokens / estimatedRoundTotal;
      const fixedBlockCount = tokenBlocks.length
        + (roundedLiveTokens > 0 ? 1 : 0)
        + (roundToolTotal > 0 ? 1 : 0);
      const detailedRoundCount = Math.max(1, Math.min(rounds.length, 8 - fixedBlockCount));
      const detailed = rounds.slice(-detailedRoundCount);
      const older = rounds.slice(0, -detailedRoundCount);
      const olderTokens = older.reduce((total, round) => total + round.textTokens * scale, 0);
      const olderReportedTokens = older.reduce((total, round) => total + (round.reportedTokens ?? 0), 0);
      if (olderTokens > 0) tokenBlocks.push({
        key: "olderRounds",
        tokens: olderTokens,
        ...(olderReportedTokens > 0 ? { reportedTokens: olderReportedTokens } : {})
      });
      for (const round of detailed) {
        const roundTokens = round.textTokens * scale;
        if (roundTokens > 0) tokenBlocks.push({
          key: `round:${round.index}`,
          tokens: roundTokens,
          ...(round.reportedTokens ? { reportedTokens: round.reportedTokens } : {})
        });
      }
      const toolResultTokens = roundToolTotal * scale;
      if (toolResultTokens > 0) tokenBlocks.push({ key: "toolResults", tokens: toolResultTokens });
    } else {
      tokenBlocks.push(messageBlock);
    }
  }

  if (tokenBlocks.length === 0 && accountedTokens > 0) {
    tokenBlocks.push({ key: "reported", tokens: accountedTokens });
  }
  if (roundedLiveTokens > 0) tokenBlocks.push({ key: "live", tokens: roundedLiveTokens });

  const usedTokens = tokenBlocks
    .filter((block) => block.key !== "remaining")
    .reduce((total, block) => total + block.tokens, 0);
  const remainingTokens = usage.contextWindow > 0
    ? Math.max(0, usage.contextWindow - Math.max(usedTokens, usage.usedTokens))
    : 0;
  if (remainingTokens > 0) tokenBlocks.push({ key: "remaining", tokens: remainingTokens });

  const denominator = usage.contextWindow > 0
    ? usage.contextWindow
    : tokenBlocks.reduce((total, block) => total + block.tokens, 0) || 1;
  // Percent values stay real everywhere; only layout areas are adjusted.
  // Small sessions would otherwise collapse into an unreadable sliver beside
  // the remaining-space block, so content is zoomed to hold at least
  // CONTEXT_MIN_SHARE of the map (proportions between blocks preserved) and
  // the remaining-space block visually absorbs the difference — display areas
  // still sum to the window. Labels and percents stay exact-scale numbers;
  // the 1% floor keeps every block large enough for a compact label.
  const contentTokens = tokenBlocks
    .filter((block) => block.key !== "remaining")
    .reduce((total, block) => total + block.tokens, 0);
  const zoom = contentTokens > 0 && denominator > contentTokens
    ? Math.max(1, (denominator * CONTEXT_MIN_SHARE) / contentTokens)
    : 1;
  const areaFloor = denominator * 0.01;
  return tokenBlocks.map((block) => ({
    ...block,
    percent: Math.min(100, (block.tokens / denominator) * 100),
    displayTokens: block.key === "remaining"
      ? Math.max(0, denominator - contentTokens * zoom)
      : Math.max(block.tokens * zoom, areaFloor)
  })).filter((block) => block.tokens > 0);
}

function splitForBalancedArea(
  items: readonly ContextWindowBlock[]
): [ContextWindowBlock[], ContextWindowBlock[]] {
  const total = items.reduce((sum, item) => sum + item.displayTokens, 0);
  let left: ContextWindowBlock[] = [];
  let leftSum = 0;
  for (const item of items) {
    const currentDistance = Math.abs(leftSum - total / 2);
    const nextDistance = Math.abs(leftSum + item.displayTokens - total / 2);
    if (left.length === 0 || nextDistance <= currentDistance) {
      left.push(item);
      leftSum += item.displayTokens;
    } else {
      const right = items.slice(left.length);
      return [left, right];
    }
  }
  return [left, []];
}

function layoutGroup(
  items: readonly ContextWindowBlock[],
  x: number,
  y: number,
  width: number,
  height: number,
  output: ContextWindowRect[]
): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    const item = items[0];
    output.push({ ...item, x, y, width, height });
    return;
  }

  const total = items.reduce((sum, item) => sum + item.displayTokens, 0);
  const [left, right] = splitForBalancedArea(items);
  const leftShare = left.reduce((sum, item) => sum + item.displayTokens, 0) / total;
  if (width >= height) {
    const leftWidth = width * leftShare;
    layoutGroup(left, x, y, leftWidth, height, output);
    layoutGroup(right, x + leftWidth, y, width - leftWidth, height, output);
  } else {
    const leftHeight = height * leftShare;
    layoutGroup(left, x, y, width, leftHeight, output);
    layoutGroup(right, x, y + leftHeight, width, height - leftHeight, output);
  }
}

/** Produces readable treemap geometry; token labels remain exact-scale values. */
export function layoutContextWindowBlocks(blocks: readonly ContextWindowBlock[]): ContextWindowRect[] {
  const items = blocks.filter((block) => block.tokens > 0 && block.displayTokens > 0);
  if (items.length === 0) return [];
  const output: ContextWindowRect[] = [];
  layoutGroup(items, 0, 0, 100, 100, output);
  return output.map((rect) => ({
    ...rect,
    x: Number(rect.x.toFixed(3)),
    y: Number(rect.y.toFixed(3)),
    width: Number(rect.width.toFixed(3)),
    height: Number(rect.height.toFixed(3))
  }));
}

export function buildToolUsageRows(activities: readonly DesktopConversationActivity[]): ToolUsageRow[] {
  const rows = new Map<string, ToolUsageRow>();
  for (const activity of activities) {
    const label = activity.tool || activity.label || "tool";
    const key = label.toLowerCase();
    const reportedTokens = typeof activity.tokenUsage === "number" && Number.isFinite(activity.tokenUsage)
      ? Math.max(0, activity.tokenUsage)
      : 0;
    const tokens = reportedTokens > 0
      ? reportedTokens
      : estimateContextTextTokens(activity.summary ?? "");
    const existing = rows.get(key);
    rows.set(key, {
      key,
      label,
      count: (existing?.count ?? 0) + 1,
      tokens: (existing?.tokens ?? 0) + tokens,
      running: Boolean(existing?.running) || activity.state === "running"
    });
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
}

function activityResultTokens(activity: DesktopConversationActivity): number {
  if (typeof activity.tokenUsage === "number" && Number.isFinite(activity.tokenUsage)) {
    return Math.max(0, activity.tokenUsage);
  }
  return estimateContextTextTokens(activity.summary ?? "");
}

export function buildContextRoundUsage(
  messages: ReadonlyArray<{
    role: string;
    content: string;
    thinking?: string;
    activities?: DesktopConversationActivity[];
    usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  }>,
  liveActivities: readonly DesktopConversationActivity[] = []
): ContextWindowRoundUsage[] {
  const rounds: Array<{ textTokens: number; toolTokens: number; reportedTokens: number }> = [];
  for (const message of messages) {
    if (message.role === "user" || rounds.length === 0) {
      rounds.push({ textTokens: 0, toolTokens: 0, reportedTokens: 0 });
    }
    const round = rounds.at(-1)!;
    round.textTokens += estimateContextTextTokens(message.content);
    if (message.thinking) round.textTokens += estimateContextTextTokens(message.thinking);
    if (message.usage) {
      round.reportedTokens += message.usage.totalTokens
        ?? (message.usage.inputTokens ?? 0)
        + (message.usage.outputTokens ?? 0)
        + (message.usage.cacheReadTokens ?? 0)
        + (message.usage.cacheWriteTokens ?? 0);
    }
    for (const activity of message.activities ?? []) {
      round.toolTokens += activityResultTokens(activity);
    }
  }
  if (liveActivities.length > 0) {
    if (rounds.length === 0) rounds.push({ textTokens: 0, toolTokens: 0, reportedTokens: 0 });
    for (const activity of liveActivities) {
      rounds.at(-1)!.toolTokens += activityResultTokens(activity);
    }
  }
  return rounds
    .map((round, index) => ({
      index: index + 1,
      textTokens: round.textTokens,
      toolTokens: round.toolTokens,
      ...(round.reportedTokens > 0 ? { reportedTokens: round.reportedTokens } : {})
    }))
    .filter((round) => round.textTokens > 0 || round.toolTokens > 0 || (round.reportedTokens ?? 0) > 0);
}
