import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { MemoryScope } from "$lib/server/memory/types.js";

const memorySchema = Type.Object({
  action: Type.Union([
    Type.Literal("add"),
    Type.Literal("search"),
    Type.Literal("list"),
    Type.Literal("update"),
    Type.Literal("delete"),
    Type.Literal("flush"),
    Type.Literal("sync"),
    Type.Literal("compact"),
    Type.Literal("search_content"),
    Type.Literal("add_content"),
    Type.Literal("set_agent_self")
  ]),
  content: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  allScopes: Type.Optional(Type.Boolean()),
  tags: Type.Optional(Type.Array(Type.String())),
  layer: Type.Optional(Type.Union([Type.Literal("long_term"), Type.Literal("daily")])),
  expiresAt: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
  botId: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  subject: Type.Optional(Type.String())
});

type MemoryAction = "add" | "search" | "list" | "update" | "delete" | "flush" | "sync" | "compact" | "search_content" | "add_content" | "set_agent_self";



export function createMemoryTool(options: {
  memory: MemoryGateway;
  scope: MemoryScope;
  writesAllowed?: boolean;
}): AgentTool<typeof memorySchema> {
  return {
    name: "memory",
    label: "memory",
    // Every action is documented here because the names alone are misleading in
    // one specific, damaging way: `add_content` reads as "add this content" and
    // is the obvious pick for "remember this", but it writes to the published-
    // content corpus, which conversational recall never reads (prd.md §3.49).
    description: [
      "Manage long-term memory. Use this instead of reading/writing MEMORY.md files directly.",
      "",
      "To remember something about the user, use action=add. That is almost always the right one.",
      "  add           remember a fact/preference about the user; recalled automatically in later conversations",
      "  search        find remembered items (this scope)",
      "  list          list remembered items",
      "  update        change a remembered item by id",
      "  delete        remove one remembered item by id; deletion is not the same as do-not-remember",
      "  compact       deduplicate; flush persists pending writes; sync re-imports memory files",
      "",
      "NOT conversational memory — do not use these to remember things about the user:",
      "  add_content / search_content   a separate corpus of the user's PUBLISHED CONTENT, used only for",
      "                                 writing-style reference. Items written here are NEVER recalled in",
      "                                 conversation. add_content requires type=world_knowledge and rejects",
      "                                 missing/other types; use add for every user fact or preference.",
      "  set_agent_self                 facts about the agent itself, not about the user",
      "",
      "WARNING: DO NOT use this tool for scheduling reminders or future tasks; use toolSearch to load runtimeTask first."
    ].join("\n"),
    parameters: memorySchema,
    execute: async (_toolCallId, params) => {
      const action = params.action as MemoryAction;
      const scope = options.scope;
      const allScopes = Boolean(params.allScopes);
      if (options.writesAllowed === false && ["add", "update", "flush", "sync", "compact", "add_content", "set_agent_self"].includes(action)) {
        throw new Error("This turn is not eligible for memory writes. Search and explicit deletion remain available.");
      }

      if (action === "search_content") {
        const rows = await options.memory.searchContent(String(params.botId ?? scope.botId ?? "default"), { query: String(params.query ?? ""), limit: params.limit ?? 10, mode: "hybrid" });
        return { content: [{ type: "text", text: rows.length ? rows.map((row) => row.content).join("\n") : "(no similar published content)" }], details: { rows } };
      }

      if (action === "add_content" || action === "set_agent_self") {
        const content = String(params.content ?? "").trim();
        const subject = String(params.subject ?? "").trim();
        if (!content || !subject) throw new Error("content and subject are required");
        // The content corpus is write-only as far as conversation is concerned:
        // `content:<botId>` is deliberately absent from `promptMemoryNamespaces`,
        // so anything landing here can never be recalled in a later turn. It
        // used to *default* to `user_fact`, which is exactly the record type
        // that does not belong in it — and a model asked to "remember that I
        // use Obsidian" reasonably picked `add_content`, got "Saved", and the
        // fact was gone forever (prd.md §3.49).
        if (action === "add_content" && params.type !== "world_knowledge") {
          throw new Error(
            `add_content requires the explicit published-content type "world_knowledge" and writes to a corpus ` +
              `that is never recalled in conversation. To remember anything about the user, call this tool again ` +
              `with action="add".`
          );
        }
        const botId = String(params.botId ?? scope.botId ?? "default");
        const input = {
          content,
          type: (params.type ?? "task") as any,
          subject,
          reason: "user_explicit"
        };
        const item = action === "add_content" ? await options.memory.addContentMemory(botId, input) : await options.memory.setAgentSelfMemory(botId, input);
        return { content: [{ type: "text", text: `Saved ${action}: ${item?.id ?? "(disabled)"}` }], details: { item } };
      }

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
        const rows = allScopes
          ? await options.memory.searchAll({
              query: String(params.query ?? ""),
              limit: Number.isFinite(params.limit) ? params.limit : 20,
              mode: "hybrid"
            })
          : await options.memory.search(scope, {
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
        const rows = allScopes
          ? await options.memory.searchAll({
              query: "",
              limit: Number.isFinite(params.limit) ? params.limit : 100,
              mode: "recent"
            })
          : await options.memory.search(scope, {
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

      if (action === "compact") {
        const result = allScopes ? await options.memory.compact() : await options.memory.compact(scope);
        return {
          content: [{ type: "text", text: `Memory deduplicated: scanned=${result.scannedCount}, removed=${result.removedCount}, scopes=${result.scopesAffected}` }],
          details: { result }
        };
      }

      throw new Error(`Unsupported action: ${action}`);
    }
  };
}
