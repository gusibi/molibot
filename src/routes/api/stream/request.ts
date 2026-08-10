import { parseDurableRequestMode, type DurableRequestMode } from "$lib/server/agent/durable/activation.js";

interface StreamBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  thinkingLevel?: string;
  projectId?: string;
  modelKey?: string;
  durableMode?: string;
  resumePlanId?: string;
}

export interface ParsedStreamRequest extends Omit<StreamBody, "durableMode"> {
  durableMode?: DurableRequestMode;
  files: File[];
}

export async function parseStreamRequest(request: Request): Promise<ParsedStreamRequest> {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    const body = await request.json() as StreamBody;
    return { ...body, durableMode: parseDurableRequestMode(body.durableMode), files: [] };
  }
  const form = await request.formData();
  return {
    userId: String(form.get("userId") ?? ""),
    message: String(form.get("message") ?? ""),
    conversationId: String(form.get("conversationId") ?? ""),
    profileId: String(form.get("profileId") ?? ""),
    thinkingLevel: String(form.get("thinkingLevel") ?? ""),
    projectId: String(form.get("projectId") ?? ""),
    modelKey: String(form.get("modelKey") ?? "").trim() || undefined,
    resumePlanId: String(form.get("resumePlanId") ?? "").trim() || undefined,
    durableMode: parseDurableRequestMode(form.get("durableMode")),
    files: form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0)
  };
}
