import type { Translation } from "../i18n";

/**
 * Momo expressions the home stage can show. Every id has a background-free
 * export in `public/momo/<id>.webp`; `scripts/generate-momo-expressions.py`
 * reads this list, so the two cannot drift apart.
 */
export const MOMO_EXPRESSIONS = [
  "waving",
  "happy",
  "thinking",
  "proactive-alert",
  "task-finisher",
  "sleeping",
  "serious"
] as const;

export type MomoExpression = (typeof MOMO_EXPRESSIONS)[number];

/** How the artwork meets the desk. A bust fades into the light instead of standing on it. */
export type MomoShape = "standing" | "bust" | "badge";

export const MOMO_SHAPES: Record<MomoExpression, MomoShape> = {
  waving: "standing",
  happy: "standing",
  thinking: "bust",
  "proactive-alert": "badge",
  "task-finisher": "badge",
  sleeping: "badge",
  serious: "standing"
};

export function usesMomoExpressions(avatar?: string | null): boolean {
  return !avatar || avatar.startsWith("/logos/");
}

export function momoExpressionSrc(expression: MomoExpression): string {
  return `/momo/${expression}.webp`;
}

/** What the owner should feel from Momo before reading a single card. */
export type HomeMood =
  | "disabled"
  | "alert"
  | "working"
  | "error"
  | "done"
  | "sleeping"
  | "welcome"
  | "idle";

const MOOD_EXPRESSION: Record<HomeMood, MomoExpression> = {
  disabled: "serious",
  alert: "proactive-alert",
  working: "thinking",
  error: "serious",
  done: "task-finisher",
  sleeping: "sleeping",
  welcome: "waving",
  idle: "happy"
};

export function momoExpressionFor(mood: HomeMood): MomoExpression {
  return MOOD_EXPRESSION[mood];
}

export interface HomePresenceInput {
  enabled: boolean;
  /** The Agent's real run status; "unknown" until the first activity read lands. */
  activityStatus: "idle" | "working" | "completed" | "error" | "unknown";
  /** The service is unreachable, so nothing below can be trusted or acted on. */
  stale: boolean;
  /** Unread decisions waiting for the owner. */
  decisionCount: number;
  /** Unread finished work and produced material. */
  doneCount: number;
  /** Unread work that did not finish. */
  failedCount: number;
  sessionCount: number;
  /** Local clock hour, 0–23. */
  hour: number;
}

/**
 * One mood from the real signals, most urgent first. A decision outranks a
 * running task because only the owner can unblock it; a finished run only
 * counts while its result is still unread.
 */
export function homeMood(input: HomePresenceInput): HomeMood {
  if (!input.enabled) return "disabled";
  if (input.decisionCount > 0) return "alert";
  if (input.activityStatus === "working") return "working";
  if (input.activityStatus === "error" || input.stale) return "error";
  if (input.doneCount > 0) return "done";
  if (input.failedCount > 0) return "error";
  if (homeGreeting(input.hour) === "night") return "sleeping";
  if (input.sessionCount === 0) return "welcome";
  return "idle";
}

/** What the inbox below the composer is showing, so the sentence can count exactly that. */
export interface HomeDeskCounts {
  decisionCount: number;
  doneCount: number;
  failedCount: number;
}

export interface HomeDeskPresence extends HomeDeskCounts {
  hasContent: boolean;
}

export type HomeGreeting = "morning" | "noon" | "afternoon" | "evening" | "night";

const HOME_HELLO = {
  morning: "homeHelloMorning",
  noon: "homeHelloNoon",
  afternoon: "homeHelloAfternoon",
  evening: "homeHelloEvening",
  night: "homeHelloNight"
} as const satisfies Record<HomeGreeting, keyof Translation>;

export function homeGreeting(hour: number): HomeGreeting {
  const local = ((Math.trunc(hour) % 24) + 24) % 24;
  if (local >= 22 || local < 6) return "night";
  if (local < 11) return "morning";
  if (local < 13) return "noon";
  if (local < 18) return "afternoon";
  return "evening";
}

/** Shorter gaps are an ordinary trip to another page, not time away. */
export const HOME_AWAY_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function homeAwayMs(lastSeenAt: string | undefined, now = Date.now()): number | null {
  const seen = Date.parse(lastSeenAt ?? "");
  const away = now - seen;
  return Number.isFinite(seen) && away >= HOME_AWAY_THRESHOLD_MS ? away : null;
}

export interface HomeBriefInput extends HomePresenceInput {
  name: string;
  /** The Agent's own description, already trimmed. */
  description: string;
  awayMs: number | null;
  /** The live task summary while a run is in flight. */
  liveSummary: string;
}

export interface HomeBrief {
  /** The display line: a time-of-day hello, or an introduction on first meeting. */
  hello: string;
  /** One sentence in Momo's voice about where things stand. */
  say: string;
}

export function homeBrief(input: HomeBriefInput, copy: Translation): HomeBrief {
  const hello =
    input.sessionCount === 0
      ? fill(copy.homeHelloWelcome, { name: input.name })
      : copy[HOME_HELLO[homeGreeting(input.hour)]];
  const summary = input.activityStatus === "working" ? input.liveSummary : "";
  const updates = homeUpdates(input, copy);
  const say = [summary, updates].filter(Boolean).join(" · ") || input.description || copy.homeGreeting;
  if (input.awayMs === null) return { hello, say };
  const duration = awayDuration(input.awayMs, copy);
  const prefix = updates && !summary ? copy.homeAwayPrefix : copy.homeAwaySentence;
  return { hello, say: fill(prefix, { duration }) + say };
}

function homeUpdates(input: HomeBriefInput, copy: Translation): string {
  const doneWords = { doneThings: input.doneCount === 1 ? copy.homeThingOne : copy.homeThings };
  const decisionWords = { decisionThings: input.decisionCount === 1 ? copy.homeThingOne : copy.homeThings };
  const plurals = { ...doneWords, ...decisionWords, need: input.decisionCount === 1 ? copy.homeNeedOne : copy.homeNeedMany };
  const failed =
    input.failedCount > 0
      ? fill(copy.homeBriefFailedSuffix, { failed: String(input.failedCount), failedThings: input.failedCount === 1 ? copy.homeThingOne : copy.homeThings })
      : "";
  if (input.decisionCount > 0) {
    const head =
      input.doneCount > 0
        ? fill(copy.homeBriefMixed, { done: String(input.doneCount), decisions: String(input.decisionCount), ...plurals })
        : fill(copy.homeBriefDecisions, { decisions: String(input.decisionCount), ...plurals });
    return head + failed;
  }
  if (input.doneCount > 0) return fill(copy.homeBriefReady, { done: String(input.doneCount), ...plurals }) + failed;
  if (input.failedCount > 0) return fill(copy.homeBriefFailed, { failed: String(input.failedCount), failedThings: input.failedCount === 1 ? copy.homeThingOne : copy.homeThings });
  return "";
}

function awayDuration(awayMs: number, copy: Translation): string {
  const hours = Math.round(awayMs / 3_600_000);
  if (hours < 24) return fill(copy.homeAwayHours, { count: String(Math.max(1, hours)) });
  return fill(copy.homeAwayDays, { count: String(Math.round(hours / 24)) });
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
