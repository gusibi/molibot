import { assessMemoryWrite } from "./classifier.js";
import { chatNamespace, namespaceForDomain } from "./namespaces.js";
import { normalizeMemorySubject } from "./memoryIdentity.js";
import type {
  MemoryAddInput,
  MemoryCandidate,
  MemoryCandidateCreateInput,
  MemoryDomain,
  MemoryLayer,
  MemoryRecord,
  MemoryScope,
  MemorySemanticType,
  MemorySourceRef
} from "./types.js";

/**
 * The single write policy for extracted memories. Callers hand over what an
 * extractor proposed; this class decides commit vs. proposal and never lets
 * the read path see two versions of the same subject.
 */
export interface ExtractedMemoryItem {
  domain: MemoryDomain;
  type: MemorySemanticType;
  subject: string;
  value: string;
  confidence?: number;
  reason?: string;
  /** The extractor's own judgement; the deterministic check below can only add to it. */
  sensitivity?: "normal" | "sensitive";
  /** An existing subject this statement corrects; wins over the proposed subject. */
  supersedesSubject?: string;
}

export interface MemoryWriteResult {
  committed: string[];
  proposals: string[];
  skipped: number;
  failures: string[];
}

export interface MemoryWriterPort {
  write(
    scope: MemoryScope,
    items: ExtractedMemoryItem[],
    sources: MemorySourceRef[],
    runKey: string
  ): Promise<MemoryWriteResult>;
}

export interface MemoryWriterGateway {
  add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord | null>;
  createScopedCandidate(scope: MemoryScope, input: MemoryCandidateCreateInput): MemoryCandidate | null;
  isPrivacySuppressed(
    input: Pick<MemoryCandidateCreateInput, "namespace" | "domain" | "type" | "subject" | "value">
  ): boolean;
}

/**
 * Health, location, identity, relationships and other facts a person may not
 * want an assistant to volunteer. These become proposals instead of active
 * records; the extractor's `sensitivity` flag can only widen this set.
 */
const SENSITIVE_FACT = /(?:health|medical|disease|illness|diagnos|medication|allerg|disabilit|home address|residential address|passport|religion|politic|sexual|divorce|salary|income|健康|疾病|生病|药物|吃药|服药|用药|医院|过敏|抑郁|焦虑|心理|残疾|住址|家庭住址|护照|宗教|政治|性取向|离婚|工资|收入|存款)/i;

export const normalizeSubject = normalizeMemorySubject;

export function isSensitiveMemory(item: {
  subject: string;
  value: string;
  sensitivity?: string;
}): boolean {
  if (item.sensitivity === "sensitive") return true;
  return SENSITIVE_FACT.test(`${item.subject} ${item.value}`);
}

export class MemoryWriter implements MemoryWriterPort {
  constructor(private readonly gateway: MemoryWriterGateway) {}

  async write(
    scope: MemoryScope,
    items: ExtractedMemoryItem[],
    sources: MemorySourceRef[],
    runKey: string
  ): Promise<MemoryWriteResult> {
    const committed: string[] = [];
    const proposals: string[] = [];
    const failures: string[] = [];
    let skipped = 0;

    for (const item of items) {
      const subject = normalizeSubject(item.subject);
      const value = String(item.value ?? "").replace(/\s+/g, " ").trim();
      if (!subject || !value) {
        failures.push("Malformed extraction item: subject and value are required.");
        continue;
      }

      const layer = layerFor(item);
      const assessed = assessMemoryWrite({
        content: value,
        tags: [],
        layer,
        type: item.type,
        subject
      }, { minContentLength: 2 });
      if (!assessed.allowed) {
        skipped += 1;
        continue;
      }

      // A domain the session cannot address is a routing mistake, not a
      // transient failure: skipping it keeps the rest of the Session moving.
      if ((item.domain === "project" && !scope.projectId)
        || (item.domain === "agent_self" && !scope.agentId)) {
        skipped += 1;
        continue;
      }

      let namespace;
      try {
        // An Agent that opted out of shared owner memory keeps its facts in the
        // current chat instead of writing somewhere it cannot read back.
        namespace = item.domain === "owner" && scope.shareOwner === false
          ? chatNamespace(scope)
          : namespaceForDomain(scope, item.domain);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        continue;
      }

      const sensitive = isSensitiveMemory({ subject, value, sensitivity: item.sensitivity });
      const candidateInput = {
        namespace,
        domain: item.domain,
        type: item.type,
        subject,
        path: `mory://${item.type}/${subject}`,
        value,
        confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
        reason: item.reason?.trim() || "auto-extract",
        sources,
        layer,
        runKey
      } satisfies MemoryCandidateCreateInput;

      if (this.gateway.isPrivacySuppressed({ namespace, domain: item.domain, type: item.type, subject, value })) {
        skipped += 1;
        continue;
      }

      if (sensitive) {
        try {
          const created = this.gateway.createScopedCandidate(scope, candidateInput);
          if (created) proposals.push(created.id);
          else failures.push(`Candidate creation was rejected for ${subject}.`);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
        continue;
      }

      try {
        const record = await this.gateway.add(scope, {
          content: value,
          namespace,
          domain: item.domain,
          type: item.type,
          subject,
          confidence: candidateInput.confidence,
          reason: candidateInput.reason,
          sources,
          layer: candidateInput.layer
        });
        if (record) committed.push(record.id);
        else failures.push(`Memory was disabled while writing ${subject}.`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { committed, proposals, skipped, failures };
  }
}

function layerFor(item: ExtractedMemoryItem): MemoryLayer {
  return item.type === "event" ? "daily" : "long_term";
}
