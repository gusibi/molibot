import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { Context, Model } from "@earendil-works/pi-ai";
import { streamWithPiRuntime } from "$lib/server/providers/piRuntime.js";
import type { AcceptanceCriterionInput } from "./types.js";
import type { SideEffectClass } from "./types.js";
import type { ToolSideEffect } from "$lib/server/agent/tools/toolTypes.js";

const TIER_ORDER: Record<SideEffectClass, number> = {
  pure: 0,
  idempotent: 1,
  queryable: 2,
  non_idempotent: 3
};

export interface DurablePreflightInput {
  message: string;
  effect: ToolSideEffect;
}

export interface DurablePreflightDecision {
  mode: "ordinary" | "promote";
  reason: string;
  goal?: string;
  acceptanceCriteria?: AcceptanceCriterionInput[];
  expectedWait?: "none" | "user" | "approval" | "unknown";
  sideEffectRisk?: string;
}

export interface DurablePreflightResult extends DurablePreflightDecision {
  sideEffectClass: Exclude<SideEffectClass, "pure">;
  evaluated: boolean;
  preflightIndex?: number;
}

export type DurablePreflightEvaluator = (input: DurablePreflightInput) => Promise<DurablePreflightDecision>;

export interface DurablePreflightModelOptions {
  model: Model<any>;
  streamFn?: StreamFn;
  signal?: AbortSignal;
  maxTokens?: number;
}

export class DurableExecutionPromotionHandoff extends Error {
  constructor(readonly notice: string) {
    super(notice);
    this.name = "DurableExecutionPromotionHandoff";
  }
}

const PREFLIGHT_SYSTEM_PROMPT = [
  "You are a safety preflight for a local Agent runtime.",
  "Decide whether the user's work should be promoted from an ordinary Run to a persistent Durable Execution before the next side effect.",
  "Promote only when the request clearly needs multiple dependent steps, another session, waiting for a person or approval, recovery after interruption, or a risky non-idempotent external effect.",
  "Do not promote a one-off lookup or a simple isolated edit merely because a tool has an effect.",
  "Return JSON only, with no Markdown and no commentary.",
  "The JSON shape is: {mode:'ordinary'|'promote', reason:string, goal?:string, acceptanceCriteria?:[{description:string, required?:boolean, checkerType:'deterministic'|'subjective', checkerKey?:string}], expectedWait:'none'|'user'|'approval'|'unknown', sideEffectRisk:string}.",
  "If mode is promote, goal and at least one acceptance criterion are required. Criteria must be concrete and honest; use subjective when no deterministic checker is known."
].join("\n");

function extractText(event: Record<string, unknown>): string {
  if (event.type === "text_delta") return String(event.delta ?? "");
  if (event.type === "text_end") return String(event.content ?? "");
  return "";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function textValue(value: unknown): string | undefined {
  const result = typeof value === "string" ? value.trim() : "";
  return result || undefined;
}

function parseCriteria(value: unknown): AcceptanceCriterionInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const criteria = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const description = textValue(row.description);
    if (!description) return [];
    const checkerType: AcceptanceCriterionInput["checkerType"] = row.checkerType === "deterministic" ? "deterministic" : "subjective";
    const checkerKey = textValue(row.checkerKey);
    return [{
      description,
      required: row.required !== false,
      checkerType,
      ...(checkerKey ? { checkerKey } : {}),
      author: "model" as const
    }];
  });
  return criteria.length > 0 ? criteria : undefined;
}

/**
 * Run the bounded structured model check used at the first non-pure boundary.
 * A malformed or unavailable preflight fails open to the ordinary path; the
 * deterministic activation path handles requests that are explicitly long-lived.
 */
export async function evaluateDurablePreflightWithModel(
  input: DurablePreflightInput,
  options: DurablePreflightModelOptions
): Promise<DurablePreflightDecision> {
  const context = {
    systemPrompt: PREFLIGHT_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: JSON.stringify({
          request: input.message,
          nextTool: {
            id: input.effect.toolId,
            sideEffectClass: input.effect.sideEffectClass,
            target: input.effect.targetSummary,
            content: input.effect.contentSummary
          }
        })
      }],
      timestamp: Date.now()
    }] as AgentMessage[],
    tools: []
  } as unknown as Context;

  let output = "";
  try {
    const stream = (options.streamFn ?? streamWithPiRuntime)(
      options.model,
      context,
      { maxTokens: Math.max(128, Math.round(options.maxTokens ?? 320)), signal: options.signal } as never
    );
    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      output += extractText(event);
      if (event.type === "error") {
        return { mode: "ordinary", reason: "Durable preflight model returned an error; the ordinary Run remains in control." };
      }
      if (event.type === "done") {
        const message = event.message as { stopReason?: string } | undefined;
        if (message?.stopReason === "error") {
          return { mode: "ordinary", reason: "Durable preflight model did not complete; the ordinary Run remains in control." };
        }
      }
    }
  } catch {
    return { mode: "ordinary", reason: "Durable preflight model was unavailable; the ordinary Run remains in control." };
  }

  const parsed = parseJsonObject(output);
  if (!parsed || (parsed.mode !== "ordinary" && parsed.mode !== "promote")) {
    return { mode: "ordinary", reason: "Durable preflight returned invalid structured output; the ordinary Run remains in control." };
  }
  const reason = textValue(parsed.reason) ?? "The preflight model did not provide a reason.";
  const expectedWait = parsed.expectedWait === "user" || parsed.expectedWait === "approval" || parsed.expectedWait === "unknown"
    ? parsed.expectedWait
    : "none";
  const sideEffectRisk = textValue(parsed.sideEffectRisk);
  const goal = textValue(parsed.goal);
  const acceptanceCriteria = parseCriteria(parsed.acceptanceCriteria);
  if (parsed.mode === "promote" && (!goal || !acceptanceCriteria)) {
    return { mode: "ordinary", reason: "Durable preflight omitted the goal or acceptance criteria required for promotion." };
  }
  return {
    mode: parsed.mode,
    reason,
    ...(goal ? { goal } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    expectedWait,
    ...(sideEffectRisk ? { sideEffectRisk } : {})
  };
}

/**
 * Bounds lazy-promotion decisions by side-effect tier. The same tier is
 * evaluated once per ordinary Run; encountering a higher tier always gets a
 * fresh decision. A pure tool never reaches this object.
 */
export class DurablePreflightTracker {
  private readonly evaluated = new Set<Exclude<SideEffectClass, "pure">>();
  private count = 0;

  constructor(private readonly evaluator: DurablePreflightEvaluator = async () => ({
    mode: "ordinary",
    reason: "No deterministic durable signal was present at this side-effect boundary."
  })) {}

  async evaluate(input: DurablePreflightInput): Promise<DurablePreflightResult> {
    const sideEffectClass = input.effect.sideEffectClass;
    if (sideEffectClass === "pure") {
      throw new Error("Pure tools do not require a Durable preflight.");
    }
    if (this.evaluated.has(sideEffectClass)) {
      return {
        mode: "ordinary",
        reason: "This side-effect tier was already evaluated for the current Run.",
        sideEffectClass,
        evaluated: false
      };
    }

    // Keep the ranking explicit beside the set-based cap. This guards future
    // callers from accidentally treating a lower-tier repeat as a new tier.
    const highestTier = [...this.evaluated].reduce((max, value) => Math.max(max, TIER_ORDER[value]), 0);
    if (TIER_ORDER[sideEffectClass] <= highestTier && this.evaluated.size > 0) {
      return {
        mode: "ordinary",
        reason: "A lower side-effect tier was already evaluated for the current Run.",
        sideEffectClass,
        evaluated: false
      };
    }

    this.evaluated.add(sideEffectClass);
    this.count += 1;
    const decision = await this.evaluator(input);
    return {
      ...decision,
      sideEffectClass,
      evaluated: true,
      preflightIndex: this.count
    };
  }

  get countEvaluated(): number {
    return this.count;
  }
}
