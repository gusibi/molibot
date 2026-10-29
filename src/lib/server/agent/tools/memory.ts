import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { MemoryDomain, MemoryScope } from "$lib/server/memory/types.js";
import { MemoryWriter, normalizeSubject } from "$lib/server/memory/memoryWriter.js";

export interface MemoryToolOptions {
  memory: MemoryGateway;
  scope: MemoryScope;
  writesAllowed?: boolean;
}

const saveMemorySchema = Type.Object({
  fact: Type.String({
    description: "Complete durable fact or preference to remember, in the user's language."
  }),
  subject: Type.Optional(Type.String({
    description: "Stable slot such as user.employer. Reuse the subject returned by recall_memory when correcting that fact."
  })),
  about: Type.Optional(Type.Union([
    Type.Literal("user"),
    Type.Literal("agent"),
    Type.Literal("project")
  ], {
    description: "Who the fact is about. Defaults to user."
  }))
});

const recallMemorySchema = Type.Object({
  query: Type.String({
    description: "What to look up, in natural language."
  }),
  limit: Type.Optional(Type.Number({
    description: "Maximum results, 1-50. Defaults to 10."
  }))
});

const forgetMemorySchema = Type.Object({
  id: Type.String({
    description: "Memory id returned by recall_memory."
  })
});

function errorResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
    isError: true
  };
}

function sourcesFor(scope: MemoryScope, toolCallId: string) {
  return [{
    channel: scope.channel,
    sessionId: scope.conversationId ?? scope.externalUserId,
    conversationMessageId: toolCallId
  }];
}

export function createSaveMemoryTool(options: MemoryToolOptions): AgentTool<typeof saveMemorySchema> {
  const writer = new MemoryWriter(options.memory);
  return {
    name: "save_memory",
    label: "save memory",
    description: [
      "Remember one durable fact or preference. Use when the user asks you to remember something,",
      "or states a stable fact that should survive this conversation.",
      "",
      "To correct an existing fact, call recall_memory first and reuse the subject it returns.",
      "Sensitive facts (health, medication, allergies, location, identity, relationships, income)",
      "are saved as proposals for the user to confirm instead of becoming immediately active.",
      "",
      "Never use this for reminders, schedules, or future tasks; use runtimeTask for those."
    ].join("\n"),
    parameters: saveMemorySchema,
    execute: async (toolCallId, params) => {
      if (options.writesAllowed === false) {
        return errorResult("This turn is not eligible for memory writes. recall_memory and forget_memory remain available.");
      }
      const fact = String(params.fact ?? "").trim();
      if (!fact) return errorResult("fact is required");
      const about = params.about ?? "user";
      if (about === "project" && !options.scope.projectId) {
        return errorResult("Project memory requires a project session.");
      }
      if (about === "agent" && !options.scope.agentId) {
        return errorResult("Agent self-knowledge requires an Agent identity.");
      }
      const domain: MemoryDomain = about === "agent" ? "agent_self" : about === "project" ? "project" : "owner";
      const subject = String(params.subject ?? "").trim() || normalizeSubject(fact);
      const result = await writer.write(
        options.scope,
        [{ domain, type: "user_fact", subject, value: fact, reason: "user_explicit" }],
        sourcesFor(options.scope, toolCallId),
        `save:${toolCallId}`
      );
      if (result.failures.length > 0) {
        return errorResult(`Memory not saved: ${result.failures.join("；")}`, { result });
      }
      if (result.proposals.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Saved as a pending proposal because it is sensitive: ${result.proposals[0]}`
          }],
          details: { proposalId: result.proposals[0], result }
        };
      }
      const id = result.committed[0];
      if (!id) return errorResult("Memory was not saved.", { result });
      const item = await options.memory.getForGovernance(options.scope, id);
      return {
        content: [{ type: "text" as const, text: `Saved memory ${id} (subject: ${subject})` }],
        details: { item, result }
      };
    }
  };
}

export function createRecallMemoryTool(options: MemoryToolOptions): AgentTool<typeof recallMemorySchema> {
  return {
    name: "recall_memory",
    label: "recall memory",
    description: [
      "Find memories relevant to a query. Returns each memory's id, subject, and content.",
      "Use the returned id with forget_memory, and reuse the subject when correcting the fact."
    ].join("\n"),
    parameters: recallMemorySchema,
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "").trim();
      if (!query) return errorResult("query is required");
      const limit = Number.isFinite(params.limit)
        ? Math.max(1, Math.min(50, Number(params.limit)))
        : 10;
      const rows = await options.memory.search(options.scope, { query, limit, mode: "hybrid" });
      const text = rows.length
        ? rows.map((row, index) => (
            `${index + 1}. id=${row.id} subject=${row.subject ?? "-"} ${row.content}`
          )).join("\n")
        : "(no memory found)";
      return {
        content: [{ type: "text" as const, text }],
        details: { rows }
      };
    }
  };
}

export function createForgetMemoryTool(options: MemoryToolOptions): AgentTool<typeof forgetMemorySchema> {
  return {
    name: "forget_memory",
    label: "forget memory",
    description: [
      "Delete one memory by id. Get the id from recall_memory.",
      "This is for a fact the user wants forgotten, not for reminders or schedules."
    ].join("\n"),
    parameters: forgetMemorySchema,
    execute: async (_toolCallId, params) => {
      const id = String(params.id ?? "").trim();
      if (!id) return errorResult("id is required");
      const deleted = await options.memory.forget(options.scope, id, { reason: "user_forget" });
      return {
        content: [{
          type: "text" as const,
          text: deleted ? `Forgotten memory ${id}` : "Memory not found"
        }],
        details: { deleted }
      };
    }
  };
}

/** All model-facing memory tools; maintenance and the content corpus are not here. */
export function createMemoryTools(options: MemoryToolOptions): AgentTool<any>[] {
  return [
    createSaveMemoryTool(options),
    createRecallMemoryTool(options),
    createForgetMemoryTool(options)
  ];
}
