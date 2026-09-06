import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const schema = Type.Object({
  steps: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 160 }),
    status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("blocked")])
  }), { maxItems: 30 }),
  status: Type.Union([Type.Literal("executing"), Type.Literal("waiting_review"), Type.Literal("completed"), Type.Literal("blocked"), Type.Literal("waiting_for_user")]),
  summary: Type.String({ minLength: 1, maxLength: 2000 })
});

export type PlanProgressUpdate = Static<typeof schema>;
export interface SessionPlanProgress {
  description: string;
  update: (input: PlanProgressUpdate) => Promise<void>;
}

export function createUpdatePlanTool(progress: SessionPlanProgress): AgentTool<typeof schema> {
  return {
    name: "updatePlan",
    label: "Update plan progress",
    description: `Track this Session's approved plan. Call when starting or finishing a step. Report actual work only; completed requires every step and verification to be finished. Use waiting_review only when human review is necessary. Explain results and any questions in your normal response.`,
    parameters: schema,
    execute: async (_id, input) => {
      await progress.update(input);
      return { content: [{ type: "text", text: input.summary }], details: {} };
    }
  };
}
