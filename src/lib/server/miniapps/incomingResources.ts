import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appDataDirPath, isInside, isValidMiniAppId } from "$lib/server/miniapps/paths.js";
import { MiniAppError, type MessageCaptureResource } from "$lib/server/miniapps/types.js";

export const MAX_INCOMING_RESOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_INCOMING_DIRECTORY_BYTES = 256 * 1024 * 1024;

export interface StageIncomingResourceInput {
  dataRoot: string;
  appId: string;
  sourcePath: string;
  original: string;
  mediaType: "image" | "file";
  mimeType?: string;
  warn?: (event: string, detail: Record<string, unknown>) => void;
}

function safeExtension(name: string): string {
  const extension = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function pruneIncoming(incomingDir: string, warn?: StageIncomingResourceInput["warn"]): void {
  const files = fs.readdirSync(incomingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const target = path.join(incomingDir, entry.name);
      const stats = fs.statSync(target);
      return { target, size: stats.size, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (total <= MAX_INCOMING_DIRECTORY_BYTES) break;
    fs.unlinkSync(file.target);
    total -= file.size;
    warn?.("incoming_resource_evicted", { bytes: file.size });
  }
}

export function stageIncomingResource(input: StageIncomingResourceInput): MessageCaptureResource {
  if (!isValidMiniAppId(input.appId)) throw new MiniAppError("Invalid Mini App id.", "invalid_input");
  let source: string;
  let stats: fs.Stats;
  try {
    source = fs.realpathSync(input.sourcePath);
    stats = fs.statSync(source);
  } catch {
    throw new MiniAppError("Attachment is unavailable.", "invalid_input");
  }
  if (!stats.isFile()) throw new MiniAppError("Attachment is unavailable.", "invalid_input");
  if (stats.size > MAX_INCOMING_RESOURCE_BYTES) {
    throw new MiniAppError("Attachment exceeds the 64 MiB limit.", "invalid_input");
  }

  const appDir = appDataDirPath(input.dataRoot, input.appId);
  if (!appDir) throw new MiniAppError("Invalid Mini App id.", "invalid_input");
  const incomingDir = path.join(appDir, "incoming");
  fs.mkdirSync(incomingDir, { recursive: true });
  const filename = `${randomUUID()}${safeExtension(input.original)}`;
  const target = path.join(incomingDir, filename);
  const temporary = `${target}.part`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporary, target);
  } catch {
    fs.rmSync(temporary, { force: true });
    throw new MiniAppError("Attachment could not be staged.", "invalid_input");
  }
  pruneIncoming(incomingDir, input.warn);
  const relative = `incoming/${filename}`;
  if (!validateIncomingResource(input.dataRoot, input.appId, relative)) {
    fs.rmSync(target, { force: true });
    throw new MiniAppError("Staged attachment failed validation.", "invalid_input");
  }
  return {
    path: relative,
    name: path.basename(input.original) || "attachment",
    kind: input.mediaType,
    mime: input.mimeType || "application/octet-stream",
    bytes: stats.size
  };
}

export function validateIncomingResource(dataRoot: string, appId: string, relative: string): boolean {
  const appDir = appDataDirPath(dataRoot, appId);
  if (!appDir || !relative.startsWith("incoming/")) return false;
  try {
    const incoming = fs.realpathSync(path.join(appDir, "incoming"));
    const target = fs.realpathSync(path.join(appDir, relative));
    return isInside(incoming, target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}
