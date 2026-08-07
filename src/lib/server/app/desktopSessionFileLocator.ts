import fs from "node:fs";
import path from "node:path";
import type { DesktopMiniAppResourceLocator } from "$lib/shared/desktop.js";
import { mediaTypeFromName, mimeFromFilename } from "$lib/shared/filePreview.js";
import { config } from "$lib/server/app/env.js";
import { decodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import { isInside } from "$lib/server/miniapps/paths.js";
import { MiniAppError } from "$lib/server/miniapps/types.js";
import type { ResolvedMessageActionResource } from "$lib/server/miniapps/messageActions.js";
import { sanitizeWebProfileId, sanitizeWebUserId } from "$lib/server/web/identity.js";
import { resolveAuthorizedConversation } from "$lib/server/web/sessionWorkspace.js";

function invalid(): never {
  throw new MiniAppError("Attachment locator is invalid or unavailable.", "invalid_input");
}

function decodeFileId(fileId: string): string {
  try {
    const local = Buffer.from(fileId, "base64url").toString("utf8");
    if (!local || Buffer.from(local, "utf8").toString("base64url") !== fileId) invalid();
    return local;
  } catch {
    return invalid();
  }
}

function containedFile(root: string, local: string): string {
  try {
    const realRoot = fs.realpathSync(root);
    const target = fs.realpathSync(path.resolve(realRoot, local));
    if (!isInside(realRoot, target) || !fs.statSync(target).isFile()) invalid();
    return target;
  } catch {
    return invalid();
  }
}

export async function resolveDesktopSessionFileLocator(locator: unknown): Promise<ResolvedMessageActionResource> {
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) invalid();
  const raw = locator as Partial<DesktopMiniAppResourceLocator>;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  const fileId = typeof raw.fileId === "string" ? raw.fileId.trim() : "";
  if (!sessionId || !fileId) invalid();
  const local = decodeFileId(fileId);

  const external = decodeExternalSessionId(sessionId);
  if (external) {
    const channelRoot = TASK_CHANNEL_ROOTS.find((entry) => entry.channel === external.channel);
    if (!channelRoot) invalid();
    const workspace = path.resolve(config.dataDir, channelRoot.dir, "bots", external.botId, external.chatId);
    const sourcePath = containedFile(workspace, local);
    const relative = path.relative(workspace, sourcePath);
    if (!relative.startsWith(`scratch${path.sep}`) && !relative.startsWith(`attachments${path.sep}`)) invalid();
    const contexts = path.join(workspace, "contexts");
    const jsonl = path.join(contexts, `${external.sessionId}.jsonl`);
    const json = path.join(contexts, `${external.sessionId}.json`);
    const contextFile = fs.existsSync(jsonl) ? jsonl : json;
    if (!fs.existsSync(contextFile) || !fs.readFileSync(contextFile, "utf8").includes(local)) invalid();
    const original = path.basename(local);
    const mediaType = mediaTypeFromName(original);
    return {
      sourcePath,
      original,
      kind: mediaType === "image" ? "image" : "file",
      mimeType: mimeFromFilename(original) ?? undefined
    };
  }

  const resolved = resolveAuthorizedConversation({
    profileId: sanitizeWebProfileId(typeof raw.profileId === "string" ? raw.profileId : ""),
    userId: sanitizeWebUserId(""),
    sessionId,
    projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : undefined
  });
  if (!resolved) invalid();
  const attachment = resolved.messages
    .flatMap((message) => message.attachments ?? [])
    .find((item) => String(item.local ?? "") === local);
  if (!attachment) invalid();
  const sourcePath = containedFile(resolved.workspaceDir, local);
  const original = String(attachment.original ?? "").trim() || path.basename(local);
  const mimeType = String(attachment.mimeType ?? "").trim() || mimeFromFilename(original) || undefined;
  const kind = attachment.mediaType === "image" || mimeType?.startsWith("image/") ? "image" : "file";
  return { sourcePath, original, kind, mimeType };
}
