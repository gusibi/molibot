interface StreamBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  thinkingLevel?: string;
  projectId?: string;
  modelKey?: string;
}

export interface ParsedStreamRequest extends StreamBody {
  files: File[];
}

export async function parseStreamRequest(request: Request): Promise<ParsedStreamRequest> {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return { ...(await request.json()) as StreamBody, files: [] };
  }
  const form = await request.formData();
  return {
    userId: String(form.get("userId") ?? ""),
    message: String(form.get("message") ?? ""),
    conversationId: String(form.get("conversationId") ?? ""),
    profileId: String(form.get("profileId") ?? ""),
    thinkingLevel: String(form.get("thinkingLevel") ?? ""),
    projectId: String(form.get("projectId") ?? ""),
    modelKey: String(form.get("modelKey") ?? ""),
    files: form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0)
  };
}
