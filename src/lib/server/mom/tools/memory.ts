import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MemoryGateway } from "../../memory/gateway.js";

const memorySchema = Type.Object({
  action: Type.Union([
    Type.Literal("add"),
    Type.Literal("search"),
    Type.Literal("list"),
    Type.Literal("update"),
    Type.Literal("delete"),
    Type.Literal("flush"),
    Type.Literal("sync")
  ]),
  content: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  layer: Type.Optional(Type.Union([Type.Literal("long_term"), Type.Literal("daily")])),
  expiresAt: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number())
});

type MemoryAction = "add" | "search" | "list" | "update" | "delete" | "flush" | "sync";



export function createMemoryTool(options: {
  memory: MemoryGateway;
  channel: string;
  chatId: string;
}): AgentTool<typeof memorySchema> {
  return {
    name: "memory",
    label: "memory",
    description:
      "Manage memory via gateway. Use this instead of reading/writing MEMORY.md files directly. WARNING: DO NOT use this tool for scheduling reminders or future tasks, use create_event tool instead.",
    parameters: memorySchema,
    execute: async (_toolCallId, params) => {
      const action = params.action as MemoryAction;
      const scope = { channel: options.channel, externalUserId: options.chatId };

      if (action === "sync") {
        const result = await options.memory.syncExternalMemories();
        return {
          content: [{ type: "text", text: `Synced memory files: scanned=${result.scannedFiles}, imported=${result.importedCount}` }],
          details: { result }
        };
      }

      if (action === "add") {
        const content = String(params.content ?? "").trim();
        if (!content) throw new Error("content is required for action=add");
        const item = await options.memory.add(scope, {
          content,
          tags: Array.isArray(params.tags) ? params.tags : [],
          layer: params.layer,
          expiresAt: typeof params.expiresAt === "string" ? params.expiresAt : undefined
        });
        return {
          content: [{ type: "text", text: `Added memory: ${item?.id ?? "(disabled)"}` }],
          details: { item }
        };
      }

      if (action === "search") {
        const rows = await options.memory.search(scope, {
          query: String(params.query ?? ""),
          limit: Number.isFinite(params.limit) ? params.limit : 20,
          mode: "hybrid"
        });
        return {
          content: [{ type: "text", text: rows.length ? rows.map((r, i) => `${i + 1}. [${r.layer}] ${r.content}`).join("\n") : "(no memory found)" }],
          details: { rows }
        };
      }

      if (action === "list") {
        const rows = await options.memory.search(scope, {
          query: "",
          limit: Number.isFinite(params.limit) ? params.limit : 100,
          mode: "recent"
        });
        return {
          content: [{ type: "text", text: rows.length ? rows.map((r, i) => `${i + 1}. [${r.layer}] ${r.content}`).join("\n") : "(no memory found)" }],
          details: { rows }
        };
      }

      if (action === "update") {
        const id = String(params.id ?? "").trim();
        if (!id) throw new Error("id is required for action=update");
        const item = await options.memory.update(scope, id, {
          content: typeof params.content === "string" ? params.content : undefined,
          tags: Array.isArray(params.tags) ? params.tags : undefined,
          expiresAt: typeof params.expiresAt === "string" ? params.expiresAt : undefined
        });
        return {
          content: [{ type: "text", text: item ? `Updated memory: ${item.id}` : "Memory not found" }],
          details: { item }
        };
      }

      if (action === "delete") {
        const id = String(params.id ?? "").trim();
        if (!id) throw new Error("id is required for action=delete");
        const deleted = await options.memory.delete(scope, id);
        return {
          content: [{ type: "text", text: deleted ? `Deleted memory: ${id}` : "Memory not found" }],
          details: { deleted }
        };
      }

      if (action === "flush") {
        const result = await options.memory.flush(scope);
        return {
          content: [{ type: "text", text: `Flush complete: scanned=${result.scannedMessages}, added=${result.addedCount}` }],
          details: { result }
        };
      }

      throw new Error(`Unsupported action: ${action}`);
    }
  };
}
