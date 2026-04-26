import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import type { ConversationAttachment, ConversationMessage } from "$lib/shared/types/message";
import { classifyFilePreview } from "$lib/shared/filePreview";
import { getRuntime } from "$lib/server/app/runtime";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext";

interface SessionFileRecord {
  id: string;
  original: string;
  local: string;
  mimeType?: string;
  mediaType: "image" | "audio" | "video" | "file";
  size: number;
  createdAt: string;
  source: "persisted";
  previewKind: ReturnType<typeof classifyFilePreview>;
}

function encodeFileId(local: string): string {
  return Buffer.from(local, "utf8").toString("base64url");
}

function decodeFileId(fileId: string): string {
  return Buffer.from(fileId, "base64url").toString("utf8");
}

function normalizeMediaType(attachment: ConversationAttachment): SessionFileRecord["mediaType"] {
  if (attachment.mediaType === "image" || attachment.mediaType === "audio" || attachment.mediaType === "video") {
    return attachment.mediaType;
  }
  const mimeType = String(attachment.mimeType ?? "").toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function buildConversationFiles(workspaceDir: string, messages: ConversationMessage[]): SessionFileRecord[] {
  const files: SessionFileRecord[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.attachments) || message.attachments.length === 0) continue;
    for (const attachment of message.attachments) {
      const local = String(attachment.local ?? "").trim();
      if (!local) continue;
      const fullPath = path.resolve(workspaceDir, local);
      const workspaceRoot = path.resolve(workspaceDir);
      if (fullPath !== workspaceRoot && !fullPath.startsWith(`${workspaceRoot}${path.sep}`)) continue;
      if (!existsSync(fullPath)) continue;

      const stats = statSync(fullPath);
      const mediaType = normalizeMediaType(attachment);
      const mimeType = attachment.mimeType || undefined;
      files.push({
        id: encodeFileId(local),
        original: String(attachment.original ?? "").trim() || path.basename(local),
        local,
        mimeType,
        mediaType,
        size: Number(attachment.size ?? stats.size ?? 0),
        createdAt: String(message.createdAt ?? ""),
        source: "persisted",
        previewKind: classifyFilePreview({
          name: String(attachment.original ?? path.basename(local)),
          mimeType,
          mediaType
        })
      });
    }
  }

  return files.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return a.original.localeCompare(b.original);
  });
}

function resolveAuthorizedConversation(input: {
  profileId: string;
  userId: string;
  sessionId: string;
}) {
  const runtime = getRuntime();
  const externalUserId = toWebExternalUserId(input.userId, input.profileId);
  const conversation = runtime.sessions.getConversationById(input.sessionId, "web", externalUserId);
  if (!conversation) return null;
  return {
    externalUserId,
    conversation,
    messages: runtime.sessions.listMessages(conversation.id),
    workspaceDir: getWebRuntimeContext(input.profileId).store.getWorkspaceDir()
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const profileId = sanitizeWebProfileId(url.searchParams.get("profileId"));
  const userId = sanitizeWebUserId(url.searchParams.get("userId"));
  const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
  const fileId = String(url.searchParams.get("fileId") ?? "").trim();
  const download = url.searchParams.get("download") === "1";

  if (!sessionId) {
    return json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }

  const resolved = resolveAuthorizedConversation({ profileId, userId, sessionId });
  if (!resolved) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  const files = buildConversationFiles(resolved.workspaceDir, resolved.messages);
  if (!fileId) {
    return json({
      ok: true,
      files
    });
  }

  let local: string;
  try {
    local = decodeFileId(fileId);
  } catch {
    return json({ ok: false, error: "Invalid fileId" }, { status: 400 });
  }

  const file = files.find((item) => item.local === local);
  if (!file) {
    return json({ ok: false, error: "File not found in this session" }, { status: 404 });
  }

  const fullPath = path.resolve(resolved.workspaceDir, local);
  const buffer = readFileSync(fullPath);
  return new Response(buffer, {
    status: 200,
    headers: {
      "content-type": file.mimeType || "application/octet-stream",
      "content-length": String(buffer.byteLength),
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.original)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
};
