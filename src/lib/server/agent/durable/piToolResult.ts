import type { JsonValue } from "@earendil-works/chord";
import type { JsonValue as ModelJsonValue } from "@earendil-works/pi-ai";
import type { HostToolResult } from "$lib/server/agent/tools/preparedTool.js";

/** Private execution metadata travels with the canonical receipt, separately from model content. */
export function encodePiToolDetails(result: HostToolResult): JsonValue | undefined {
  return JSON.parse(JSON.stringify({ molibotExecution: { version: 1, details: result.details,
    metadata: result.metadata, error: result.error, terminate: result.terminate } }));
}

export function decodePiToolDetails(details: ModelJsonValue | undefined): Pick<HostToolResult, "details" | "metadata" | "error" | "terminate"> {
  const envelope = details && typeof details === "object" && !Array.isArray(details) && "molibotExecution" in details ? details.molibotExecution : undefined;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !("version" in envelope) || envelope.version !== 1) return { details };
  return { details: envelope.details,
    metadata: envelope.metadata && typeof envelope.metadata === "object" && !Array.isArray(envelope.metadata) ? Object.fromEntries(Object.entries(envelope.metadata)) : undefined,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    terminate: typeof envelope.terminate === "boolean" ? envelope.terminate : undefined };
}
