import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import type { ToolFileStagingScope } from "$lib/server/miniapps/toolFileStaging.js";
import { MiniAppError, type MiniAppToolDescriptor } from "$lib/server/miniapps/types.js";

/**
 * Bridges Mini App tools into the agent's tool runtime.
 *
 * The adapter is deliberately thin: it does not read files, open databases, or
 * decide whether an app is enabled. Every one of those questions belongs to
 * MiniAppHost, which answers it *at call time* — so a tool already present in a
 * running turn's tool list still gets refused once the owner switches the app
 * off.
 */

/**
 * Mini App parameters are plain JSON Schema from the manifest, not TypeBox.
 * The runner passes `parameters` through to the model as-is, so the validated
 * schema object is handed over unchanged and only cast to the expected type.
 */
function schemaFor(descriptor: MiniAppToolDescriptor): AgentTool<any>["parameters"] {
  return descriptor.inputSchema as unknown as AgentTool<any>["parameters"];
}

const emptySchema = Type.Object({}, { additionalProperties: true });

export function createMiniAppAgentTool(
  host: MiniAppHost,
  descriptor: MiniAppToolDescriptor,
  staging?: ToolFileStagingScope
): AgentTool<any> {
  return {
    name: descriptor.toolId,
    label: descriptor.label,
    description: descriptor.description,
    parameters: schemaFor(descriptor) ?? emptySchema,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
      try {
        const result = await host.invokeTool(
          descriptor.toolId,
          params,
          { toolCallId, signal },
          staging ? { staging } : undefined
        );
        return {
          content: result.content,
          // Only non-sensitive identity + freshness. Never the data directory.
          details: {
            appId: descriptor.appId,
            toolName: descriptor.toolName,
            revision: host.getRevision(descriptor.appId),
            structuredContent: result.structuredContent
          }
        };
      } catch (cause) {
        const message = cause instanceof MiniAppError
          ? cause.message
          : `${descriptor.label} failed.`;
        return {
          content: [{ type: "text" as const, text: message }],
          error: message,
          details: { appId: descriptor.appId, toolName: descriptor.toolName }
        };
      }
    }
  };
}

export interface MiniAppDeferredTool {
  name: string;
  label: string;
  description: string;
  keywords: string[];
  tool: AgentTool<any>;
  descriptor: MiniAppToolDescriptor;
}

/**
 * Every enabled app's tools, shaped for the deferred-tool index.
 *
 * These stay out of the system prompt's stable prefix — the installed app set
 * is dynamic, and putting it there would rewrite the prefix on every install.
 * The agent finds them by domain keyword through `toolSearch` instead.
 */
export function buildMiniAppDeferredTools(
  host: MiniAppHost,
  staging?: ToolFileStagingScope
): MiniAppDeferredTool[] {
  return host.listTools().map((descriptor) => ({
    name: descriptor.toolId,
    label: descriptor.label,
    description: `[${descriptor.appName}] ${descriptor.description}`,
    keywords: descriptor.keywords,
    tool: createMiniAppAgentTool(host, descriptor, staging),
    descriptor
  }));
}
