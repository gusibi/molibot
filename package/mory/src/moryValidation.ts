/**
 * moryValidation.ts
 *
 * Strict validation for LLM extraction payloads -> CanonicalMemory.
 */

import {
  ALL_MEMORY_TYPES,
  defaultPolicyFor,
  type CanonicalMemory,
  type MemoryType,
  type UpdatePolicy,
} from "./morySchema.js";
import { normalizeMoryPath } from "./moryPath.js";
import { isCanonicalMoryPath } from "./moryPath.js";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface CanonicalValidationResult {
  ok: boolean;
  memory?: CanonicalMemory;
  issues: ValidationIssue[];
}

export interface ExtractionPayload {
  memories: unknown[];
}

export interface ExtractionValidationOptions {
  source?: string;
  observedAt?: string;
  strictPath?: boolean;
}

const UPDATE_POLICIES: UpdatePolicy[] = [
  "overwrite",
  "merge_append",
  "highest_confidence",
  "skip",
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferTypeFromPath(path: string): MemoryType {
  const raw = path.slice("mory://".length).split("/")[0];
  if (ALL_MEMORY_TYPES.includes(raw as MemoryType)) return raw as MemoryType;
  return "world_knowledge";
}

function toStringSafe(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function validateCanonicalMemory(
  raw: unknown,
  options: ExtractionValidationOptions = {}
): CanonicalValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [{ field: "memory", message: "memory must be an object" }],
    };
  }

  const pathRaw = toStringSafe(raw.path ?? raw.moryPath);
  const typeRaw = toStringSafe(raw.type);
  const subjectRaw = toStringSafe(raw.subject);
  const valueRaw = toStringSafe(raw.value ?? raw.summary ?? raw.content);
  const confidenceRaw = Number(raw.confidence ?? 0.7);

  if (!valueRaw) issues.push({ field: "value", message: "value is required" });

  let path = pathRaw ? normalizeMoryPath(pathRaw) : "";
  if (!path) {
    const inferredType = ALL_MEMORY_TYPES.includes(typeRaw as MemoryType)
      ? (typeRaw as MemoryType)
      : "world_knowledge";
    const subject = subjectRaw || "unknown";
    path = normalizeMoryPath(`mory://${inferredType}/${subject}`);
  }

  if (options.strictPath && !isCanonicalMoryPath(path)) {
    issues.push({ field: "path", message: `path is not canonical: ${path}` });
  }

  const type: MemoryType = ALL_MEMORY_TYPES.includes(typeRaw as MemoryType)
    ? (typeRaw as MemoryType)
    : inferTypeFromPath(path);

  const subject = subjectRaw || path.split("/").pop() || "unknown";
  const policyRaw = toStringSafe(raw.updatedPolicy);
  const updatedPolicy = UPDATE_POLICIES.includes(policyRaw as UpdatePolicy)
    ? (policyRaw as UpdatePolicy)
    : defaultPolicyFor(path);

  if (!UPDATE_POLICIES.includes(updatedPolicy)) {
    issues.push({ field: "updatedPolicy", message: "invalid update policy" });
  }

  const confidence = clamp01(confidenceRaw);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const memory: CanonicalMemory = {
    path,
    type,
    subject,
    value: valueRaw,
    confidence,
    updatedPolicy,
    source: options.source,
    observedAt: options.observedAt,
    title: toStringSafe(raw.title) || undefined,
    importance:
      typeof raw.importance === "number" ? clamp01(raw.importance as number) : undefined,
    utility: typeof raw.utility === "number" ? clamp01(raw.utility as number) : undefined,
  };

  return { ok: true, memory, issues };
}

export function validateExtractionPayload(
  payload: unknown,
  options: ExtractionValidationOptions = {}
): { memories: CanonicalMemory[]; issues: ValidationIssue[] } {
  if (!isPlainObject(payload) || !Array.isArray(payload.memories)) {
    return {
      memories: [],
      issues: [{ field: "memories", message: "payload.memories must be an array" }],
    };
  }

  const memories: CanonicalMemory[] = [];
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < payload.memories.length; i++) {
    const res = validateCanonicalMemory(payload.memories[i], options);
    if (res.ok && res.memory) {
      memories.push(res.memory);
    } else {
      for (const issue of res.issues) {
        issues.push({
          field: `memories[${i}].${issue.field}`,
          message: issue.message,
        });
      }
    }
  }

  return { memories, issues };
}

export function parseExtractionJson(text: string): ExtractionPayload {
  const parsed = JSON.parse(text) as ExtractionPayload;
  if (!parsed || !Array.isArray(parsed.memories)) {
    throw new Error("Extraction JSON must contain an array field: memories");
  }
  return parsed;
}
