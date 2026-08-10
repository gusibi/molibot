import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ConversationPlan } from "$lib/shared/types/message.js";

const schema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 160 }),
  summary: Type.String({ minLength: 1, maxLength: 4_000 }),
  steps: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 30 }),
  recommendedMode: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("accept_edits")]))
});

export function createExitPlanTool(options: {
  scratchDir: string;
  sessionId: string;
  emit: (plan: ConversationPlan) => Promise<void> | void;
}): AgentTool<typeof schema> {
  return {
    name: "exitPlan",
    label: "Propose plan",
    description: "Finish read-only planning by proposing a structured plan for the user to accept, modify, or reject.",
    parameters: schema,
    execute: async (_toolCallId, params) => {
      const id = `plan-${Date.now().toString(36)}`;
      const artifactPath = `plans/${options.sessionId}-${id}.md`;
      const plan: ConversationPlan = {
        id,
        title: params.title.trim(),
        summary: params.summary.trim(),
        steps: params.steps.map((text, index) => ({ id: `${id}-${index + 1}`, text: text.trim(), status: "pending" })),
        status: "proposed",
        recommendedMode: params.recommendedMode ?? "accept_edits",
        artifactPath
      };
      const markdown = [
        `# ${plan.title}`,
        "",
        plan.summary,
        "",
        ...plan.steps.map((step, index) => `${index + 1}. [ ] ${step.text}`),
        ""
      ].join("\n");
      const absolute = join(options.scratchDir, artifactPath);
      await fs.mkdir(join(options.scratchDir, "plans"), { recursive: true });
      await fs.writeFile(absolute, markdown, "utf8");
      await options.emit(plan);
      return {
        content: [{ type: "text", text: `Plan proposed: ${plan.title}` }],
        details: { plan },
        terminate: true
      };
    }
  };
}
