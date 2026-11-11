import { parseDurableRequestMode, type DurableRequestMode } from "$lib/server/agent/durable/activation.js";

interface StreamBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  agentId?: string;
  thinkingLevel?: string;
  projectId?: string;
  modelKey?: string;
  durableMode?: string;
  resumePlanId?: string;
  clientSurface?: "desktop";
}

export interface ParsedStreamRequest extends Omit<StreamBody, "durableMode"> {
  durableMode?: DurableRequestMode;
  files: File[];
}

export function streamRetryPolicy(body: ParsedStreamRequest, hasPlan: boolean, hasExecution: boolean): "app" | undefined {
  return body.clientSurface === "desktop" && !hasPlan && !hasExecution ? "app" : undefined;
}

export async function parseStreamRequest(request: Request): Promise<ParsedStreamRequest> {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    const body = await request.json() as StreamBody;
    return { ...body, clientSurface: body.clientSurface === "desktop" ? "desktop" : undefined, durableMode: parseDurableRequestMode(body.durableMode), files: [] };
  }
  const form = await request.formData();
  return {
    userId: String(form.get("userId") ?? ""),
    message: String(form.get("message") ?? ""),
    conversationId: String(form.get("conversationId") ?? ""),
    profileId: String(form.get("profileId") ?? ""),
    agentId: String(form.get("agentId") ?? "").trim() || undefined,
    thinkingLevel: String(form.get("thinkingLevel") ?? ""),
    projectId: String(form.get("projectId") ?? ""),
    modelKey: String(form.get("modelKey") ?? "").trim() || undefined,
    resumePlanId: String(form.get("resumePlanId") ?? "").trim() || undefined,
    clientSurface: form.get("clientSurface") === "desktop" ? "desktop" : undefined,
    durableMode: parseDurableRequestMode(form.get("durableMode")),
    files: form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0)
  };
}
