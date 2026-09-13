import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { BuiltInFeaturePlugin } from "../types.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { queryTraceReport, queryTurnTraceReport, publicTraceReport } from "./report.js";
import { renderTraceReport } from "./render.js";
import { publishHtmlDocument } from "../cloudflareHtml/publishHtmlTool.js";
import { resolveCloudflareHtmlConfig } from "../cloudflareHtml/config.js";


const traceSchema = Type.Object({ runId: Type.Optional(Type.String()), messageId: Type.Optional(Type.String()), publish: Type.Optional(Type.Boolean()), language: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])) });

export const isTraceViewerEnabled = (settings: RuntimeSettings) => settings.plugins.entries?.["trace-viewer"]?.enabled === true;
export const traceViewerFeaturePlugin: BuiltInFeaturePlugin = {
  key: "trace-viewer", name: "Call Trace", version: "0.1.0", settingsKey: "entries",
  description: "Inspect model and tool calls, timing and token usage; publish an HTML snapshot.",
  isEnabled: isTraceViewerEnabled,
  createTools: context => {
    const tool: AgentTool<typeof traceSchema> = {
    name: "viewTrace", label: "Call trace",
    description: "Inspect a recorded conversation run. Omit runId/messageId to inspect the turn preceding this request. messageId identifies a stored or platform message. A quoted message is selected automatically. Set publish=true only when the user requests a public HTML link; public reports omit argument/result/error previews. Never invent run IDs or links.",
    parameters: traceSchema,
    execute: async (_id, params) => {
      if (!isTraceViewerEnabled(context.getSettings())) throw new Error("Call Trace plugin is disabled.");
      if (!context.traceScope) throw new Error("Conversation scope unavailable.");
      const store = new SqliteTraceStore();
      try {
        const messageId = params.messageId ?? (params.runId ? undefined : context.replyToMessageId);
        const messageRuns = messageId ? context.resolveMessageRunIds?.(messageId) : undefined;
        const report = messageRuns?.length
          ? queryTurnTraceReport(store, messageRuns, context.traceScope)
          : queryTraceReport(store, { ...params, messageId, beforeRunId: context.runId }, context.traceScope);
        if (params.publish) {
          const result = await publishHtmlDocument(resolveCloudflareHtmlConfig(context.getSettings()), renderTraceReport(publicTraceReport(report), params.language));
          return { content: [{ type: "text" as const, text: `Public call trace: ${result.url}` }], details: { runId: report.runId, url: result.url } };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(publicTraceReport(report)) }], details: { runId: report.runId } };
      } finally { store.close(); }
    }
  };
    return [tool];
  }
};
