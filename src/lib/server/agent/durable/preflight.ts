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
  degraded?: boolean;
}

export interface DurablePreflightResult extends DurablePreflightDecision {
  sideEffectClass: Exclude<SideEffectClass, "pure">;
  evaluated: boolean;
  preflightIndex?: number;
}

export type DurablePreflightEvaluator = (input: DurablePreflightInput) => Promise<DurablePreflightDecision>;

export class DurableExecutionPromotionHandoff extends Error {
  constructor(readonly notice: string) {
    super(notice);
    this.name = "DurableExecutionPromotionHandoff";
  }
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
    reason: "No decision evaluator is configured for this side-effect boundary."
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
