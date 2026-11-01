import type {
  DesktopBriefingDisplay,
  DesktopDeliveryDisplay,
  DesktopDeliveryReceipt,
  DesktopDeliverySourceReference,
  DesktopDocumentDisplay,
  DesktopTopicCandidate,
  DesktopTopicProposalsDisplay
} from "$lib/shared/desktop.js";

/**
 * Delivery display is declared by whoever finishes the task, never inferred
 * from the model's prose. The read model validates every field again so an old
 * or malformed task file cannot break the whole page.
 */

const LIMITS = {
  title: 160,
  introduction: 600,
  takeaway: 500,
  label: 120,
  url: 1000,
  angle: 400,
  rationale: 400,
  outline: 180,
  material: 300,
  summary: 600,
  bodyPreview: 1600,
  artifactPath: 400,
  detail: 240,
  id: 120
} as const;

const MAX_HIGHLIGHTS = 3;
const MAX_CANDIDATES = 5;
const MAX_OUTLINE = 4;
const MAX_MATERIALS = 5;
const MAX_SOURCES = 3;

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function clipped(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function preservedLines(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!text) return undefined;
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function httpUrl(value: unknown): string | undefined {
  const text = clipped(value, LIMITS.url);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sourcesOf(value: unknown): DesktopDeliverySourceReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources = value.flatMap<DesktopDeliverySourceReference>((entry) => {
    const source = recordOf(entry);
    const label = clipped(source?.label, LIMITS.label);
    if (!label) return [];
    const url = httpUrl(source?.url);
    return [{ label, ...(url ? { url } : {}) }];
  }).slice(0, MAX_SOURCES);
  return sources.length ? sources : undefined;
}

function briefingOf(value: Record<string, unknown>): DesktopBriefingDisplay | undefined {
  const title = clipped(value.title, LIMITS.title);
  if (!title) return undefined;
  const highlights = Array.isArray(value.highlights)
    ? value.highlights.flatMap((entry) => {
        const highlight = recordOf(entry);
        const highlightTitle = clipped(highlight?.title, LIMITS.title);
        const takeaway = clipped(highlight?.takeaway, LIMITS.takeaway);
        if (!highlightTitle || !takeaway) return [];
        const sources = sourcesOf(highlight?.sources);
        return [{ title: highlightTitle, takeaway, ...(sources ? { sources } : {}) }];
      }).slice(0, MAX_HIGHLIGHTS)
    : [];
  const introduction = clipped(value.introduction, LIMITS.introduction);
  const bodyPreview = preservedLines(value.bodyPreview, LIMITS.bodyPreview);
  const artifactPath = clipped(value.artifactPath, LIMITS.artifactPath);
  return {
    type: "briefing",
    title,
    ...(introduction ? { introduction } : {}),
    highlights,
    ...(bodyPreview ? { bodyPreview } : {}),
    ...(artifactPath ? { artifactPath } : {})
  };
}

function candidatesOf(value: unknown): DesktopTopicCandidate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const candidate = recordOf(entry);
    const id = clipped(candidate?.id, LIMITS.id);
    const title = clipped(candidate?.title, LIMITS.title);
    const angle = clipped(candidate?.angle, LIMITS.angle);
    if (!id || !title || !angle || seen.has(id)) return [];
    seen.add(id);
    const rationale = clipped(candidate?.rationale, LIMITS.rationale);
    const outline = Array.isArray(candidate?.outline)
      ? candidate.outline.flatMap((line) => {
          const text = clipped(line, LIMITS.outline);
          return text ? [text] : [];
        }).slice(0, MAX_OUTLINE)
      : [];
    const materials = Array.isArray(candidate?.materials)
      ? candidate.materials.flatMap((line) => {
          const text = clipped(line, LIMITS.material);
          return text ? [text] : [];
        }).slice(0, MAX_MATERIALS)
      : [];
    const sources = sourcesOf(candidate?.sources);
    return [{
      id,
      title,
      angle,
      ...(rationale ? { rationale } : {}),
      ...(outline.length ? { outline } : {}),
      ...(materials.length ? { materials } : {}),
      ...(sources ? { sources } : {})
    }];
  }).slice(0, MAX_CANDIDATES);
}

function topicProposalsOf(value: Record<string, unknown>): DesktopTopicProposalsDisplay | undefined {
  const title = clipped(value.title, LIMITS.title);
  const candidates = candidatesOf(value.candidates);
  if (!title || candidates.length === 0) return undefined;
  const requested = clipped(value.recommendedCandidateId, LIMITS.id);
  const recommendedCandidateId = requested && candidates.some((candidate) => candidate.id === requested)
    ? requested
    : undefined;
  return {
    type: "topic-proposals",
    title,
    candidates,
    ...(recommendedCandidateId ? { recommendedCandidateId } : {})
  };
}

function documentOf(value: Record<string, unknown>): DesktopDocumentDisplay | undefined {
  const title = clipped(value.title, LIMITS.title);
  if (!title) return undefined;
  const summary = clipped(value.summary, LIMITS.summary);
  const artifactPath = clipped(value.artifactPath, LIMITS.artifactPath);
  return {
    type: "document",
    title,
    ...(summary ? { summary } : {}),
    ...(artifactPath ? { artifactPath } : {})
  };
}

function genericOf(value: Record<string, unknown>): DesktopDeliveryDisplay | undefined {
  const title = clipped(value.title, LIMITS.title);
  const summary = clipped(value.summary, LIMITS.summary);
  const artifactPath = clipped(value.artifactPath, LIMITS.artifactPath);
  if (!title && !summary && !artifactPath) return undefined;
  return {
    type: "generic",
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(artifactPath ? { artifactPath } : {})
  };
}

export function normalizeDeliveryDisplay(value: unknown): DesktopDeliveryDisplay | undefined {
  const record = recordOf(value);
  if (!record) return undefined;
  switch (record.type) {
    case "briefing": return briefingOf(record);
    case "topic-proposals": return topicProposalsOf(record);
    case "document": return documentOf(record);
    case "generic": return genericOf(record);
    default: return undefined;
  }
}

export function normalizeDeliveryReceipt(value: unknown): DesktopDeliveryReceipt | undefined {
  const record = recordOf(value);
  if (!record) return undefined;
  const status = record.status;
  if (status !== "delivered" && status !== "failed" && status !== "unknown" && status !== "not_required") return undefined;
  const channel = clipped(record.channel, LIMITS.label);
  const at = clipped(record.at, LIMITS.label);
  const detail = clipped(record.detail, LIMITS.detail);
  return {
    status,
    ...(channel ? { channel } : {}),
    ...(at ? { at } : {}),
    ...(detail ? { detail } : {})
  };
}

/**
 * Completion is the moment the delivery claim becomes true: the channel send
 * returned without throwing. The runtime, not the generated content, stamps it.
 */
export function taskResultWithDelivery(input: {
  result?: unknown;
  display?: unknown;
  channel?: string;
  finishedAt: string;
}): unknown {
  const display = normalizeDeliveryDisplay(input.display);
  const channel = String(input.channel ?? "").trim() || undefined;
  const inApp = !channel || channel === "web" || channel === "project" || channel === "system";
  const delivery: DesktopDeliveryReceipt = {
    status: inApp ? "not_required" : "delivered",
    ...(channel ? { channel } : {}),
    at: input.finishedAt
  };
  const base = recordOf(input.result);
  if (base) return { ...base, ...(display ? { display } : {}), delivery };
  if (input.result === undefined) {
    return { ...(display ? { display } : {}), delivery };
  }
  return { text: String(input.result), ...(display ? { display } : {}), delivery };
}
